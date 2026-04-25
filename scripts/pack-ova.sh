#!/usr/bin/env bash
# =============================================================================
# scripts/pack-ova.sh
#
# Converts a raw disk image produced by Buildroot/genimage into a
# standards-compliant OVA importable by VMware Workstation, Fusion, and ESXi.
#
# Usage:
#   pack-ova.sh <raw-disk.img> <output.ova> <version> <disk-size-mb>
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

DISK_BYTES=$(( DISK_MB * 1024 * 1024 ))

# ── Step 1: Convert raw → sparse VMDK ────────────────────────────────────────
log "Converting raw image → monolithicSparse VMDK…"
qemu-img convert \
    -f raw \
    -O vmdk \
    -o subformat=monolithicSparse \
    "${RAW_IMG}" \
    "${VMDK}"

VMDK_SIZE=$(stat -c '%s' "${VMDK}")
VMDK_BASENAME=$(basename "${VMDK}")
log "VMDK size: $(numfmt --to=iec "${VMDK_SIZE}")"

# ── Step 2: Generate OVF descriptor ──────────────────────────────────────────
# Uses ovf: namespace prefixes on System and Item elements — required by
# VMware Workstation's strict OVF 1.1 parser.
log "Generating OVF descriptor…"

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
          ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#sparse"
          ovf:populatedSize="${VMDK_SIZE}"/>
  </DiskSection>

  <NetworkSection>
    <Info>Logical networks used in the package</Info>
    <Network ovf:name="Management">
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

      <!-- 2 vCPUs -->
      <ovf:Item>
        <rasd:Description>Number of virtual CPUs</rasd:Description>
        <rasd:ElementName>2 virtual CPU(s)</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>2</rasd:VirtualQuantity>
      </ovf:Item>

      <!-- 2 GiB RAM -->
      <ovf:Item>
        <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
        <rasd:Description>Memory Size</rasd:Description>
        <rasd:ElementName>2048 MB of memory</rasd:ElementName>
        <rasd:InstanceID>2</rasd:InstanceID>
        <rasd:ResourceType>4</rasd:ResourceType>
        <rasd:VirtualQuantity>2048</rasd:VirtualQuantity>
      </ovf:Item>

      <!-- LSI Logic Parallel SCSI controller -->
      <ovf:Item>
        <rasd:Description>SCSI Controller</rasd:Description>
        <rasd:ElementName>SCSI controller 0</rasd:ElementName>
        <rasd:InstanceID>3</rasd:InstanceID>
        <rasd:ResourceSubType>lsilogic</rasd:ResourceSubType>
        <rasd:ResourceType>6</rasd:ResourceType>
      </ovf:Item>

      <!-- Disk attached to SCSI controller -->
      <ovf:Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:ElementName>Hard disk 1</rasd:ElementName>
        <rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource>
        <rasd:InstanceID>4</rasd:InstanceID>
        <rasd:Parent>3</rasd:Parent>
        <rasd:ResourceType>17</rasd:ResourceType>
      </ovf:Item>

      <!-- VMXNET3 NIC -->
      <ovf:Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:AutomaticAllocation>true</rasd:AutomaticAllocation>
        <rasd:Connection>Management</rasd:Connection>
        <rasd:Description>VMXNET3 ethernet adapter</rasd:Description>
        <rasd:ElementName>Network adapter 1</rasd:ElementName>
        <rasd:InstanceID>5</rasd:InstanceID>
        <rasd:ResourceSubType>VMXNET3</rasd:ResourceSubType>
        <rasd:ResourceType>10</rasd:ResourceType>
      </ovf:Item>

      <!-- vmw:Config elements must come after all ovf:Item elements -->
      <!-- EFI firmware type — required for GPT/EFI-only boot disk -->
      <vmw:Config ovf:required="false" vmw:key="firmware" vmw:value="efi"/>
      <!-- Disable secure boot so unsigned Buildroot kernel loads -->
      <vmw:Config ovf:required="false" vmw:key="uefi.secureBoot.enabled" vmw:value="false"/>

    </VirtualHardwareSection>

    <ProductSection>
      <Info>Product customization</Info>
      <Product>SAN Management Platform</Product>
      <Vendor>Your Organization</Vendor>
      <Version>${VERSION}</Version>
      <FullVersion>${VERSION}</FullVersion>
    </ProductSection>

  </VirtualSystem>
</Envelope>
OVFEOF

log "OVF descriptor generated ($(wc -l < "${OVF}") lines)"

# ── Step 3: Generate SHA256 manifest ─────────────────────────────────────────
# Use printf to guarantee no trailing whitespace — VMware's parser is strict.
log "Generating manifest…"
OVF_SHA=$(sha256sum "${OVF}"  | awk '{print $1}')
MDF_SHA=$(sha256sum "${VMDK}" | awk '{print $1}')

{
    printf 'SHA256(%s)= %s\n' "${NAME}.ovf"      "${OVF_SHA}"
    printf 'SHA256(%s)= %s\n' "${VMDK_BASENAME}" "${MDF_SHA}"
} > "${MF}"

log "Manifest:"
cat "${MF}"

# ── Step 4: Bundle as OVA ─────────────────────────────────────────────────────
# OVA = uncompressed tar. OVF spec requires this exact member order:
#   1. OVF descriptor  (.ovf)
#   2. disk image(s)   (.vmdk)
#   3. manifest        (.mf)
log "Bundling OVA (tar, uncompressed — OVF 1.1 spec)…"
tar -cf "${OUTPUT_OVA}" \
    -C "${TMPDIR_OVA}" \
    "${NAME}.ovf" \
    "${VMDK_BASENAME}" \
    "${NAME}.mf"

log "OVA assembled: ${OUTPUT_OVA}"
ls -lh "${OUTPUT_OVA}"
