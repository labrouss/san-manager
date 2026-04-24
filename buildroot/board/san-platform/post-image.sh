#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-image.sh
# Produces disk.img via genimage. Called by Buildroot after make all.
# Buildroot exports: BINARIES_DIR, TARGET_DIR, BUILD_DIR
# =============================================================================
set -euo pipefail

: "${BINARIES_DIR:?BINARIES_DIR not set}"
: "${TARGET_DIR:?TARGET_DIR not set}"
: "${BUILD_DIR:?BUILD_DIR not set}"

GENIMAGE_TMP="${BUILD_DIR}/genimage.tmp"

log()  { echo "[post-image] $*"; }
die()  { echo "[post-image] ERROR: $*" >&2; exit 1; }

log "=== BINARIES_DIR full contents ==="
find "${BINARIES_DIR}" | sort
log "=== end ==="

# ── Validate required inputs ──────────────────────────────────────────────────
[ -d "${BINARIES_DIR}/efi-part/EFI" ] \
    || die "efi-part/EFI directory missing — GRUB2 EFI build failed"

# rootfs.ext4 is produced by BR2_TARGET_ROOTFS_EXT2=y + BR2_TARGET_ROOTFS_EXT2_4=y
[ -f "${BINARIES_DIR}/rootfs.ext4" ] \
    || die "rootfs.ext4 missing — ext4 rootfs build failed. Files: $(ls "${BINARIES_DIR}")"

# ── Write genimage.cfg ────────────────────────────────────────────────────────
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

log "genimage.cfg written"

# ── Run genimage — capture stdout+stderr ──────────────────────────────────────
rm -rf "${GENIMAGE_TMP}"

log "Running genimage..."
genimage \
    --config     "${GENIMAGE_CFG}" \
    --rootpath   "${TARGET_DIR}" \
    --tmppath    "${GENIMAGE_TMP}" \
    --inputpath  "${BINARIES_DIR}" \
    --outputpath "${BINARIES_DIR}" \
    2>&1 | tee /tmp/genimage.log

GENIMAGE_EXIT="${PIPESTATUS[0]}"
if [ "${GENIMAGE_EXIT}" -ne 0 ]; then
    log "genimage failed (exit ${GENIMAGE_EXIT}):"
    cat /tmp/genimage.log >&2
    exit "${GENIMAGE_EXIT}"
fi

log "=== Output ==="
ls -lh "${BINARIES_DIR}/disk.img"
log "post-image.sh complete"
