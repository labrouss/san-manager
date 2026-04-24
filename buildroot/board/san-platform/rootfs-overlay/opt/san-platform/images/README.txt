This directory is intentionally empty in the repository.

The CI pipeline (build-ova.yml) copies the built Docker image tarballs here
at build time:

  backend.tar.gz   — san-platform/backend:latest
  frontend.tar.gz  — san-platform/frontend:latest

The timescale/timescaledb image is pulled at first boot by docker-compose
(it requires network access on first run). If you need a fully air-gapped
appliance, add a third tarball here and reference it in docker-load-images.sh.
