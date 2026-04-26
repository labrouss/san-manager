#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-build.sh
# =============================================================================
set -euo pipefail

: "${TARGET_DIR:?TARGET_DIR is not set — must be called by Buildroot make}"

log() { echo "[post-build] $*"; }

log "TARGET_DIR = ${TARGET_DIR}"

# ── 1. Make init.d scripts executable ────────────────────────────────────────
INITD="${TARGET_DIR}/etc/init.d"
for script in S01firstboot S40docker S50san-platform-load S60san-platform; do
    if [ -f "${INITD}/${script}" ]; then
        chmod +x "${INITD}/${script}"
        log "Made executable: ${script}"
    else
        log "WARNING: ${INITD}/${script} not found in overlay"
    fi
done

# ── 2. Runtime data directories ───────────────────────────────────────────────
mkdir -p "${TARGET_DIR}/var/lib/san-platform/pg_data"
mkdir -p "${TARGET_DIR}/var/lib/san-platform/logs"
mkdir -p "${TARGET_DIR}/var/log"
chmod 700 "${TARGET_DIR}/var/lib/san-platform/pg_data"

# ── 3. Secrets directory ──────────────────────────────────────────────────────
SECRETS_DIR="${TARGET_DIR}/opt/san-platform/secrets"
mkdir -p "${SECRETS_DIR}"
chmod 700 "${SECRETS_DIR}"

echo "san_secret" > "${SECRETS_DIR}/db_password.txt"
echo "CHANGE_ME"  > "${SECRETS_DIR}/mds_password.txt"
chmod 600 "${SECRETS_DIR}/db_password.txt"
chmod 600 "${SECRETS_DIR}/mds_password.txt"
log "Placeholder secrets written"

# ── 4. Make all helper scripts executable ─────────────────────────────────────
BIN_DIR="${TARGET_DIR}/opt/san-platform/bin"
if [ -d "${BIN_DIR}" ]; then
    chmod +x "${BIN_DIR}"/*.sh 2>/dev/null || true
    log "Helper scripts made executable"
fi

# ── 5. Docker daemon configuration ────────────────────────────────────────────
mkdir -p "${TARGET_DIR}/etc/docker"
cat > "${TARGET_DIR}/etc/docker/daemon.json" << 'DOCKERD'
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "live-restore": true,
  "iptables": true,
  "userland-proxy": false,
  "experimental": false
}
DOCKERD
log "Docker daemon.json written"

# ── 6. MOTD ───────────────────────────────────────────────────────────────────
cat > "${TARGET_DIR}/etc/motd" << 'MOTD'

  ╔══════════════════════════════════════════════════════╗
  ║          SAN Management Platform Appliance           ║
  ╚══════════════════════════════════════════════════════╝

  Web UI  →  http://<this-vm-ip>:8080
  Login   →  admin / Admin1234!  (CHANGE IMMEDIATELY)

  Manage the stack:
    /etc/init.d/S60san-platform status
    /etc/init.d/S60san-platform restart
    docker compose -f /opt/san-platform/docker-compose.yml ps

  Change secrets:
    vi /opt/san-platform/secrets/db_password.txt
    vi /opt/san-platform/secrets/mds_password.txt
    /etc/init.d/S60san-platform restart

MOTD

# ── 7. Log file placeholder ───────────────────────────────────────────────────
touch "${TARGET_DIR}/var/log/san-platform.log" 2>/dev/null || true

log "post-build.sh completed successfully"
