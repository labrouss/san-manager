#!/usr/bin/env bash
# =============================================================================
# scripts/pack-ova.sh
#
# Converts a raw disk image into a VMware-compatible OVA.
# Modelled on the working Debian cloud image OVA packing script.
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

# ── Step 1: Convert raw → streamOptimized VMDK ───────────────────────────────
log "Converting raw image → streamOptimized VMDK…"
qemu-img convert \
    -f raw \
    -O vmdk \
    -o subformat=streamOptimized \
    "${RAW_IMG}" \
    "${VMDK}"

VMDK_BASENAME=$(basename "${VMDK}")
VMDK_SIZE=$(wc -c < "${VMDK}")
log "VMDK size: ${VMDK_SIZE} bytes"

# ── Step 2: Generate OVF descriptor ──────────────────────────────────────────
log "Generating OVF descriptor…"

cat > "${OVF}" << OVFEOF
<?xml version="1.0" encoding="UTF-8"?>
<Envelope xmlns="http://schemas.dmtf.org/ovf/envelope/1" xmlns:cim="http://schemas.dmtf.org/wbem/wscim/1/common" xmlns:ovf="http://schemas.dmtf.org/ovf/envelope/1" xmlns:rasd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ResourceAllocationSettingData" xmlns:vmw="http://www.vmware.com/schema/ovf" xmlns:vssd="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_VirtualSystemSettingData" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <References>
    <File ovf:href="${VMDK_BASENAME}" ovf:id="file1" ovf:size="${VMDK_SIZE}"/>
  </References>
  <DiskSection>
    <Info>Virtual disk information</Info>
    <Disk ovf:capacity="${DISK_BYTES}" ovf:capacityAllocationUnits="byte" ovf:diskId="vmdisk1" ovf:fileRef="file1" ovf:format="http://www.vmware.com/interfaces/specifications/vmdk.html#streamOptimized" ovf:populatedSize="${VMDK_SIZE}"/>
  </DiskSection>
  <NetworkSection>
    <Info>The list of logical networks</Info>
    <Network ovf:name="VM Network">
      <Description>Management network for the SAN Platform appliance</Description>
    </Network>
  </NetworkSection>
  <VirtualSystem ovf:id="${NAME}-${VERSION}">
    <Info>SAN Management Platform Appliance</Info>
    <Name>${NAME}-${VERSION}</Name>
    <OperatingSystemSection ovf:id="101" vmw:osType="otherLinux64Guest">
      <Info>The kind of installed guest operating system</Info>
      <Description>Linux (Buildroot, musl, kernel 6.6 LTS)</Description>
    </OperatingSystemSection>
    <ProductSection ovf:required="false">
      <Info>SAN Platform product configuration</Info>
      <Product>SAN Management Platform</Product>
      <Vendor>Your Organization</Vendor>
      <Version>${VERSION}</Version>
      <FullVersion>${VERSION}</FullVersion>
      <Property ovf:key="hostname" ovf:type="string" ovf:userConfigurable="true" ovf:value="san-platform">
        <Label>Appliance hostname</Label>
        <Description>Hostname for the SAN Platform appliance</Description>
      </Property>
      <Property ovf:key="admin-password" ovf:type="string" ovf:userConfigurable="true" ovf:value="Admin1234!">
        <Label>Admin password</Label>
        <Description>Password for root and admin accounts. Change after first login.</Description>
      </Property>
      <Property ovf:key="public-keys" ovf:type="string" ovf:userConfigurable="true" ovf:value="">
        <Label>SSH public keys</Label>
        <Description>Optional: paste an SSH public key to add to /root/.ssh/authorized_keys and /home/admin/.ssh/authorized_keys</Description>
      </Property>
    </ProductSection>
    <VirtualHardwareSection>
      <Info>Virtual hardware requirements</Info>
      <System>
        <vssd:ElementName>Virtual Hardware Family</vssd:ElementName>
        <vssd:InstanceID>0</vssd:InstanceID>
        <vssd:VirtualSystemIdentifier>${NAME}-${VERSION}</vssd:VirtualSystemIdentifier>
        <vssd:VirtualSystemType>vmx-19</vssd:VirtualSystemType>
      </System>
      <Item>
        <rasd:AllocationUnits>hertz * 10^6</rasd:AllocationUnits>
        <rasd:Description>Number of Virtual CPUs</rasd:Description>
        <rasd:ElementName>2 virtual CPU(s)</rasd:ElementName>
        <rasd:InstanceID>1</rasd:InstanceID>
        <rasd:ResourceType>3</rasd:ResourceType>
        <rasd:VirtualQuantity>2</rasd:VirtualQuantity>
      </Item>
      <Item>
        <rasd:AllocationUnits>byte * 2^20</rasd:AllocationUnits>
        <rasd:Description>Memory Size</rasd:Description>
        <rasd:ElementName>2048 MB of memory</rasd:ElementName>
        <rasd:InstanceID>2</rasd:InstanceID>
        <rasd:ResourceType>4</rasd:ResourceType>
        <rasd:VirtualQuantity>2048</rasd:VirtualQuantity>
      </Item>
      <Item>
        <rasd:Address>0</rasd:Address>
        <rasd:Description>SATA Controller</rasd:Description>
        <rasd:ElementName>SATA Controller 0</rasd:ElementName>
        <rasd:InstanceID>3</rasd:InstanceID>
        <rasd:ResourceSubType>vmware.sata.ahci</rasd:ResourceSubType>
        <rasd:ResourceType>20</rasd:ResourceType>
      </Item>
      <Item>
        <rasd:AddressOnParent>0</rasd:AddressOnParent>
        <rasd:ElementName>Hard Disk 1</rasd:ElementName>
        <rasd:HostResource>ovf:/disk/vmdisk1</rasd:HostResource>
        <rasd:InstanceID>4</rasd:InstanceID>
        <rasd:Parent>3</rasd:Parent>
        <rasd:ResourceType>17</rasd:ResourceType>
        <vmw:Config ovf:required="false" vmw:key="backing.writeThrough" vmw:value="false"/>
      </Item>
      <Item>
        <rasd:AddressOnParent>7</rasd:AddressOnParent>
        <rasd:AutomaticAllocation>true</rasd:AutomaticAllocation>
        <rasd:Connection>VM Network</rasd:Connection>
        <rasd:Description>VmxNet3 ethernet adapter on &quot;VM Network&quot;</rasd:Description>
        <rasd:ElementName>Ethernet 1</rasd:ElementName>
        <rasd:InstanceID>5</rasd:InstanceID>
        <rasd:ResourceSubType>VmxNet3</rasd:ResourceSubType>
        <rasd:ResourceType>10</rasd:ResourceType>
        <vmw:Config ovf:required="false" vmw:key="wakeOnLanEnabled" vmw:value="true"/>
      </Item>
      <Item ovf:required="false">
        <rasd:AutomaticAllocation>false</rasd:AutomaticAllocation>
        <rasd:ElementName>serial0</rasd:ElementName>
        <rasd:InstanceID>6</rasd:InstanceID>
        <rasd:ResourceSubType>vmware.serialport.device</rasd:ResourceSubType>
        <rasd:ResourceType>21</rasd:ResourceType>
        <vmw:Config ovf:required="false" vmw:key="yieldOnPoll" vmw:value="false"/>
      </Item>
      <vmw:Config ovf:required="false" vmw:key="firmware" vmw:value="efi"/>
      <vmw:Config ovf:required="false" vmw:key="uefi.secureBoot.enabled" vmw:value="false"/>
      <vmw:Config ovf:required="false" vmw:key="cpuHotAddEnabled" vmw:value="false"/>
      <vmw:Config ovf:required="false" vmw:key="memoryHotAddEnabled" vmw:value="false"/>
      <vmw:Config ovf:required="false" vmw:key="tools.syncTimeWithHost" vmw:value="false"/>
      <vmw:Config ovf:required="false" vmw:key="powerOpInfo.powerOffType" vmw:value="preset"/>
      <vmw:Config ovf:required="false" vmw:key="powerOpInfo.resetType" vmw:value="preset"/>
    </VirtualHardwareSection>
  </VirtualSystem>
</Envelope>
OVFEOF

log "OVF generated ($(wc -l < "${OVF}") lines)"

# ── Step 3: Generate SHA256 manifest from files on disk ───────────────────────
# Reference script hashes files directly then writes manifest before tar.
log "Generating manifest…"
VMDK_SUM=$(sha256sum "${VMDK}" | cut -d ' ' -f1)
OVF_SUM=$(sha256sum "${OVF}"   | cut -d ' ' -f1)

cat > "${MF}" << MFEOF
SHA256(${VMDK_BASENAME})= ${VMDK_SUM}
SHA256(${NAME}.ovf)= ${OVF_SUM}
MFEOF

log "Manifest:"
cat "${MF}"

# ── Step 4: Bundle OVA — order: .ovf, .mf, .vmdk ─────────────────────────────
# Reference script uses this exact order (manifest before disk image).
log "Bundling OVA…"
tar -vcf "${OUTPUT_OVA}" \
    -C "${TMPDIR_OVA}" \
    "${NAME}.ovf" \
    "${NAME}.mf" \
    "${VMDK_BASENAME}"

log "OVA assembled: ${OUTPUT_OVA}"
ls -lh "${OUTPUT_OVA}"
