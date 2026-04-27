#!/usr/bin/env bash
# =============================================================================
# scripts/pack-ova.sh
# Converts a raw disk image to a VMware-importable OVA.
#
# Usage: pack-ova.sh <raw-disk.img> <output.ova> <version>
# =============================================================================
set -euo pipefail

RAW_IMG="${1:?Usage: pack-ova.sh <raw.img> <output.ova> <version>}"
OUTPUT_OVA="${2:?}"
VERSION="${3:?}"

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

# ── Step 1: Convert raw → streamOptimized VMDK (OVA-correct format) ──────────
log "Converting raw image → streamOptimized VMDK…"
qemu-img convert \
    -f raw \
    -O vmdk \
    -o subformat=streamOptimized \
    "${RAW_IMG}" "${VMDK}"

VMDK_SIZE=$(stat -c '%s' "${VMDK}")
log "VMDK file size: ${VMDK_SIZE} bytes"

# ── Step 2: Get actual virtual disk capacity from VMDK metadata ───────────────
DISK_BYTES=$(qemu-img info --output=json "${VMDK}" | jq -r '.["virtual-size"]')
[ -n "${DISK_BYTES}" ] || die "Failed to detect VMDK virtual size"
log "VMDK virtual capacity: ${DISK_BYTES} bytes"

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
    <Info>Virtual disk</Info>
    <Disk ovf:diskId="vmdisk1"
          ovf:fileRef="disk1"
          ovf:capacity="${DISK_BYTES}"
          ovf:capacityAllocationUnits="byte"
          ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized"
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
        <rasd:ElementName>2 virtual CPUs</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>2</rasd:VirtualQuantity>
      </ovf:Item>

      <ovf:Item>
        <rasd:ElementName>2048 MB RAM</rasd:ElementName>
        <rasd:InstanceID>2</rasd:InstanceID>
        <rasd:ResourceType>4</rasd:ResourceType>
        <rasd:VirtualQuantity>2048</rasd:VirtualQuantity>
        <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
      </ovf:Item>

      <ovf:Item>
        <rasd:ElementName>SATA controller 0</rasd:ElementName>
        <rasd:InstanceID>3</rasd:InstanceID>
        <rasd:ResourceType>20</rasd:ResourceType>
        <rasd:ResourceSubType>vmware.sata.ahci</rasd:ResourceSubType>
      </ovf:Item>

      <ovf:Item>
        <rasd:ElementName>Hard disk 1</rasd:ElementName>
        <rasd:InstanceID>4</rasd:InstanceID>
        <rasd:ResourceType>17</rasd:ResourceType>
        <rasd:Parent>3</rasd:Parent>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource>
      </ovf:Item>

      <ovf:Item>
        <rasd:ElementName>Network adapter 1</rasd:ElementName>
        <rasd:InstanceID>5</rasd:InstanceID>
        <rasd:ResourceType>10</rasd:ResourceType>
        <rasd:ResourceSubType>VMXNET3</rasd:ResourceSubType>
        <rasd:Connection>VM Network</rasd:Connection>
      </ovf:Item>

      <vmw:Config vmw:key="firmware" vmw:value="efi"/>
      <vmw:Config vmw:key="uefi.secureBoot.enabled" vmw:value="false"/>

    </VirtualHardwareSection>
  </VirtualSystem>
</Envelope>
OVFEOF

log "OVF: $(wc -c < "${OVF}") bytes"

# ── Step 4: Generate SHA256 manifest ─────────────────────────────────────────
log "Computing SHA256…"
OVF_SHA=$(sha256sum  "${OVF}"  | awk '{print $1}')
VMDK_SHA=$(sha256sum "${VMDK}" | awk '{print $1}')

[ "${#OVF_SHA}"  -eq 64 ] || die "OVF SHA256 wrong length (${#OVF_SHA})"
[ "${#VMDK_SHA}" -eq 64 ] || die "VMDK SHA256 wrong length (${#VMDK_SHA})"

{
    printf 'SHA256(%s)= %s\n' "${NAME}.ovf"      "${OVF_SHA}"
    printf 'SHA256(%s)= %s\n' "${VMDK_BASENAME}" "${VMDK_SHA}"
} > "${MF}"

log "Manifest:"
cat "${MF}"

# ── Step 5: Create OVA with ustar format ─────────────────────────────────────
# --format=ustar    : plain POSIX tar, no GNU extensions — VMware requires this
# --numeric-owner   : no user/group name strings in headers
# --owner=0 --group=0 : root ownership in tar headers
# Member order: ovf → mf → vmdk  (manifest before disk for streaming validation)
log "Creating OVA (ustar format: ovf → mf → vmdk)…"
tar --format=ustar \
    --numeric-owner \
    --owner=0 --group=0 \
    -cf "${OUTPUT_OVA}" \
    -C "${TMPDIR_OVA}" \
    "${NAME}.ovf" \
    "${NAME}.mf" \
    "${VMDK_BASENAME}"

log "OVA created: ${OUTPUT_OVA} ($(ls -lh "${OUTPUT_OVA}" | awk '{print $5}'))"
