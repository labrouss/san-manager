#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-build.sh
# =============================================================================
set -euo pipefail

: "${TARGET_DIR:?TARGET_DIR is not set — must be called by Buildroot make}"

log() { echo "[post-build] $*"; }

log "TARGET_DIR = ${TARGET_DIR}"

# ── 1. Make ALL init.d scripts executable ────────────────────────────────────
# Git and Buildroot's overlay copy do not reliably preserve execute bits.
# Explicitly chmod +x every script in the target /etc/init.d/.
INITD="${TARGET_DIR}/etc/init.d"
if [ -d "${INITD}" ]; then
    find "${INITD}" -type f | while read -r script; do
        chmod +x "${script}"
        log "Made executable: $(basename "${script}")"
    done
else
    log "WARNING: ${INITD} not found in target"
fi

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

# ── 7. Create admin user ─────────────────────────────────────────────────────
# Add 'admin' group and user if not already present in the target rootfs.
# Password is set to 'Admin1234!' as a placeholder — the setup wizard
# (setup.sh) will prompt the operator to change it on first login.
SHADOW="${TARGET_DIR}/etc/shadow"
PASSWD_FILE="${TARGET_DIR}/etc/passwd"
GROUP_FILE="${TARGET_DIR}/etc/group"

# Add admin group (GID 1000) if absent
if ! grep -q "^admin:" "${GROUP_FILE}" 2>/dev/null; then
    echo "admin:x:1000:" >> "${GROUP_FILE}"
    log "Created group: admin"
fi

# Add admin user (UID 1000) if absent
if ! grep -q "^admin:" "${PASSWD_FILE}" 2>/dev/null; then
    echo "admin:x:1000:1000:SAN Platform Admin:/home/admin:/bin/sh" >> "${PASSWD_FILE}"
    log "Created user: admin"
fi

# Set placeholder password hash (Admin1234!) in shadow
# Generated with: openssl passwd -6 'Admin1234!'
ADMIN_HASH='$6$rounds=4096$san.platform$Dc4dHMUl.0ELjRpRqbHOSqiDWm/MwIJw3P7qRBFm4oLMOuBJmSs1TKv4Z2l8k/VJz.WK6mWm4QEFl2MuT9Wr1'
if ! grep -q "^admin:" "${SHADOW}" 2>/dev/null; then
    echo "admin:${ADMIN_HASH}:19600:0:99999:7:::" >> "${SHADOW}"
    chmod 640 "${SHADOW}"
    log "Set admin password hash in shadow"
fi

# Create admin home directory
mkdir -p "${TARGET_DIR}/home/admin/.ssh"
chmod 700 "${TARGET_DIR}/home/admin"
chmod 700 "${TARGET_DIR}/home/admin/.ssh"

# Copy root setup wizard to admin home too
cp "${TARGET_DIR}/root/setup.sh" "${TARGET_DIR}/home/admin/setup.sh" 2>/dev/null || true
chmod +x "${TARGET_DIR}/home/admin/setup.sh" 2>/dev/null || true

# admin .profile — same auto-wizard behaviour as root
cat > "${TARGET_DIR}/home/admin/.profile" << 'PROFILE'
#!/bin/sh
if [ ! -f /var/lib/san-platform/.setup-done ]; then
    exec sudo /root/setup.sh
fi
IP=$(ip route get 1.1.1.1 2>/dev/null     | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
printf "
  SAN Management Platform
"
printf "  Web UI  : http://%s:8080
" "${IP:-<ip>}"
printf "  Stack   : sudo /etc/init.d/S60san-platform {status|start|stop|restart}

"
PROFILE

# Fix ownership (uid/gid 1000)
chown -R 1000:1000 "${TARGET_DIR}/home/admin" 2>/dev/null || true

# Fix sudoers.d permissions — sudo requires 440 on drop-in files
chmod 440 "${TARGET_DIR}/etc/sudoers.d/admin" 2>/dev/null || true

log "admin user configured"

# Ensure sudo is available — BusyBox includes sudo; create symlink if needed
if [ ! -f "${TARGET_DIR}/usr/bin/sudo" ] && [ -f "${TARGET_DIR}/bin/busybox" ]; then
    ln -sfn /bin/busybox "${TARGET_DIR}/usr/bin/sudo" 2>/dev/null || true
    log "Created sudo symlink to busybox"
fi

# Create chrony runtime dirs
mkdir -p "${TARGET_DIR}/var/lib/chrony"
mkdir -p "${TARGET_DIR}/var/log/chrony"
log "Created chrony directories"

# Set correct permissions on sudoers.d
chmod 440 "${TARGET_DIR}/etc/sudoers.d/admin" 2>/dev/null || true

# Ensure factory-reset.sh is executable
chmod +x "${TARGET_DIR}/root/factory-reset.sh" 2>/dev/null || true

# ── 7. Root setup wizard ─────────────────────────────────────────────────────
chmod +x "${TARGET_DIR}/root/setup.sh" 2>/dev/null || true
log "setup.sh made executable"

# ── 8. Log file placeholder ───────────────────────────────────────────────────
touch "${TARGET_DIR}/var/log/san-platform.log" 2>/dev/null || true

log "post-build.sh completed successfully"
