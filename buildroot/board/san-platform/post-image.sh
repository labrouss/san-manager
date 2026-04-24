#!/bin/bash
# =============================================================================
# buildroot/board/san-platform/post-image.sh
#
# Called by Buildroot after all images are built.
# Runs genimage using the static genimage.cfg to produce disk.img.
#
# Buildroot exports these environment variables:
#   BINARIES_DIR  — output/images/   (input files + output destination)
#   TARGET_DIR    — output/target/   (rootfs tree, used as rootpath)
#   BUILD_DIR     — output/build/    (used for genimage tmp dir)
#
# Output: ${BINARIES_DIR}/disk.img
# =============================================================================
set -euo pipefail

: "${BINARIES_DIR:?BINARIES_DIR not set — must be called by Buildroot}"
: "${TARGET_DIR:?TARGET_DIR not set — must be called by Buildroot}"
: "${BUILD_DIR:?BUILD_DIR not set — must be called by Buildroot}"

BOARD_DIR="$(dirname "$(realpath "$0")")"
GENIMAGE_CFG="${BOARD_DIR}/genimage.cfg"
GENIMAGE_TMP="${BUILD_DIR}/genimage.tmp"

log() { echo "[post-image] $*"; }

log "BINARIES_DIR = ${BINARIES_DIR}"
log "BOARD_DIR    = ${BOARD_DIR}"
log "GENIMAGE_CFG = ${GENIMAGE_CFG}"

[ -f "${GENIMAGE_CFG}" ] || {
    echo "[post-image] ERROR: genimage.cfg not found at ${GENIMAGE_CFG}"
    exit 1
}

# GRUB2 EFI produces an EFI/ directory in BINARIES_DIR.
# Log what's available so failures are easy to diagnose.
log "Files in BINARIES_DIR before genimage:"
ls -lh "${BINARIES_DIR}"

# Clean up any previous genimage tmp dir
rm -rf "${GENIMAGE_TMP}"

log "Running genimage..."
genimage \
    --config    "${GENIMAGE_CFG}" \
    --rootpath  "${TARGET_DIR}" \
    --tmppath   "${GENIMAGE_TMP}" \
    --inputpath "${BINARIES_DIR}" \
    --outputpath "${BINARIES_DIR}"

log "disk.img created:"
ls -lh "${BINARIES_DIR}/disk.img"
