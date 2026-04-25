#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-build.sh
# =============================================================================
set -euo pipefail

: "${TARGET_DIR:?TARGET_DIR is not set — must be called by Buildroot make}"

log() { echo "[post-build] $*"; }

log "TARGET_DIR = ${TARGET_DIR}"

# ── 1. Enable systemd services ────────────────────────────────────────────────
WANTS_DIR="${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
mkdir -p "${WANTS_DIR}"

for svc in san-platform-load san-platform; do
    ln -sfn "/etc/systemd/system/${svc}.service" \
        "${WANTS_DIR}/${svc}.service"
    log "Enabled ${svc}.service"
done

# ── 2. Runtime data directories ───────────────────────────────────────────────
mkdir -p "${TARGET_DIR}/var/lib/san-platform/pg_data"
mkdir -p "${TARGET_DIR}/var/lib/san-platform/logs"

# tmpfiles.d — mkdir -p required; directory may not exist in minimal rootfs
mkdir -p "${TARGET_DIR}/etc/tmpfiles.d"
cat > "${TARGET_DIR}/etc/tmpfiles.d/san-platform.conf" << 'TMPFILES'
d /var/lib/san-platform        0700 root root -
d /var/lib/san-platform/pg_data 0700 root root -
d /var/lib/san-platform/logs   0755 root root -
TMPFILES
log "Created tmpfiles.d config"

# ── 3. Secrets directory ──────────────────────────────────────────────────────
SECRETS_DIR="${TARGET_DIR}/opt/san-platform/secrets"
mkdir -p "${SECRETS_DIR}"
chmod 700 "${SECRETS_DIR}"

echo "san_secret" > "${SECRETS_DIR}/db_password.txt"
echo "CHANGE_ME"  > "${SECRETS_DIR}/mds_password.txt"
chmod 600 "${SECRETS_DIR}/db_password.txt"
chmod 600 "${SECRETS_DIR}/mds_password.txt"
log "Placeholder secrets written (operator must update these!)"

# ── 4. Make all helper scripts executable ─────────────────────────────────────
BIN_DIR="${TARGET_DIR}/opt/san-platform/bin"
chmod +x "${BIN_DIR}"/*.sh 2>/dev/null || true
log "Helper scripts made executable"

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

# ── 6. SSH host-key generation on first boot ──────────────────────────────────
if [ -d "${TARGET_DIR}/etc/ssh" ]; then
    mkdir -p "${TARGET_DIR}/etc/systemd/system"
    cat > "${TARGET_DIR}/etc/systemd/system/ssh-keygen-firstboot.service" << 'SSH_SVC'
[Unit]
Description=Generate SSH host keys on first boot
ConditionPathExists=!/etc/ssh/ssh_host_rsa_key
Before=ssh.service

[Service]
Type=oneshot
ExecStart=/usr/bin/ssh-keygen -A
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
SSH_SVC
    ln -sfn /etc/systemd/system/ssh-keygen-firstboot.service \
        "${WANTS_DIR}/ssh-keygen-firstboot.service"
    log "SSH host-key generation service enabled"
fi

# ── 7. MOTD ───────────────────────────────────────────────────────────────────
cat > "${TARGET_DIR}/etc/motd" << 'MOTD'

  ╔══════════════════════════════════════════════════════╗
  ║          SAN Management Platform Appliance           ║
  ╚══════════════════════════════════════════════════════╝

  Web UI  →  http://<this-vm-ip>:8080
  Login   →  admin / Admin1234!  (CHANGE IMMEDIATELY)

  Manage the stack:
    systemctl status  san-platform
    systemctl restart san-platform
    docker compose -f /opt/san-platform/docker-compose.yml ps

  Change secrets:
    vi /opt/san-platform/secrets/db_password.txt
    vi /opt/san-platform/secrets/mds_password.txt
    systemctl restart san-platform

MOTD

# ── 8. Copy kernel to /boot on rootfs ────────────────────────────────────────
# GRUB EFI loads the kernel from /boot/bzImage on the root (ext4) partition.
# Buildroot places bzImage in BINARIES_DIR (output/images/), not in TARGET_DIR.
# We copy it here so it ends up in the root filesystem image.
mkdir -p "${TARGET_DIR}/boot"
if [ -n "${BINARIES_DIR:-}" ] && [ -f "${BINARIES_DIR}/bzImage" ]; then
    cp "${BINARIES_DIR}/bzImage" "${TARGET_DIR}/boot/bzImage"
    log "Copied bzImage to /boot"
else
    # BINARIES_DIR may not be set during post-build; bzImage copied in post-image
    log "bzImage not yet available in BINARIES_DIR — will be handled in post-image.sh"
fi

log "post-build.sh completed successfully"
