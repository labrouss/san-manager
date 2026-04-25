#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-image.sh
#
# Called by Buildroot after all images are built. Produces disk.img via genimage.
#
# Buildroot exports: BINARIES_DIR, TARGET_DIR, BUILD_DIR
# =============================================================================
set -euo pipefail

: "${BINARIES_DIR:?BINARIES_DIR not set}"
: "${TARGET_DIR:?TARGET_DIR not set}"
: "${BUILD_DIR:?BUILD_DIR not set}"

GENIMAGE_TMP="${BUILD_DIR}/genimage.tmp"

log() { echo "[post-image] $*"; }

log "=== BINARIES_DIR full contents ==="
find "${BINARIES_DIR}" | sort
log "=== end ==="

# ── Verify prerequisites ──────────────────────────────────────────────────────
[ -d "${BINARIES_DIR}/efi-part/EFI" ] || {
    log "ERROR: EFI directory not found at ${BINARIES_DIR}/efi-part/EFI"
    exit 1
}
[ -f "${BINARIES_DIR}/rootfs.ext4" ] || {
    log "ERROR: rootfs.ext4 missing — ext4 rootfs build failed."
    log "Files: $(ls "${BINARIES_DIR}")"
    exit 1
}

# ── Write genimage.cfg ────────────────────────────────────────────────────────
# Notes:
#   - 'partition-table-type = "gpt"' replaces deprecated 'gpt = true'
#   - The data partition is intentionally omitted here: it is empty and
#     created/formatted on first boot by firstboot.sh. genimage cannot
#     create an empty ext4 without genext2fs copying rootpath content into
#     it, which is not what we want for a separate data partition.
#     The data partition is added to fstab by firstboot.sh at runtime.
GENIMAGE_CFG="${BINARIES_DIR}/genimage.cfg"
cat > "${GENIMAGE_CFG}" << 'GENCFG'
image efi-part.vfat {
    vfat {
        label = "EFI"
        files = {
            "efi-part/EFI"
        }
    }
    size = 256M
}

image disk.img {
    hdimage {
        partition-table-type = "gpt"
    }

    partition efi {
        partition-type-uuid = "C12A7328-F81F-11D2-BA4B-00A0C93EC93B"
        bootable = true
        image = "efi-part.vfat"
    }

    partition rootfs {
        partition-type-uuid = "0FC63DAF-8483-4772-8E79-3D69D8477DE4"
        image = "rootfs.ext4"
    }
}
GENCFG

log "genimage.cfg written"

# ── Run genimage ──────────────────────────────────────────────────────────────
rm -rf "${GENIMAGE_TMP}"

log "Running genimage..."
genimage \
    --config     "${GENIMAGE_CFG}" \
    --rootpath   "${TARGET_DIR}" \
    --tmppath    "${GENIMAGE_TMP}" \
    --inputpath  "${BINARIES_DIR}" \
    --outputpath "${BINARIES_DIR}" \
    2>&1 | tee /tmp/genimage.log

log "=== Output ==="
ls -lh "${BINARIES_DIR}/disk.img"
log "post-image.sh complete"
