#!/usr/bin/env bash
# =============================================================================
# scripts/pack-ova.sh
# Converts a raw disk image to a VMware-importable OVA.
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

# ── Step 1: Convert raw → streamOptimized VMDK ────────────────────────────────
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
# This is the OVF structure that VMware Workstation accepts.
# Every ovf:Item MUST have rasd:ElementName — it is required by OVF 1.1 spec.
# vmw:Config elements must appear AFTER all ovf:Item elements.
log "Generating OVF…"
cat > "${OVF}" << OVFEOF
<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1"
          xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
          xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
          xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData"
          xmlns:vmw="http://www.vmware.com/schema/ovf"
          xml:lang="en-US">

  <References>
    <File ovf:id="disk1" ovf:href="${VMDK_BASENAME}" ovf:size="${VMDK_SIZE}"/>
  </References>

  <DiskSection>
    <Info>Virtual disk information</Info>
    <Disk ovf:diskId="vmdisk1"
          ovf:fileRef="disk1"
          ovf:capacity="${DISK_BYTES}"
          ovf:capacityAllocationUnits="byte"
          ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized"
          ovf:populatedSize="${VMDK_SIZE}"/>
  </DiskSection>

  <NetworkSection>
    <Info>Logical networks used in the package</Info>
    <Network ovf:name="VM Network">
      <Description>Management network for the SAN Platform appliance</Description>
    </Network>
  </NetworkSection>

  <VirtualSystem ovf:id="${NAME}">
    <Info>SAN Management Platform Appliance v${VERSION}</Info>

    <AnnotationSection>
      <Info>Appliance annotations</Info>
      <Annotation>SAN Platform v${VERSION} — Web UI: http://vm-ip:8080 — Login: admin/Admin1234!</Annotation>
    </AnnotationSection>

    <OperatingSystemSection ovf:id="101" vmw:osType="otherLinux64Guest">
      <Info>Guest operating system</Info>
      <Description>Linux (Buildroot, musl, kernel 6.6 LTS)</Description>
    </OperatingSystemSection>

    <VirtualHardwareSection>
      <Info>Virtual hardware requirements</Info>

      <ovf:System>
        <vssd:ElementName>Virtual Hardware Family</vssd:ElementName>
        <vssd:InstanceID>0</vssd:InstanceID>
        <vssd:VirtualSystemIdentifier>${NAME}</vssd:VirtualSystemIdentifier>
        <vssd:VirtualSystemType>vmx-19</vssd:VirtualSystemType>
      </ovf:System>

      <ovf:Item>
        <rasd:Description>Number of virtual CPUs</rasd:Description>
        <rasd:ElementName>2 virtual CPU(s)</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>2</rasd:VirtualQuantity>
      </ovf:Item>

      <ovf:Item>
        <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
        <rasd:Description>Memory Size</rasd:Description>
        <rasd:ElementName>2048 MB of memory</rasd:ElementName>
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
        <rasd:Description>Disk image</rasd:Description>
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
        <rasd:Description>VMXNET3 ethernet adapter</rasd:Description>
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

log "OVF generated: $(wc -c < "${OVF}") bytes"

# ── Step 4: Compute SHA256 manifest ──────────────────────────────────────────
log "Computing SHA256…"
OVF_SHA=$(sha256sum  "${OVF}"  | awk '{print $1}')
VMDK_SHA=$(sha256sum "${VMDK}" | awk '{print $1}')

[ "${#OVF_SHA}"  -eq 64 ] || die "OVF SHA256 wrong length: ${#OVF_SHA}"
[ "${#VMDK_SHA}" -eq 64 ] || die "VMDK SHA256 wrong length: ${#VMDK_SHA}"

{
    printf 'SHA256(%s)= %s\n' "${NAME}.ovf"      "${OVF_SHA}"
    printf 'SHA256(%s)= %s\n' "${VMDK_BASENAME}" "${VMDK_SHA}"
} > "${MF}"

log "Manifest:"
cat "${MF}"

# ── Step 5: Bundle OVA ────────────────────────────────────────────────────────
# CRITICAL: --format=ustar prevents GNU tar extensions that break VMware's parser.
# Member order: ovf → mf → vmdk (manifest before disk for streaming validation).
log "Creating OVA (ustar, order: ovf → mf → vmdk)…"
tar --format=ustar \
    --numeric-owner \
    --owner=0 --group=0 \
    -cf "${OUTPUT_OVA}" \
    -C "${TMPDIR_OVA}" \
    "${NAME}.ovf" \
    "${NAME}.mf" \
    "${VMDK_BASENAME}"

log "OVA created: ${OUTPUT_OVA} ($(ls -lh "${OUTPUT_OVA}" | awk '{print $5}'))"
