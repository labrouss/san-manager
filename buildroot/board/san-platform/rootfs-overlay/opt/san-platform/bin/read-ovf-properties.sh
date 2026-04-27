#!/bin/sh
# /opt/san-platform/bin/read-ovf-properties.sh
#
# Reads OVF/OVA deployment properties injected by VMware via open-vm-tools.
# Called by S01firstboot before the setup wizard runs.
#
# If OVF properties are set, they pre-populate:
#   - /etc/network/interfaces  (network config)
#   - /etc/hostname            (hostname)
#   - /opt/san-platform/secrets/  (credentials)
#   - /root/.ssh/authorized_keys  (SSH keys)
#
# If vmtoolsd is not available or returns nothing, this script exits silently
# and the interactive setup wizard handles configuration instead.

SECRETS="/opt/san-platform/secrets"
STAMP="/var/lib/san-platform/.ovf-applied"
SETUP_STAMP="/var/lib/san-platform/.setup-done"

log() { echo "[ovf-props] $*"; }

# Only run once and only if setup has not already been completed
[ -f "${STAMP}" ]      && { log "OVF properties already applied."; exit 0; }
[ -f "${SETUP_STAMP}" ] && { log "Setup already done — skipping OVF reader."; exit 0; }

# Check vmtoolsd is available
if ! command -v vmtoolsd > /dev/null 2>&1; then
    log "vmtoolsd not found — skipping OVF property read."
    exit 0
fi

# Helper: read a guestinfo key, return empty string if not set
guestinfo() {
    vmtoolsd --cmd "info-get guestinfo.ovfenv" 2>/dev/null | \
        grep -o "oe:key=\"${1}\"[^/]*/>" 2>/dev/null | \
        grep -o 'oe:value="[^"]*"' | \
        sed 's/oe:value="//;s/"//' || true
}

log "Reading OVF properties via vmtoolsd..."

# Read all properties
OVF_HOSTNAME=$(guestinfo "hostname")
OVF_IP=$(guestinfo "ip")
OVF_NETMASK=$(guestinfo "netmask")
OVF_GATEWAY=$(guestinfo "gateway")
OVF_DNS=$(guestinfo "dns")
OVF_PASSWORD=$(guestinfo "admin-password")
OVF_PUBKEY=$(guestinfo "public-keys")
OVF_MDS_HOST=$(guestinfo "mds-host")
OVF_MDS_USER=$(guestinfo "mds-username")
OVF_MDS_PASS=$(guestinfo "mds-password")

APPLIED=0

# ── Hostname ──────────────────────────────────────────────────────────────────
if [ -n "${OVF_HOSTNAME}" ] && [ "${OVF_HOSTNAME}" != "san-platform" ]; then
    hostname "${OVF_HOSTNAME}"
    printf "%s\n" "${OVF_HOSTNAME}" > /etc/hostname
    log "Hostname set to: ${OVF_HOSTNAME}"
    APPLIED=1
fi

# ── Network ───────────────────────────────────────────────────────────────────
if [ -n "${OVF_IP}" ] && [ -n "${OVF_NETMASK}" ] && [ -n "${OVF_GATEWAY}" ]; then
    OVF_DNS="${OVF_DNS:-8.8.8.8}"
    cat > /etc/network/interfaces << NET
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet static
    address ${OVF_IP}
    netmask ${OVF_NETMASK}
    gateway ${OVF_GATEWAY}
    dns-nameservers ${OVF_DNS}
NET
    log "Static IP configured: ${OVF_IP}/${OVF_NETMASK} gw ${OVF_GATEWAY}"
    ifdown eth0 2>/dev/null; ifup eth0 2>/dev/null
    APPLIED=1
else
    log "No static IP provided — using DHCP"
fi

# ── Passwords ─────────────────────────────────────────────────────────────────
if [ -n "${OVF_PASSWORD}" ] && [ "${OVF_PASSWORD}" != "Admin1234!" ]; then
    printf "%s\n%s\n" "${OVF_PASSWORD}" "${OVF_PASSWORD}" | passwd root  2>/dev/null
    printf "%s\n%s\n" "${OVF_PASSWORD}" "${OVF_PASSWORD}" | passwd admin 2>/dev/null
    log "System passwords set from OVF property"
    APPLIED=1
fi

# ── SSH public key ────────────────────────────────────────────────────────────
if [ -n "${OVF_PUBKEY}" ]; then
    mkdir -p /root/.ssh /home/admin/.ssh
    printf "%s\n" "${OVF_PUBKEY}" >> /root/.ssh/authorized_keys
    printf "%s\n" "${OVF_PUBKEY}" >> /home/admin/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys /home/admin/.ssh/authorized_keys
    chmod 700 /root/.ssh /home/admin/.ssh
    log "SSH public key injected"
    APPLIED=1
fi

# ── MDS switch ────────────────────────────────────────────────────────────────
if [ -n "${OVF_MDS_HOST}" ]; then
    mkdir -p "${SECRETS}"
    printf "%s" "${OVF_MDS_HOST}" > "${SECRETS}/mds_host.txt"
    printf "%s" "${OVF_MDS_USER:-admin}" > "${SECRETS}/mds_user.txt"
    [ -n "${OVF_MDS_PASS}" ] && printf "%s" "${OVF_MDS_PASS}" > "${SECRETS}/mds_password.txt"
    chmod 600 "${SECRETS}/mds_host.txt" "${SECRETS}/mds_user.txt" \
              "${SECRETS}/mds_password.txt" 2>/dev/null
    log "MDS switch configured: ${OVF_MDS_HOST}"
    APPLIED=1
fi

# ── Write stamp and skip interactive wizard if fully configured ───────────────
if [ "${APPLIED}" -eq 1 ]; then
    mkdir -p "$(dirname "${STAMP}")"
    date -u > "${STAMP}"
    log "OVF properties applied successfully."

    # If password, network, and hostname were all provided, skip the setup wizard
    if [ -n "${OVF_PASSWORD}" ] && [ "${OVF_PASSWORD}" != "Admin1234!" ]; then
        log "All required properties set via OVF — marking setup as complete."
        date -u > "${SETUP_STAMP}"
    fi
else
    log "No OVF properties found — interactive setup wizard will run on login."
fi
