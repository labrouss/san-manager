// =============================================================================
// services/MdsClient.ts
// NX-API JSON-RPC transport — supports both endpoint variants:
//
//   /ins-api  Cisco MDS 9000 native FC switches (primary)
//   /ins      NX-OS network switches with FCoE/FC capabilities (fallback)
//
// On first connection the client probes /ins-api; if it gets a 404 it retries
// on /ins and remembers that endpoint for the lifetime of the object.
//
// Payload format (same for both endpoints, per Cisco developer docs):
//   POST <endpoint>
//   Content-Type: application/json
//   Authorization: Basic <user:password>
//   {
//     ins_api: {
//       version: "1.0",
//       type: "cli_show" | "cli_show_ascii" | "cli_conf",
//       chunk: "0",
//       sid: "sid",
//       input: "<nxos command>",
//       output_format: "json"
//     }
//   }
//
// Reference:
//   MDS: https://developer.cisco.com/docs/cisco-mds-9000-series-nx-api-reference/
//   NX-OS: https://developer.cisco.com/docs/nexus-nx-api-reference/
// =============================================================================

import axios, { AxiosInstance, AxiosError } from "axios";
import https from "https";
import logger from "../config/logger";

interface NxApiRequest {
  ins_api: {
    version:       string;
    type:          "cli_show" | "cli_show_ascii" | "cli_conf";
    chunk:         "0" | "1";
    sid:           string;
    input:         string;
    output_format: "json" | "xml";
  };
}

export interface NxApiOutput<T = unknown> {
  body:  T;
  code:  string;
  input: string;
  msg:   string;
}

interface NxApiResponse<T> {
  ins_api: {
    type:    string;
    version: string;
    sid:     string;
    outputs: { output: NxApiOutput<T> | NxApiOutput<T>[] };
  };
}

// Endpoint discovery state — cached per (ip:port)
type EndpointResult = "/ins-api" | "/ins";
const endpointCache = new Map<string, EndpointResult>();

export class MdsClient {
  private readonly http:  AxiosInstance;
  private sessionCookie: string | null = null;
  private readonly cacheKey: string;

  constructor(
    private readonly ipAddress: string,
    private readonly username:  string,
    private readonly password:  string,
    private readonly port:      number = 443
  ) {
    this.cacheKey = `${ipAddress}:${port}`;

    // Use HTTP for port 80/8080, HTTPS for everything else
    const protocol = (port === 80 || port === 8080) ? "http" : "https";

    this.http = axios.create({
      baseURL:    `${protocol}://${ipAddress}:${port}`,
      timeout:    20_000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers:    { "Content-Type": "application/json" },
      // Accept all HTTP status codes so we can read error bodies from the switch
      validateStatus: () => true,
    });

    this.http.interceptors.request.use((config) => {
      if (this.sessionCookie) config.headers["Cookie"] = this.sessionCookie;
      return config;
    });

    this.http.interceptors.response.use((response) => {
      const setCookie = response.headers["set-cookie"];
      if (setCookie) {
        const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        this.sessionCookie = cookie.split(";")[0];
      }
      return response;
    });
  }

  // ---------------------------------------------------------------------------
  // Endpoint discovery
  // Try /ins-api first (MDS native), fall back to /ins (NX-OS with FCoE)
  // Result is cached per ip:port for the process lifetime.
  // ---------------------------------------------------------------------------
  private async resolveEndpoint(): Promise<EndpointResult> {
    if (endpointCache.has(this.cacheKey)) {
      return endpointCache.get(this.cacheKey)!;
    }

    const probe: NxApiRequest = {
      ins_api: {
        version: "1.0", type: "cli_show", chunk: "0",
        sid: "sid", input: "show version", output_format: "json",
      },
    };
    const auth = { username: this.username, password: this.password };

    // 1. Try /ins-api (MDS 9000 native)
    let res: any;
    try {
      res = await this.http.post("/ins-api", probe, { auth });
    } catch (err) {
      // Network-level failure — not an endpoint issue, surface it immediately
      if (err instanceof AxiosError) this.throwNetworkError(err.code ?? "UNKNOWN");
      throw err;
    }

    if (res.status !== 404) {
      // 200 (success) or 400/401 (auth/payload error) — endpoint exists
      logger.info({ ip: this.ipAddress, port: this.port, endpoint: "/ins-api" },
        "NX-API endpoint resolved: MDS native (/ins-api)");
      endpointCache.set(this.cacheKey, "/ins-api");
      return "/ins-api";
    }

    // 2. /ins-api returned 404 → try /ins (NX-OS FCoE)
    logger.debug({ ip: this.ipAddress }, "/ins-api returned 404, trying /ins (NX-OS FCoE)");
    let res2: any;
    try {
      res2 = await this.http.post("/ins", probe, { auth });
    } catch (err) {
      if (err instanceof AxiosError) this.throwNetworkError(err.code ?? "UNKNOWN");
      throw err;
    }

    if (res2.status === 404) {
      throw new Error(
        `NX-API not found on ${this.ipAddress}:${this.port} — ` +
        `tried /ins-api (MDS) and /ins (NX-OS). ` +
        `Verify 'feature nxapi' is enabled on the switch.`
      );
    }

    logger.info({ ip: this.ipAddress, port: this.port, endpoint: "/ins" },
      "NX-API endpoint resolved: NX-OS FCoE (/ins)");
    endpointCache.set(this.cacheKey, "/ins");
    return "/ins";
  }

  // ---------------------------------------------------------------------------
  // Generic show command
  // ---------------------------------------------------------------------------
  async sendCommand<T = unknown>(command: string): Promise<NxApiOutput<T>> {
    const endpoint = await this.resolveEndpoint();

    const payload: NxApiRequest = {
      ins_api: {
        version: "1.0", type: "cli_show", chunk: "0",
        sid: "sid", input: command, output_format: "json",
      },
    };

    let res: any;
    try {
      res = await this.http.post(endpoint, payload, {
        auth: { username: this.username, password: this.password },
      });
    } catch (err) {
      if (err instanceof AxiosError) {
        logger.error({ ip: this.ipAddress, endpoint, cmd: command, code: err.code }, "NX-API network error");
        this.throwNetworkError(err.code ?? "UNKNOWN");
      }
      throw err;
    }

    if (res.status < 200 || res.status >= 300) {
      const body = res.data as any;
      logger.error({ ip: this.ipAddress, endpoint, cmd: command, status: res.status, body }, "NX-API HTTP error");

      if (res.status === 401 || res.status === 403)
        throw new Error(`Authentication failed for ${this.ipAddress} — check username and password.`);

      // Extract the switch's own error message
      const switchMsg =
        body?.ins_api?.outputs?.output?.msg ??
        body?.ins_api?.outputs?.output?.[0]?.msg ??
        body?.message ??
        JSON.stringify(body).slice(0, 300);

      throw new Error(`NX-API HTTP ${res.status} from ${this.ipAddress}: ${switchMsg}`);
    }

    const data = res.data as NxApiResponse<T>;
    const outputs = data?.ins_api?.outputs?.output;
    const output  = Array.isArray(outputs) ? outputs[0] : outputs;

    if (!output) {
      throw new Error(`NX-API returned an unexpected response from ${this.ipAddress}`);
    }
    if (output.code !== "200") {
      throw new Error(`NX-API [${output.code}] "${command}" on ${this.ipAddress}: ${output.msg}`);
    }

    return output;
  }

  // ---------------------------------------------------------------------------
  // Config batch (zone/alias writes)
  // ---------------------------------------------------------------------------
  async sendConfigBatch(commands: string[]): Promise<void> {
    if (commands.length === 0) return;

    const endpoint = await this.resolveEndpoint();
    const payload: NxApiRequest = {
      ins_api: {
        version: "1.0", type: "cli_conf", chunk: "0",
        sid: "sid", input: commands.join("\n"), output_format: "json",
      },
    };

    let res: any;
    try {
      res = await this.http.post(endpoint, payload, {
        auth: { username: this.username, password: this.password },
      });
    } catch (err) {
      if (err instanceof AxiosError) this.throwNetworkError(err.code ?? "UNKNOWN");
      throw err;
    }

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`NX-API config batch HTTP ${res.status} from ${this.ipAddress}`);
    }

    const data  = res.data as NxApiResponse<{ msg?: string }>;
    const outputs    = data?.ins_api?.outputs?.output;
    const outputList = Array.isArray(outputs) ? outputs : [outputs];
    const errors     = outputList
      .filter((o) => o && o.code !== "200")
      .map((o) => `[${o.code}] ${o.input}: ${o.msg}`);

    if (errors.length > 0) throw new Error(`Config batch errors:\n${errors.join("\n")}`);

    logger.debug({ ip: this.ipAddress, endpoint, cmdCount: commands.length }, "Config batch sent");
  }

  // ---------------------------------------------------------------------------
  // Clear cached endpoint (call if switch type changes)
  // ---------------------------------------------------------------------------
  clearEndpointCache(): void {
    endpointCache.delete(this.cacheKey);
  }

  clearSession(): void {
    this.sessionCookie = null;
  }

  // ---------------------------------------------------------------------------
  private throwNetworkError(code: string): never {
    if (code === "ECONNREFUSED")
      throw new Error(
        `Connection refused at ${this.ipAddress}:${this.port} — ` +
        `is NX-API enabled? Run: feature nxapi`
      );
    if (code === "ENOTFOUND")
      throw new Error(`Cannot resolve hostname ${this.ipAddress} — check the IP address.`);
    if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ENETUNREACH")
      throw new Error(
        `Timeout/unreachable: ${this.ipAddress}:${this.port} — ` +
        `check network connectivity and firewall rules.`
      );
    throw new Error(`Network error (${code}) connecting to ${this.ipAddress}:${this.port}`);
  }
}

// ---------------------------------------------------------------------------
export function buildMdsClient(ipAddress: string): MdsClient {
  return new MdsClient(
    ipAddress,
    process.env.MDS_USERNAME ?? "admin",
    process.env.MDS_PASSWORD ?? "",
    parseInt(process.env.MDS_PORT ?? "443", 10)
  );
}
