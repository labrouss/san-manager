#!/usr/bin/env bash
# =============================================================================
# scripts/pack-ova.sh
# Converts a raw disk image to an OVA importable by VMware Workstation/ESXi.
#
# Usage: pack-ova.sh <raw-disk.img> <output.ova> <version> <disk-size-mb>
#
# OVA tar member order (required by OVF spec + VMware):
#   1. .ovf   — descriptor
#   2. .mf    — SHA256 manifest
#   3. .vmdk  — disk image
# =============================================================================
set -euo pipefail

RAW_IMG="${1:?Usage: pack-ova.sh <raw.img> <output.ova> <version> <disk-mb>}"
OUTPUT_OVA="${2:?}"
VERSION="${3:?}"
DISK_MB="${4:-8192}"

TMPDIR_OVA=$(mktemp -d /tmp/ova-XXXXXX)
trap 'rm -rf "${TMPDIR_OVA}"' EXIT

log() { echo "[pack-ova] $*"; }
die() { echo "[pack-ova] ERROR: $*" >&2; exit 1; }

[ -f "${RAW_IMG}" ] || die "Raw image not found: ${RAW_IMG}"

NAME="san-platform"
OVF="${TMPDIR_OVA}/${NAME}.ovf"
VMDK="${TMPDIR_OVA}/${NAME}-disk.vmdk"
MF="${TMPDIR_OVA}/${NAME}.mf"
VMDK_BASENAME=$(basename "${VMDK}")
DISK_BYTES=$(( DISK_MB * 1024 * 1024 ))

# ── Step 1: Convert raw → monolithicSparse VMDK ───────────────────────────────
log "Converting raw image → VMDK…"
qemu-img convert -f raw -O vmdk -o subformat=monolithicSparse \
    "${RAW_IMG}" "${VMDK}"
VMDK_SIZE=$(stat -c '%s' "${VMDK}")
log "VMDK: $(numfmt --to=iec "${VMDK_SIZE}")"

# ── Step 2: Compute SHA256 of OVF and VMDK files directly ─────────────────────
# We hash the files before tarring. VMware validates against these exact bytes.
# The .mf is placed BEFORE the .vmdk in the tar so VMware can validate on-the-fly.
# Note: sha256sum outputs "<hash>  <filename>" — extract hash only with awk.

# ── Step 3: Generate OVF descriptor ──────────────────────────────────────────
log "Generating OVF…"
cat > "${OVF}" << OVFEOF
<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1"
          xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
          xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
          xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData"
          xmlns:vmw="http://www.vmware.com/schema/ovf">

  <References>
    <File ovf:id="disk1" ovf:href="${VMDK_BASENAME}" ovf:size="${VMDK_SIZE}"/>
  </References>

  <DiskSection>
    <Info>Virtual disk information</Info>
    <Disk ovf:diskId="vmdisk1"
          ovf:fileRef="disk1"
          ovf:capacity="${DISK_BYTES}"
          ovf:capacityAllocationUnits="byte"
          ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#sparse"
          ovf:populatedSize="${VMDK_SIZE}"/>
  </DiskSection>

  <NetworkSection>
    <Info>Network adapters</Info>
    <Network ovf:name="VM Network">
      <Description>VM Network</Description>
    </Network>
  </NetworkSection>

  <VirtualSystem ovf:id="${NAME}">
    <Info>SAN Management Platform v${VERSION}</Info>

    <OperatingSystemSection ovf:id="101" vmw:osType="otherLinux64Guest">
      <Info>Guest OS</Info>
      <Description>Linux x86_64</Description>
    </OperatingSystemSection>

    <VirtualHardwareSection>
      <Info>Virtual hardware</Info>
      <ovf:System>
        <vssd:ElementName>Virtual Hardware Family</vssd:ElementName>
        <vssd:InstanceID>0</vssd:InstanceID>
        <vssd:VirtualSystemIdentifier>${NAME}</vssd:VirtualSystemIdentifier>
        <vssd:VirtualSystemType>vmx-19</vssd:VirtualSystemType>
      </ovf:System>

      <ovf:Item>
        <rasd:Description>Number of CPUs</rasd:Description>
        <rasd:ElementName>2 vCPU</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>2</rasd:VirtualQuantity>
      </ovf:Item>

      <ovf:Item>
        <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
        <rasd:Description>RAM</rasd:Description>
        <rasd:ElementName>2048 MB RAM</rasd:ElementName>
        <rasd:InstanceID>2</rasd:InstanceID>
        <rasd:ResourceType>4</rasd:ResourceType>
        <rasd:VirtualQuantity>2048</rasd:VirtualQuantity>
      </ovf:Item>

      <ovf:Item>
        <rasd:Description>SATA Controller</rasd:Description>
        <rasd:ElementName>SATA controller 0</rasd:ElementName>
        <rasd:InstanceID>3</rasd:InstanceID>
        <rasd:ResourceSubType>vmware.sata.ahci</rasd:ResourceSubType>
        <rasd:ResourceType>20</rasd:ResourceType>
      </ovf:Item>

      <ovf:Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:ElementName>Hard disk 1</rasd:ElementName>
        <rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource>
        <rasd:InstanceID>4</rasd:InstanceID>
        <rasd:Parent>3</rasd:Parent>
        <rasd:ResourceType>17</rasd:ResourceType>
      </ovf:Item>

      <ovf:Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:AutomaticAllocation>true</rasd:AutomaticAllocation>
        <rasd:Connection>VM Network</rasd:Connection>
        <rasd:Description>VMXNET3 NIC</rasd:Description>
        <rasd:ElementName>Network adapter 1</rasd:ElementName>
        <rasd:InstanceID>5</rasd:InstanceID>
        <rasd:ResourceSubType>VMXNET3</rasd:ResourceSubType>
        <rasd:ResourceType>10</rasd:ResourceType>
      </ovf:Item>

      <vmw:Config ovf:required="false" vmw:key="firmware" vmw:value="efi"/>
      <vmw:Config ovf:required="false" vmw:key="uefi.secureBoot.enabled" vmw:value="false"/>

    </VirtualHardwareSection>
  </VirtualSystem>
</Envelope>
OVFEOF

log "OVF: $(wc -l < "${OVF}") lines, $(stat -c '%s' "${OVF}") bytes"

# ── Step 4: Generate SHA256 manifest ─────────────────────────────────────────
# Hash the files directly. The .mf goes into the tar BEFORE the .vmdk so
# VMware can read the manifest first and then validate the disk on-the-fly.
log "Computing SHA256…"
OVF_SHA=$(sha256sum  "${OVF}"  | awk '{print $1}')
VMDK_SHA=$(sha256sum "${VMDK}" | awk '{print $1}')

log "OVF  SHA256: ${OVF_SHA}"
log "VMDK SHA256: ${VMDK_SHA}"

# Validate hash lengths (must be exactly 64 hex chars)
[ "${#OVF_SHA}"  -eq 64 ] || die "OVF SHA256 wrong length: ${#OVF_SHA}"
[ "${#VMDK_SHA}" -eq 64 ] || die "VMDK SHA256 wrong length: ${#VMDK_SHA}"

{
    printf 'SHA256(%s)= %s\n' "${NAME}.ovf"      "${OVF_SHA}"
    printf 'SHA256(%s)= %s\n' "${VMDK_BASENAME}" "${VMDK_SHA}"
} > "${MF}"

log "Manifest:"
cat "${MF}"

# ── Step 5: Bundle as OVA ─────────────────────────────────────────────────────
# Order: ovf → mf → vmdk  (VMware reads manifest before disk to validate)
log "Creating OVA tar (order: ovf → mf → vmdk)…"
tar -cf "${OUTPUT_OVA}" \
    -C "${TMPDIR_OVA}" \
    "${NAME}.ovf" \
    "${NAME}.mf" \
    "${VMDK_BASENAME}"

log "OVA: $(ls -lh "${OUTPUT_OVA}" | awk '{print $5, $9}')"
