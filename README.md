# SAN Management Platform — Cisco MDS 9000

Full-stack FC SAN management platform: zoning, aliases, SFP diagnostics, telemetry,
user authentication, and configuration management.
Runs as **three fully-isolated Docker images** — database, API, and frontend never share a container.

---

## Architecture

```
Browser
  │  HTTP :8080
  ▼
┌─────────────────────────────────┐   api-net (internal)
│  san-frontend                   │ ──────────────────────▶ san-backend :3001
│  nginx:1.27-alpine              │                         │
│  React SPA + /api proxy         │                         │  db-net (internal)
└─────────────────────────────────┘                         ▼
                                                       san-db :5432
                                              timescale/timescaledb-pg16
                                              (never reachable from outside)
```

### Networks

| Network  | Members              | Internet access |
|----------|----------------------|-----------------|
| `db-net` | backend ↔ db         | No (internal)   |
| `api-net`| frontend ↔ backend   | No (internal)   |
| Host     | frontend only (:8080)| Yes             |

### Images

| Container      | Base image                       | Role                               |
|----------------|----------------------------------|------------------------------------|
| `san-db`       | `timescale/timescaledb-pg16`     | PostgreSQL 16 + TimescaleDB        |
| `san-backend`  | `node:20-alpine` (multi-stage)   | Express API + Prisma + poller      |
| `san-frontend` | `nginx:1.27-alpine` (multi-stage)| React SPA + nginx reverse proxy    |

---

## Quick Start

### Prerequisites
- Docker Engine ≥ 24 with Compose V2
- `make` (optional but recommended)
- 2 GB RAM minimum

### 1. Extract and configure

```bash
unzip san-platform-v2.9.zip && cd san-platform

# Required: secret files
echo "your_secure_db_password"  > secrets/db_password.txt
echo "your_mds_password"        > secrets/mds_password.txt

# Recommended: generate a strong JWT secret
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
echo "ADMIN_PASSWORD=YourSecurePassword!" >> .env
```

### 2. Build and start

```bash
make build    # builds all three images (first run: ~3–5 minutes)
make up       # starts all containers
```

Open **http://localhost:8080** in your browser.

### 3. First login

Default credentials: `admin` / `Admin1234!`

> **Change the admin password immediately** via the Users tab after first login.

---

## Environment Variables

All variables have safe defaults. Override in `.env` (see `.env.example`).

| Variable           | Default                                   | Description                                 |
|--------------------|-------------------------------------------|---------------------------------------------|
| `JWT_SECRET`       | `san-platform-change-this-secret`         | JWT signing secret — **change in prod**     |
| `JWT_EXPIRES`      | `8h`                                      | Token lifetime                              |
| `ADMIN_PASSWORD`   | `Admin1234!`                              | Initial admin password — **change in prod** |
| `MDS_SIMULATE`     | `false`                                   | Use built-in MDS simulator (no real switch) |
| `SAN_SEED`         | `false`                                   | Seed demo data on first boot                |
| `FRONTEND_PORT`    | `8080`                                    | Host port for the UI                        |
| `MDS_USERNAME`     | `admin`                                   | Fallback switch credential                  |
| `MDS_PASSWORD`     | *(empty)*                                 | Fallback switch password                    |

---

## Features

### Switch Management
- **Register switches from the UI** — no CLI access required. Enter IP, username, and password;
  the platform verifies NX-API connectivity before saving.
- **Multi-switch support** — all data (aliases, zones, metrics, snapshots) is scoped per switch.
  Switching the dropdown instantly shows data for the selected switch only.
- **Remove switch** — deletes the switch and all associated data via a confirmation dialog.
  Cascades to aliases, zones, zone sets, snapshots, and port metrics.

### FC Alias Management
- Full CRUD for FC aliases (device-alias) with WWN validation.
- **Alias bridge** — auto-discovers WWNs from `show fcns database detail` and adds unnamed entries
  as orphaned aliases, ready to be named.
- Sync aliases to the switch via `device-alias commit`.

### Zone Editor
- Create and edit zones and zone sets per VSAN.
- **WWN / alias dropdowns** — populated from discovered WWNs so you never need to type a raw WWN.
- Draft → commit workflow: changes are local until explicitly committed.
- Commit and activate triggers a full NX-OS config sequence and saves a pre-commit snapshot.

### Fabric Discovery
- `show fcns database detail` — full FCNS database per VSAN with pWWN, FCID, vendor, FC4 role
  (initiator / target), connected interface, and symbolic port name.
- `show fcs database` — FCS fabric topology.
- VSAN selector filters all fabric views to the selected VSAN.

### Port Inventory
- Live interface list from `show interface counters brief`.
- Falls back to live switch query when no metrics are stored yet (simulator or fresh install).
- Click a row to jump directly to its SFP diagnostics.

### SFP / Transceiver Health
- Interface **dropdown** populated from discovered interfaces — no typing required.
- Live readouts: RX/TX power (dBm), temperature, voltage, current.
- Colour-coded health badges (OK / Warning / Critical) based on industry thresholds.
- Historical RX power chart with –10 dBm warning reference line.

### Performance
- **Top-N ports chart** — bar chart of Tx/Rx throughput, frames/sec, or error rate for the
  busiest interfaces. Metric from `show interface counters brief` with delta calculation.
- **Per-port history chart** — select any port from a dropdown, choose a time window
  (1h / 6h / 24h / 7d), and view a Tx/Rx area chart plus RX optical power trend.
- Auto-refreshes every 30 seconds.

### Snapshot History
- Automatic pre-commit snapshots before every zone commit.
- Manual capture at any time.
- Diff summary shows what changed versus the previous snapshot.
- **Restore to draft** — restore any snapshot as a local draft without pushing to the switch.
  Review the restored zones in the Zone Editor, then commit or discard.

### Authentication & User Management
- JWT-based authentication (8h tokens, configurable).
- Three roles: **Admin** (full access), **Operator** (no user management), **Viewer** (read-only).
- First registered user is automatically promoted to Admin.
- Default admin account (`admin` / `Admin1234!`) created on first boot.
- User management UI: create, edit roles, reset passwords, disable/delete accounts.
- Password change requires current password for self; admins can reset others without it.

### Dark / Light Theme
- System preference detection with localStorage persistence.
- Toggle available on the login page and in the header (sun/moon icon).

### Application Settings (Admin)
- Toggle **MDS Simulator** on/off at runtime without restarting containers.
- Toggle **demo seed** flag.
- Live **database statistics** (row counts per table, metric date range).
- **Full database backup** — export all users, switches, aliases, zones, zone sets,
  and snapshots as a timestamped JSON file.
- **Restore from backup** — upload a JSON backup; records are upserted (existing data preserved).
- **Metrics purge** — delete port metrics older than N days to reclaim disk space.

### MDS 9000 Simulator
Enable with `MDS_SIMULATE=true` (or toggle in Settings). The simulator:
- Returns realistic responses for all supported NX-OS `show` commands.
- **Persists state per switch IP** — alias and zone changes made via the UI are stored in memory
  and reflected in subsequent `show device-alias database` and `show zoneset` queries.
- Simulates 8 FC interfaces (fc1/1–fc1/8) across two VSANs (100 and 200).
- Generates incrementing counter values so throughput delta calculations work after two polls.
- Simulates SFP transceiver data including one port with critically low RX power (fc1/8).

---

## Makefile Targets

```bash
make build       # docker compose build --no-cache
make up          # docker compose up -d
make down        # docker compose down
make seed        # run demo seed inside the backend container
make shell-db    # psql shell into the database
make shell-be    # sh into the backend container
make test        # run backend unit tests (vitest)
make logs        # tail all container logs
```

---

## Prisma Migrations

Migrations run automatically on container start via `prisma migrate deploy` in the entrypoint.

| Migration                          | Description                                  |
|------------------------------------|----------------------------------------------|
| `20240101000000_init_schema`       | All core tables: switches, aliases, zones,   |
|                                    | zone sets, zone members, snapshots, metrics  |
| `20240102000000_add_users`         | `users` table with `UserRole` enum           |

To apply migrations manually:
```bash
make shell-be
npx prisma migrate deploy
```

---

## NX-API Setup (real switches)

Enable NX-API on each MDS switch before registering it:

```
mds-switch# conf t
mds-switch(config)# feature nxapi
mds-switch(config)# nxapi https port 443
mds-switch(config)# nxapi sandbox
mds-switch(config)# copy run start
```

The platform connects via HTTPS to port 443 using the credentials you provide in the
"Add switch" modal.

---

## Security Notes

| Concern              | Mitigation                                                      |
|----------------------|-----------------------------------------------------------------|
| Credentials at rest  | Switch credentials held **in memory only** (not persisted to DB)|
| JWT secret           | Set `JWT_SECRET` to a 32+ byte random string via `openssl rand -hex 32` |
| Default password     | `ensureDefaultAdmin()` prints a warning — change immediately    |
| Internal networks    | DB and API have no host ports; only :8080 is exposed            |
| Docker secrets       | DB password passed via Docker secrets (0400 root:root), read by entrypoint before privilege drop |
| Privilege drop       | Backend entrypoint runs as root to read secrets, then `su-exec appuser node dist/app.js` |

---

## Project Layout

```
san-platform/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # Data models
│   │   ├── migrations/            # SQL migration files
│   │   ├── seed.ts                # Demo data seeder
│   │   └── 02-hypertable.sql      # TimescaleDB setup (idempotent)
│   ├── src/
│   │   ├── app.ts                 # Express bootstrap
│   │   ├── routes/
│   │   │   ├── auth.routes.ts     # Login, register, user CRUD
│   │   │   ├── fabric.routes.ts   # FCNS/FCS, switch registration, top ports
│   │   │   ├── settings.routes.ts # Settings, backup, restore
│   │   │   ├── switches.routes.ts # Switch CRUD, metrics, interfaces
│   │   │   └── zoning.routes.ts   # Aliases, zones, zone sets, commit, snapshots
│   │   ├── services/
│   │   │   ├── AuthService.ts     # JWT + bcrypt authentication
│   │   │   ├── clientFactory.ts   # Returns simulator or real MdsClient
│   │   │   ├── credentialStore.ts # In-memory per-switch credentials
│   │   │   ├── MdsClient.ts       # NX-API JSON-RPC client
│   │   │   ├── MdsFabricService.ts# FCNS/FCS parsing, top ports
│   │   │   ├── MdsSimulator.ts    # Built-in MDS 9000 simulator
│   │   │   └── MdsZoningService.ts# Diff engine, snapshot, commit sequence
│   │   ├── middleware/
│   │   │   └── auth.middleware.ts # requireAuth, requireRole
│   │   ├── workers/
│   │   │   └── MdsPoller.ts       # 60s polling loop
│   │   └── types/                 # TypeScript interfaces
│   └── Dockerfile
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── aliases/           # AliasManager
│       │   ├── auth/              # LoginPage, UserManagement
│       │   ├── fabric/            # FabricView (FCNS database)
│       │   ├── inventory/         # PortInventoryTable
│       │   ├── performance/       # TopPortsChart, PortPerformanceChart
│       │   ├── settings/          # SettingsPage
│       │   ├── sfp/               # SfpHealthView, SfpPowerChart
│       │   ├── switches/          # AddSwitchModal
│       │   └── zoning/            # ZoningEditor, SnapshotHistory
│       ├── context/
│       │   ├── AuthContext.tsx    # JWT token, login/logout
│       │   └── ThemeContext.tsx   # Dark/light mode
│       ├── hooks/
│       │   ├── useApi.ts          # SFP, metrics, interface hooks
│       │   └── useZoningApi.ts    # Zoning, fabric, fabric discovery hooks
│       └── pages/
│           └── Dashboard.tsx      # Main application shell
├── db/
│   └── init/                      # TimescaleDB initialisation SQL
├── secrets/
│   ├── db_password.txt            # Docker secret (create before first run)
│   └── mds_password.txt
├── docker-compose.yml
├── Makefile
└── .env.example
```

---

## Changelog

| Version | Key changes |
|---------|-------------|
| 2.9     | Settings page with simulator toggle, backup/restore, metrics purge; snapshot restore-to-draft button; UserManagement password form fix; Add Switch modal overlay; port inventory simulator fallback; zoning commit now routes through simulator |
| 2.8     | JWT authentication + user management (ADMIN/OPERATOR/VIEWER roles); dark/light theme; per-port performance history chart; MDS simulator persistent alias/zone state |
| 2.7     | Per-switch data isolation; hard delete with cascade; switch credential cleanup |
| 2.6     | Add-switch UI form; MDS 9000 simulator; fabric/FCNS view; top-5 performance chart; interface dropdowns for SFP and zones |
| 2.5     | Prisma engine bundled in Docker image (binaryTargets); no internet needed at runtime |
| 2.4     | Docker secrets privilege model (root → su-exec); OpenSSL fix |
| 2.3     | Removed hardcoded subnets from docker-compose |
| 2.2     | TypeScript compile errors fixed; shadcn/ui replaced with plain Tailwind |
| 2.1     | Proper Prisma migration structure; TimescaleDB hypertable idempotent setup |

---

## Changelog (continued)

| Version | Key changes |
|---------|-------------|
| 4.1     | Switch settings tab (display name, notes, hardware info); MDS simulator complete rewrite with Cisco DevNet field names; `show flogi database` support; per-switch isolated state; simulator config UI (port state/mode/speed/VSAN/SFP); credential management in switch settings; port inventory enriched with live WWN from `show interface` + `show flogi database`; fabric routes now use `factoryBuildClient` for all switch operations (commit ECONNABORTED fix) |
| 4.2     | Simulator configurable min/max ranges for throughput (Mbps) and SFP optical power (dBm) per port; `simValue()` produces smooth sinusoidal variation within ranges every poll; throughput/SFP charts now populated by simulator; three-tab simulator config (Basic / Throughput / SFP power); credential update form in Switch Settings (with live NX-API verification); README updated |

---

## Simulator port configuration ranges

Each simulated port has configurable ranges for throughput and SFP optical power.
Values oscillate smoothly between min and max on each 60-second poll cycle, producing
realistic time-series data for the performance and SFP charts.

### Throughput (Mbps)
| Field | Default (8G port) | Description |
|---|---|---|
| Tx Min | 400 Mbps | Minimum simulated transmit rate |
| Tx Max | 6000 Mbps | Maximum simulated transmit rate |
| Rx Min | 400 Mbps | Minimum simulated receive rate |
| Rx Max | 6400 Mbps | Maximum simulated receive rate |
| 0 | — | Set both to 0 to auto-derive from port speed |

### SFP optical power (dBm)
| Field | Normal | Degraded | Description |
|---|---|---|---|
| RX Min | −4.5 dBm | −12.5 dBm | Minimum RX optical power |
| RX Max | −2.0 dBm | −10.0 dBm | Maximum RX optical power |
| TX Min | −2.5 dBm | −2.5 dBm | Minimum TX optical power |
| TX Max | −0.5 dBm | −0.5 dBm | Maximum TX optical power |

Critical threshold: **−10 dBm**. Enable "Degraded" on a port to simulate a failing SFP.

---

## Switch credential management

When a real switch's password changes, update the stored credentials in **Switch settings → NX-API credentials**:

1. Enter the new username, password, and NX-API port
2. Click "Update credentials"
3. The API verifies connectivity before saving — if the switch is unreachable or credentials are wrong, an error is shown
4. Credentials are stored in memory for the session (not in the database)

After container restart, credentials must be re-entered. For persistent credentials, set `MDS_USERNAME` and `MDS_PASSWORD` environment variables as fallback defaults.
