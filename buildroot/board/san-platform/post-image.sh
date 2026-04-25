#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-image.sh
#
# Called by Buildroot after all images are built. Produces disk.img via genimage.
# Also ensures bzImage is in TARGET_DIR/boot and deploys our grub.cfg.
#
# Buildroot exports: BINARIES_DIR, TARGET_DIR, BUILD_DIR
# =============================================================================
set -euo pipefail

: "${BINARIES_DIR:?BINARIES_DIR not set}"
: "${TARGET_DIR:?TARGET_DIR not set}"
: "${BUILD_DIR:?BUILD_DIR not set}"

SCRIPT_DIR="$(dirname "$(realpath "$0")")"
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
    log "ERROR: rootfs.ext4 missing"
    log "Files: $(ls "${BINARIES_DIR}")"
    exit 1
}
[ -f "${BINARIES_DIR}/bzImage" ] || {
    log "ERROR: bzImage missing from ${BINARIES_DIR}"
    exit 1
}

# ── Copy bzImage into the rootfs ext4 image ───────────────────────────────────
# We need bzImage at /boot/bzImage inside the ext4 rootfs so GRUB can load it.
# post-build.sh already tries to do this, but BINARIES_DIR may not be set
# during post-build. We use debugfs here to inject it directly into the image.
if debugfs -R "stat /boot/bzImage" "${BINARIES_DIR}/rootfs.ext4" 2>/dev/null | grep -q "Type: regular"; then
    log "bzImage already present in rootfs.ext4 — skipping injection"
else
    log "Injecting bzImage into rootfs.ext4 at /boot/bzImage..."
    # Ensure /boot directory exists in image
    debugfs -w -R "mkdir /boot" "${BINARIES_DIR}/rootfs.ext4" 2>/dev/null || true
    debugfs -w -R "write ${BINARIES_DIR}/bzImage /boot/bzImage" \
        "${BINARIES_DIR}/rootfs.ext4"
    log "bzImage injected"
fi

# ── Deploy our grub.cfg to the EFI partition ──────────────────────────────────
# Buildroot's GRUB2 generates a minimal grub.cfg that won't boot our setup.
# Replace it with our board-specific config.
GRUB_CFG_SRC="${SCRIPT_DIR}/grub/grub.cfg"
GRUB_CFG_DEST="${BINARIES_DIR}/efi-part/EFI/BOOT/grub.cfg"

if [ -f "${GRUB_CFG_SRC}" ]; then
    cp "${GRUB_CFG_SRC}" "${GRUB_CFG_DEST}"
    log "Deployed grub.cfg to EFI partition"
    log "grub.cfg contents:"
    cat "${GRUB_CFG_DEST}"
else
    log "WARNING: ${GRUB_CFG_SRC} not found — using Buildroot default grub.cfg"
fi

# ── Regenerate efi-part.vfat with updated grub.cfg ───────────────────────────
# The vfat image was already built by Buildroot before post-image runs.
# We need to update it with our new grub.cfg using mcopy.
if [ -f "${BINARIES_DIR}/efi-part.vfat" ]; then
    log "Updating efi-part.vfat with new grub.cfg..."
    MTOOLS_SKIP_CHECK=1 mcopy -o -i "${BINARIES_DIR}/efi-part.vfat" \
        "${GRUB_CFG_DEST}" "::EFI/BOOT/grub.cfg" 2>/dev/null || {
        log "mcopy failed — rebuilding efi-part.vfat from scratch"
        rm -f "${BINARIES_DIR}/efi-part.vfat"
    }
fi

# If vfat doesn't exist or mcopy failed, genimage will recreate it
# from the efi-part/ directory which now has our grub.cfg

# ── Write genimage.cfg ────────────────────────────────────────────────────────
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
