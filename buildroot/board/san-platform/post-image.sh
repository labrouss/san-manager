#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-image.sh
#
# Runs after all filesystem images are built.
# Uses genimage to assemble the final raw disk image with:
#
#   Partition layout (GPT):
#   ┌─────────────────────────────────────────────────────────┐
#   │ Part 1  FAT32 EFI   256 MiB  /boot/efi  (GRUB EFI)     │
#   │ Part 2  ext4        3072 MiB /            (root)        │
#   │ Part 3  ext4        4096 MiB /var/lib/san-platform (data│
#   └─────────────────────────────────────────────────────────┘
#
# Output: output/images/disk.img
# =============================================================================
set -euo pipefail

BINARIES_DIR="${1}"       # output/images/
TARGET_DIR="${2}"         # output/target/  (unused here but available)
GENIMAGE_TMP="${BUILD_DIR:-/tmp}/genimage.tmp"

log() { echo "[post-image] $*"; }

# ── Write genimage.cfg ────────────────────────────────────────────────────────
GENIMAGE_CFG="${BINARIES_DIR}/genimage.cfg"

cat > "${GENIMAGE_CFG}" << 'GENIMAGE'
image efi.vfat {
    vfat {
        label = "EFI"
        files = {
            "EFI"
        }
    }
    size = 256M
}

image rootfs.ext4 {
    ext4 {}
    # size is set by BR2_TARGET_ROOTFS_EXT2_SIZE (3072M)
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
        image = "efi.vfat"
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
GENIMAGE

log "genimage.cfg written"

# ── Prepare EFI directory in BINARIES_DIR ─────────────────────────────────────
if [ -d "${BINARIES_DIR}/efi-part" ]; then
    cp -r "${BINARIES_DIR}/efi-part/." "${BINARIES_DIR}/EFI/"
fi

# ── Run genimage ──────────────────────────────────────────────────────────────
rm -rf "${GENIMAGE_TMP}"

log "Running genimage…"
genimage \
    --config   "${GENIMAGE_CFG}" \
    --rootpath "${TARGET_DIR}" \
    --tmppath  "${GENIMAGE_TMP}" \
    --inputpath "${BINARIES_DIR}" \
    --outputpath "${BINARIES_DIR}"

log "Disk image created: ${BINARIES_DIR}/disk.img"
ls -lh "${BINARIES_DIR}/disk.img"

log "post-image.sh completed"
