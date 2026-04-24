#!/bin/sh
# =============================================================================
# /opt/san-platform/bin/firstboot.sh
#
# Executed once on first boot by san-platform-firstboot.service.
#
# Actions:
#   1. Resize partition 2 (rootfs) to fill any extra space the operator
#      may have added to the disk in their hypervisor after importing the OVA.
#   2. Run resize2fs to grow the ext4 filesystem to match.
#   3. Create/format partition 3 (san-data) if it doesn't have an ext4 label.
#   4. Mount partition 3 permanently at /var/lib/san-platform via /etc/fstab.
#   5. Write stamp file so this script never runs again.
# =============================================================================
set -e

STAMP_DIR="/var/lib/san-platform"
STAMP="${STAMP_DIR}/.firstboot-done"

log()  { echo "[san-firstboot] $*"; }
warn() { echo "[san-firstboot] WARN: $*"; }

# ── Detect root device ────────────────────────────────────────────────────────
ROOT_DEV=$(findmnt -n -o SOURCE / | sed 's/p[0-9]*$//')
ROOT_PART=$(findmnt -n -o SOURCE /)
DATA_PART="${ROOT_DEV}p3"

log "Root device  : ${ROOT_DEV}"
log "Root partition: ${ROOT_PART}"
log "Data partition: ${DATA_PART}"

# ── 1. Extend root partition to fill disk (growpart) ──────────────────────────
if command -v growpart >/dev/null 2>&1; then
    log "Running growpart on root partition…"
    growpart "${ROOT_DEV}" 2 || warn "growpart returned non-zero (disk may already be full-size)"
else
    warn "growpart not found — skipping partition resize"
fi

# ── 2. Grow root filesystem ───────────────────────────────────────────────────
log "Running resize2fs on ${ROOT_PART}…"
resize2fs "${ROOT_PART}" || warn "resize2fs returned non-zero"

# ── 3. Format data partition if unformatted ────────────────────────────────────
if [ -b "${DATA_PART}" ]; then
    EXISTING_FS=$(blkid -s TYPE -o value "${DATA_PART}" 2>/dev/null || true)
    if [ -z "${EXISTING_FS}" ]; then
        log "Formatting ${DATA_PART} as ext4 (label: san-data)…"
        mkfs.ext4 -L san-data "${DATA_PART}"
    else
        log "${DATA_PART} already has filesystem: ${EXISTING_FS}"
    fi

    # ── 4. Add fstab entry for persistent data mount ──────────────────────────
    if ! grep -q "san-data" /etc/fstab; then
        log "Adding /etc/fstab entry for san-data partition…"
        echo "LABEL=san-data  /var/lib/san-platform  ext4  defaults,noatime  0 2" >> /etc/fstab
    fi

    # Mount now without rebooting
    mkdir -p /var/lib/san-platform
    mount LABEL=san-data /var/lib/san-platform || warn "mount returned non-zero"
else
    warn "Data partition ${DATA_PART} not found — data will be on rootfs"
fi

# ── 5. Create subdirectories on data partition ────────────────────────────────
mkdir -p /var/lib/san-platform/pg_data
mkdir -p /var/lib/san-platform/logs
chmod 700 /var/lib/san-platform/pg_data

# ── 6. Write stamp ────────────────────────────────────────────────────────────
mkdir -p "${STAMP_DIR}"
date -u > "${STAMP}"
log "First-boot initialization complete. Stamp: ${STAMP}"
