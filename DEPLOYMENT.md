# SAN Platform — OVA Build System

This directory contains the GitHub Actions workflows and Buildroot board
support package that turn the `san-platform` Docker Compose application into
a self-contained, bootable **OVA appliance**.

---

## Directory layout

```
.
├── .github/
│   └── workflows/
│       ├── build-ova.yml     # Main pipeline: builds images → Buildroot OVA → GitHub Release
│       └── ci.yml            # Fast CI: lint, tests, docker build validation
│
├── buildroot/
│   ├── Config.in             # BR2_EXTERNAL stub
│   ├── external.desc         # BR2_EXTERNAL metadata
│   ├── external.mk           # BR2_EXTERNAL package include
│   │
│   ├── configs/
│   │   └── san_platform_defconfig   # Buildroot defconfig (arch, kernel, packages)
│   │
│   └── board/san-platform/
│       ├── linux-docker.fragment    # Kernel config additions for Docker/cgroups/overlay
│       ├── post-build.sh            # Run after rootfs assembly (enable services, etc.)
│       ├── post-image.sh            # Run after images built (genimage → disk.img)
│       │
│       └── rootfs-overlay/          # Merged verbatim into the target rootfs
│           ├── etc/
│           │   ├── docker/daemon.json
│           │   ├── systemd/
│           │   │   ├── network/10-eth0.network
│           │   │   └── system/
│           │   │       ├── san-platform.service          # docker compose up on boot
│           │   │       ├── san-platform-load.service     # load image tarballs once
│           │   │       └── san-platform-firstboot.service # resize + format on first boot
│           │   └── tmpfiles.d/san-platform.conf
│           │
│           └── opt/san-platform/
│               ├── docker-compose.yml    # Production compose (no build:, uses saved images)
│               ├── images/               # CI copies backend.tar.gz + frontend.tar.gz here
│               ├── secrets/              # Placeholder creds (operator must change)
│               └── bin/
│                   ├── docker-load-images.sh    # Import tarballs into Docker on first boot
│                   ├── write-runtime-env.sh     # Generate .env with current IP + secrets
│                   ├── firstboot.sh             # Resize root FS + format data partition
│                   └── san-platform-configure   # Interactive config helper for operators
│
└── scripts/
    └── pack-ova.sh    # Converts raw disk image → VMDK → OVA (used by CI)
```

---

## How the pipeline works

### Trigger conditions

| Event | Workflow |
|-------|----------|
| Push to any branch | `ci.yml` (lint + tests + docker build) |
| Push to `main` or `release/**` | `build-ova.yml` (full OVA build) |
| Push a `v*.*.*` tag | `build-ova.yml` + GitHub Release creation |
| `workflow_dispatch` | `build-ova.yml` (manual trigger with version input) |

### Pipeline stages (`build-ova.yml`)

```
┌─────────────────────────────────────────────────────────────────┐
│  Job 1: build-images (ubuntu-latest, ~15 min)                   │
│                                                                 │
│  ① docker buildx build backend/  → san-platform/backend:latest │
│  ② docker buildx build frontend/ → san-platform/frontend:latest│
│  ③ docker save | gzip → backend.tar.gz, frontend.tar.gz        │
│  ④ upload-artifact (docker-images-<version>)                   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Job 2: build-ova (ubuntu-latest, ~120 min)                     │
│                                                                 │
│  ① Restore Buildroot DL cache + ccache                         │
│  ② Download Buildroot 2024.02.x tarball                        │
│  ③ Merge buildroot/ overlay into Buildroot source tree         │
│  ④ Copy Docker image tarballs → rootfs-overlay/opt/.../images/ │
│  ⑤ make san_platform_defconfig && make all                     │
│     → output/images/disk.img  (raw GPT disk image)             │
│  ⑥ scripts/pack-ova.sh: qemu-img convert → VMDK               │
│  ⑦ Assemble OVA (ovftool or manual tar)                        │
│  ⑧ upload-artifact (san-platform-<version>.ova)               │
└──────────────────────────┬──────────────────────────────────────┘
                           │ (tags only)
┌──────────────────────────▼──────────────────────────────────────┐
│  Job 3: release (ubuntu-latest, ~2 min)                         │
│                                                                 │
│  ① Download OVA artifact                                        │
│  ② Compute SHA256 + generate release notes                     │
│  ③ softprops/action-gh-release → GitHub Release with OVA asset │
└─────────────────────────────────────────────────────────────────┘
```

### Boot sequence on the VM

```
BIOS/UEFI → GRUB2
  → Linux 6.6 LTS kernel
    → systemd (PID 1)
      → san-platform-firstboot.service  (once: resize FS, format data partition)
      → docker.service                   (containerd → dockerd)
      → san-platform-load.service        (once: docker load backend+frontend tarballs)
      → san-platform.service             (every boot: docker compose up -d)
        → san-db       (timescaledb)
        → san-backend  (express + prisma + mds poller)
        → san-frontend (nginx + react SPA)
```

---

## Required GitHub Secrets

Set in **Settings → Secrets and variables → Actions**:

| Secret | Required | Purpose |
|--------|----------|---------|
| `DOCKER_USERNAME` | Optional | Docker Hub login (avoids pull rate limits) |
| `DOCKER_TOKEN` | Optional | Docker Hub PAT |

No secrets are required for the build itself — the Docker images are built
from source, not pulled.

---

## Releasing a new version

```bash
# Tag the release
git tag v1.2.3
git push origin v1.2.3

# The pipeline runs automatically and creates a GitHub Release with:
#   san-platform-v1.2.3.ova
```

---

## Deploying the OVA

### VMware ESXi / vSphere
1. **Deploy OVF Template** → select `san-platform-<version>.ova`
2. Configure network (DHCP by default)
3. Power on
4. Wait ~2 minutes for Docker Compose to initialize
5. Browse to `http://<vm-ip>:8080`

### VMware Workstation / Fusion
File → Import → select the OVA

### VirtualBox
File → Import Appliance → select the OVA

### First-boot configuration (change default passwords!)
```bash
# SSH into the appliance
ssh root@<vm-ip>

# Run the interactive configurator
/opt/san-platform/bin/san-platform-configure
```

---

## Disk layout (in the OVA)

| Partition | Filesystem | Size | Mount | Purpose |
|-----------|-----------|------|-------|---------|
| 1 (EFI)  | FAT32 | 256 MiB | /boot/efi | GRUB2 EFI |
| 2 (root) | ext4 | 3 GiB | / | OS + Docker images |
| 3 (data) | ext4 | 4 GiB | /var/lib/san-platform | pg_data + logs |

The data partition is bind-mounted into Docker as named volumes, so your
TimescaleDB data and backend logs survive OS upgrades.

---

## Customising the build

### Change Buildroot version
Pass `buildroot_version` via `workflow_dispatch`, or update the default in
`build-ova.yml`:
```yaml
env:
  BUILDROOT_VERSION: "2024.02.9"
```

### Add extra packages
Edit `buildroot/configs/san_platform_defconfig`:
```
BR2_PACKAGE_HTOP=y
BR2_PACKAGE_TCPDUMP=y
```

### Change disk sizes
Edit the env vars in `build-ova.yml`:
```yaml
env:
  DISK_SIZE_MB: 16384   # 16 GiB total
  ROOT_SIZE_MB: 6144    # 6 GiB root
  DATA_SIZE_MB: 8192    # 8 GiB data
```
Also update `BR2_TARGET_ROOTFS_EXT2_SIZE` in the defconfig to match `ROOT_SIZE_MB`.

### Add a third Docker image (e.g. for air-gapped TimescaleDB)
1. Export the image: `docker save timescale/timescaledb:latest-pg16 | gzip > timescale.tar.gz`
2. Add it to the `Export Docker images as tarballs` step in `build-ova.yml`
3. Add it to `docker-load-images.sh`
4. Remove the `image:` pull reference in the appliance `docker-compose.yml`
