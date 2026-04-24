#!/usr/bin/env bash
# =============================================================================
# scripts/pack-ova.sh
#
# Converts a raw disk image produced by Buildroot/genimage into a
# standards-compliant OVA (Open Virtualization Appliance).
#
# Usage:
#   pack-ova.sh <raw-disk.img> <output.ova> <version> <disk-size-mb>
#
# The script tries to use `ovftool` (VMware) if available.
# If not, it manually assembles the OVA from OVF + VMDK + MF manifest.
#
# OVA structure:
#   san-platform.ovf       — VM descriptor (hardware spec, network, disks)
#   san-platform-disk.vmdk — Sparse VMDK converted from the raw image
#   san-platform.mf        — SHA256 manifest
#
# Hardware specification in the OVF:
#   vCPUs:  2
#   RAM:    2 GiB
#   NIC:    VMXNET3 (VMware paravirtual; most compatible)
#   SCSI:   LSI Logic Parallel
#   Disk:   <disk-size-mb> GiB dynamic
# =============================================================================
set -euo pipefail

RAW_IMG="${1:?Usage: pack-ova.sh <raw.img> <output.ova> <version> <disk-mb>}"
OUTPUT_OVA="${2:?}"
VERSION="${3:?}"
DISK_MB="${4:-8192}"

TMPDIR_OVA=$(mktemp -d /tmp/ova-XXXXXX)
trap 'rm -rf "${TMPDIR_OVA}"' EXIT

log()  { echo "[pack-ova] $*"; }
die()  { echo "[pack-ova] ERROR: $*" >&2; exit 1; }

[ -f "${RAW_IMG}" ] || die "Raw image not found: ${RAW_IMG}"

NAME="san-platform"
OVF="${TMPDIR_OVA}/${NAME}.ovf"
VMDK="${TMPDIR_OVA}/${NAME}-disk.vmdk"
MF="${TMPDIR_OVA}/${NAME}.mf"

DISK_BYTES=$(( DISK_MB * 1024 * 1024 ))

# ── Step 1: Convert raw → sparse VMDK ────────────────────────────────────────
log "Converting raw image → sparse VMDK…"
qemu-img convert \
    -f raw \
    -O vmdk \
    -o subformat=streamOptimized \
    "${RAW_IMG}" \
    "${VMDK}"

VMDK_SIZE=$(stat -c '%s' "${VMDK}")
log "VMDK size: $(numfmt --to=iec ${VMDK_SIZE})"

# ── Step 2: Try ovftool first ────────────────────────────────────────────────
if command -v ovftool &>/dev/null; then
    log "ovftool found — using it to assemble OVA"
    ovftool \
        --name="${NAME}-${VERSION}" \
        --diskMode=streamOptimized \
        "${VMDK}" \
        "${OUTPUT_OVA}"
    log "OVA created by ovftool: ${OUTPUT_OVA}"
    exit 0
fi

log "ovftool not available — assembling OVA manually"

# ── Step 3: Generate OVF descriptor ──────────────────────────────────────────
VMDK_BASENAME=$(basename "${VMDK}")
DISK_CAPACITY_BYTES="${DISK_BYTES}"

cat > "${OVF}" << OVF_EOF
<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1"
          xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData"
          xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData"
          xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1"
          xmlns:vmw="http://www.vmware.com/schema/ovf"
          xml:lang="en-US">

  <References>
    <File ovf:id="disk1" ovf:href="${VMDK_BASENAME}" ovf:size="${VMDK_SIZE}"/>
  </References>

  <DiskSection>
    <Info>Virtual disk information</Info>
    <Disk ovf:diskId="vmdisk1"
          ovf:fileRef="disk1"
          ovf:capacity="${DISK_CAPACITY_BYTES}"
          ovf:capacityAllocationUnits="byte"
          ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized"
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
    <Name>${NAME}-${VERSION}</Name>

    <AnnotationSection>
      <Info>Appliance annotations</Info>
      <Annotation>SAN Management Platform v${VERSION}. Default web UI: http://&lt;vm-ip&gt;:8080. Default login: admin / Admin1234!</Annotation>
    </AnnotationSection>

    <OperatingSystemSection ovf:id="100" vmw:osType="otherLinux64Guest">
      <Info>Guest operating system</Info>
      <Description>Linux (Buildroot, musl, kernel 6.6 LTS)</Description>
    </OperatingSystemSection>

    <VirtualHardwareSection>
      <Info>Virtual hardware requirements</Info>

      <System>
        <vssd:ElementName>Virtual Hardware Family</vssd:ElementName>
        <vssd:InstanceID>0</vssd:InstanceID>
        <vssd:VirtualSystemIdentifier>${NAME}</vssd:VirtualSystemIdentifier>
        <vssd:VirtualSystemType>vmx-19</vssd:VirtualSystemType>
      </System>

      <!-- 2 vCPUs -->
      <Item>
        <rasd:Description>Number of virtual CPUs</rasd:Description>
        <rasd:ElementName>2 virtual CPU(s)</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>2</rasd:VirtualQuantity>
      </Item>

      <!-- 2 GiB RAM -->
      <Item>
        <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
        <rasd:Description>Memory Size</rasd:Description>
        <rasd:ElementName>2048 MB of memory</rasd:ElementName>
        <rasd:InstanceID>2</rasd:InstanceID>
        <rasd:ResourceType>4</rasd:ResourceType>
        <rasd:VirtualQuantity>2048</rasd:VirtualQuantity>
      </Item>

      <!-- LSI Logic SCSI controller -->
      <Item>
        <rasd:Description>SCSI Controller</rasd:Description>
        <rasd:ElementName>SCSI controller 0</rasd:ElementName>
        <rasd:InstanceID>3</rasd:InstanceID>
        <rasd:ResourceSubType>lsilogic</rasd:ResourceSubType>
        <rasd:ResourceType>6</rasd:ResourceType>
      </Item>

      <!-- Disk on SCSI controller -->
      <Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:ElementName>Hard disk 1</rasd:ElementName>
        <rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource>
        <rasd:InstanceID>4</rasd:InstanceID>
        <rasd:Parent>3</rasd:Parent>
        <rasd:ResourceType>17</rasd:ResourceType>
      </Item>

      <!-- VMXNET3 NIC -->
      <Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:AutomaticAllocation>true</rasd:AutomaticAllocation>
        <rasd:Connection>Management</rasd:Connection>
        <rasd:Description>VMXNET3 adapter</rasd:Description>
        <rasd:ElementName>Network adapter 1</rasd:ElementName>
        <rasd:InstanceID>5</rasd:InstanceID>
        <rasd:ResourceSubType>VMXNET3</rasd:ResourceSubType>
        <rasd:ResourceType>10</rasd:ResourceType>
      </Item>

      <!-- USB controller -->
      <Item ovf:required="false">
        <rasd:ElementName>USB controller</rasd:ElementName>
        <rasd:InstanceID>6</rasd:InstanceID>
        <rasd:ResourceSubType>vmware.usb.xhci</rasd:ResourceSubType>
        <rasd:ResourceType>23</rasd:ResourceType>
      </Item>

    </VirtualHardwareSection>

    <!-- Properties the operator can set in vSphere/OVF deploy wizard -->
    <ProductSection>
      <Info>Product customization for the deployed software</Info>
      <Product>SAN Management Platform</Product>
      <Vendor>Your Organization</Vendor>
      <Version>${VERSION}</Version>
      <FullVersion>${VERSION}</FullVersion>

      <Property ovf:key="admin_password" ovf:type="string" ovf:userConfigurable="true"
                ovf:value="Admin1234!">
        <Label>Admin Password</Label>
        <Description>Initial password for the admin web UI account. Change after first login.</Description>
      </Property>

      <Property ovf:key="mds_password" ovf:type="string" ovf:userConfigurable="true"
                ovf:value="CHANGE_ME">
        <Label>MDS Switch Password</Label>
        <Description>Password for the MDS switch admin account.</Description>
      </Property>

    </ProductSection>

  </VirtualSystem>
</Envelope>
OVF_EOF

log "OVF descriptor generated"

# ── Step 4: Generate SHA256 manifest ─────────────────────────────────────────
OVF_SHA=$(sha256sum "${OVF}"  | awk '{print $1}')
MDF_SHA=$(sha256sum "${VMDK}" | awk '{print $1}')

cat > "${MF}" << MF_EOF
SHA256(${NAME}.ovf)= ${OVF_SHA}
SHA256(${VMDK_BASENAME})= ${MDF_SHA}
MF_EOF

log "Manifest generated"

# ── Step 5: Bundle as OVA (tar, no compression — OVF spec requirement) ────────
log "Bundling OVA archive…"
tar -cf "${OUTPUT_OVA}" \
    -C "${TMPDIR_OVA}" \
    "${NAME}.ovf" \
    "${VMDK_BASENAME}" \
    "${NAME}.mf"

log "OVA assembled: ${OUTPUT_OVA}"
ls -lh "${OUTPUT_OVA}"
