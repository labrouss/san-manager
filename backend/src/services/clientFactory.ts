// =============================================================================
// services/clientFactory.ts
// Returns MdsSimulator (MDS_SIMULATE=true) or real MdsClient for any route.
// =============================================================================

import { MdsClient } from "./MdsClient";
import { MdsSimulator } from "./MdsSimulator";
import { credentialStore } from "./credentialStore";

export type AnyMdsClient = MdsClient | MdsSimulator;

export function isSim(): boolean {
  return process.env.MDS_SIMULATE === "true";
}

export function buildClient(switchId: string, ipAddress: string): AnyMdsClient {
  if (isSim()) return new MdsSimulator(ipAddress);

  const creds = credentialStore.get(switchId) ?? {
    username: process.env.MDS_USERNAME ?? "admin",
    password: process.env.MDS_PASSWORD ?? "",
    port:     parseInt(process.env.MDS_PORT ?? "443"),
  };

  return new MdsClient(ipAddress, creds.username, creds.password, creds.port);
}
