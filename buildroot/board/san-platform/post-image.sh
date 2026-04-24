#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-image.sh
#
# Called by Buildroot after all images are built.
# Produces disk.img via genimage.
#
# Buildroot exports: BINARIES_DIR, TARGET_DIR, BUILD_DIR
# =============================================================================
set -euo pipefail

: "${BINARIES_DIR:?BINARIES_DIR not set}"
: "${TARGET_DIR:?TARGET_DIR not set}"
: "${BUILD_DIR:?BUILD_DIR not set}"

GENIMAGE_TMP="${BUILD_DIR}/genimage.tmp"

log() { echo "[post-image] $*"; }

log "=== BINARIES_DIR contents ==="
find "${BINARIES_DIR}" | sort
log "=== end ==="

# ── Locate the EFI directory produced by GRUB2 ───────────────────────────────
# Buildroot GRUB2 EFI puts its output in BINARIES_DIR/efi-part/EFI/
# genimage needs files listed relative to --inputpath (BINARIES_DIR)
EFI_DIR="${BINARIES_DIR}/efi-part"
if [ ! -d "${EFI_DIR}" ]; then
    log "ERROR: EFI directory not found at ${EFI_DIR}"
    log "GRUB2 EFI build may have failed"
    exit 1
fi

# ── Write genimage.cfg referencing actual paths ───────────────────────────────
GENIMAGE_CFG="${BINARIES_DIR}/genimage.cfg"
cat > "${GENIMAGE_CFG}" << GENCFG
image efi-part.vfat {
    vfat {
        label = "EFI"
        files = {
            "efi-part/EFI"
        }
    }
    size = 256M
}

image data.ext4 {
    ext4 {
        label = "san-data"
    }
    size = 4096M
}

image disk.img {
    hdimage {
        gpt = true
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

    partition data {
        partition-type-uuid = "0FC63DAF-8483-4772-8E79-3D69D8477DE4"
        image = "data.ext4"
    }
}
GENCFG

log "genimage.cfg written to ${GENIMAGE_CFG}"

# ── Run genimage ──────────────────────────────────────────────────────────────
rm -rf "${GENIMAGE_TMP}"

log "Running genimage..."
genimage \
    --config     "${GENIMAGE_CFG}" \
    --rootpath   "${TARGET_DIR}" \
    --tmppath    "${GENIMAGE_TMP}" \
    --inputpath  "${BINARIES_DIR}" \
    --outputpath "${BINARIES_DIR}"

log "=== Output ==="
ls -lh "${BINARIES_DIR}/disk.img"
log "post-image.sh complete"
