#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-image.sh
#
# Runs after Buildroot's make all. Performs three tasks:
#
#  1. Rebuilds bootx64.efi using grub-mkstandalone with all required modules
#     baked in directly from Buildroot's grub2 build output. This is the
#     reliable way to embed modules — BR2_TARGET_GRUB2_BUILTIN_MODULES_EFI
#     only controls what grub-mkimage is told to embed at Buildroot's own
#     build time, which can be overridden or be insufficient. By running
#     grub-mkstandalone ourselves we have full control.
#
#  2. Injects bzImage into rootfs.ext4 at /boot/bzImage so GRUB can load it.
#
#  3. Runs genimage to assemble the final disk.img.
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
die() { echo "[post-image] ERROR: $*" >&2; exit 1; }

log "=== BINARIES_DIR contents ==="
find "${BINARIES_DIR}" | sort
log "==="

# ── Prerequisites ─────────────────────────────────────────────────────────────
[ -f "${BINARIES_DIR}/rootfs.ext4" ] || die "rootfs.ext4 missing"
[ -f "${BINARIES_DIR}/bzImage" ]     || die "bzImage missing"

# Buildroot builds GRUB2 modules into output/build/grub2-*/build-x86_64-efi/
GRUB_BUILD_DIR=$(find "${BUILD_DIR}" -maxdepth 1 -name "grub2-*" -type d | head -1)
[ -n "${GRUB_BUILD_DIR}" ] || die "grub2 build dir not found in ${BUILD_DIR}"

GRUB_MODDIR="${GRUB_BUILD_DIR}/build-x86_64-efi/grub-core"
[ -d "${GRUB_MODDIR}" ] || die "GRUB2 module dir not found: ${GRUB_MODDIR}"

GRUB_MKSTANDALONE="${BUILD_DIR}/../host/bin/grub-mkstandalone"
[ -f "${GRUB_MKSTANDALONE}" ] || die "grub-mkstandalone not found at ${GRUB_MKSTANDALONE}"

log "GRUB2 build dir : ${GRUB_BUILD_DIR}"
log "GRUB2 module dir: ${GRUB_MODDIR}"
log "grub-mkstandalone: ${GRUB_MKSTANDALONE}"

log "Available modules in GRUB build:"
find "${GRUB_MODDIR}" -name "*.mod" -exec basename {} .mod \; | sort | tr '\n' ' '
echo ""

# ── Step 1: Rebuild bootx64.efi with all required modules baked in ────────────
# grub-mkstandalone creates a self-contained EFI binary that includes:
#   - The specified modules (--modules)
#   - Our grub.cfg embedded as /boot/grub/grub.cfg inside the memdisk
# The result is placed directly in the EFI partition directory.

GRUB_CFG_SRC="${SCRIPT_DIR}/grub/grub.cfg"
[ -f "${GRUB_CFG_SRC}" ] || die "grub.cfg not found at ${GRUB_CFG_SRC}"

EFI_BOOT_DIR="${BINARIES_DIR}/efi-part/EFI/BOOT"
mkdir -p "${EFI_BOOT_DIR}"

log "Building bootx64.efi with grub-mkstandalone..."
"${GRUB_MKSTANDALONE}" \
    --format=x86_64-efi \
    --directory="${GRUB_MODDIR}" \
    --modules="boot linux part_gpt part_msdos fat ext2 normal echo configfile search search_fs_uuid search_fs_file search_label ls cat reboot halt gfxterm font video all_video" \
    --output="${EFI_BOOT_DIR}/bootx64.efi" \
    "boot/grub/grub.cfg=${GRUB_CFG_SRC}"

EFI_SIZE=$(stat -c '%s' "${EFI_BOOT_DIR}/bootx64.efi")
log "bootx64.efi built: $(numfmt --to=iec "${EFI_SIZE}") (should be several MB, not 626KB)"

# Verify linux module is present by checking strings in the binary
if strings "${EFI_BOOT_DIR}/bootx64.efi" | grep -q "^linux$"; then
    log "✓ 'linux' command confirmed present in bootx64.efi"
else
    log "WARNING: 'linux' command not found in bootx64.efi strings — boot may fail"
fi

# ── Step 2: Inject bzImage into rootfs.ext4 ───────────────────────────────────
if debugfs -R "stat /boot/bzImage" "${BINARIES_DIR}/rootfs.ext4" 2>/dev/null \
        | grep -q "Type: regular"; then
    log "bzImage already present in rootfs.ext4"
else
    log "Injecting bzImage into rootfs.ext4 at /boot/bzImage..."
    debugfs -w -R "mkdir /boot" "${BINARIES_DIR}/rootfs.ext4" 2>/dev/null || true
    debugfs -w -R "write ${BINARIES_DIR}/bzImage /boot/bzImage" \
        "${BINARIES_DIR}/rootfs.ext4"
    log "bzImage injected"
fi

# ── Step 3: Build disk.img via genimage ───────────────────────────────────────
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

rm -rf "${GENIMAGE_TMP}"
log "Running genimage..."
genimage \
    --config     "${GENIMAGE_CFG}" \
    --rootpath   "${TARGET_DIR}" \
    --tmppath    "${GENIMAGE_TMP}" \
    --inputpath  "${BINARIES_DIR}" \
    --outputpath "${BINARIES_DIR}" \
    2>&1 | tee /tmp/genimage.log

log "disk.img: $(ls -lh "${BINARIES_DIR}/disk.img")"
log "post-image.sh complete"
