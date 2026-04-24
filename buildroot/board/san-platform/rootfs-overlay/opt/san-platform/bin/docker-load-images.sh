#!/bin/sh
# =============================================================================
# /opt/san-platform/bin/docker-load-images.sh
#
# Imports pre-bundled Docker image tarballs into the local Docker daemon.
# Called once on first boot by san-platform-load.service.
#
# After successful import a stamp file is written so subsequent boots
# skip this step entirely (fast path).
# =============================================================================
set -e

IMAGES_DIR="/opt/san-platform/images"
STAMP_DIR="/var/lib/san-platform"
STAMP_FILE="${STAMP_DIR}/.images-loaded"

log() { echo "[san-platform-load] $*"; }

mkdir -p "${STAMP_DIR}"

log "Loading Docker images from ${IMAGES_DIR}…"

for tarball in "${IMAGES_DIR}"/*.tar.gz; do
    [ -f "${tarball}" ] || continue
    name=$(basename "${tarball}" .tar.gz)
    log "  docker load < ${name}.tar.gz"
    docker load < "${tarball}"
done

log "All images loaded successfully."

# Write stamp so systemd ConditionPathExists=! skips us on next boot
date -u > "${STAMP_FILE}"
log "Stamp written to ${STAMP_FILE}"
