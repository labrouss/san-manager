#!/usr/bin/env python3
"""
scripts/patch-buildroot-config.py

Patches a Buildroot .config after defconfig load to:
  - Disable legacy symbols that trigger BR2_LEGACY=y → fatal build stop
  - Ensure correct curl split symbols are present

BusyBox init is used (Buildroot default) — no systemd forcing needed.
init.d scripts in the rootfs overlay handle service startup.

Usage:
    python3 scripts/patch-buildroot-config.py <path-to-.config>

Exit codes:
    0  all patches applied and verified
    1  a check failed or BR2_LEGACY is set
"""

import re
import sys
import os

config_path = sys.argv[1] if len(sys.argv) > 1 else ".config"

if not os.path.exists(config_path):
    print(f"ERROR: {config_path} not found", file=sys.stderr)
    sys.exit(1)

with open(config_path) as f:
    config = f.read()

# ---------------------------------------------------------------------------
# Patches
#   "y"   → set to y
#   None  → comment out (disable)
# ---------------------------------------------------------------------------
patches = {
    # ── Legacy curl name → must be absent ────────────────────────────────────
    "BR2_PACKAGE_CURL": None,

    # ── GRUB2 legacy unsuffixed symbols → trigger BR2_LEGACY if set ──────────
    # Correct symbols are BR2_TARGET_GRUB2_BUILTIN_MODULES_EFI (with suffix)
    # but we handle GRUB entirely in post-image.sh via grub-mkstandalone.
    "BR2_TARGET_GRUB2_BUILTIN_MODULES": None,
    "BR2_TARGET_GRUB2_BUILTIN_CONFIG":  None,

    # ── Kernel moving-target legacy symbols ───────────────────────────────────
    "BR2_LINUX_KERNEL_LATEST_VERSION": None,
    "BR2_LINUX_KERNEL_LATEST_LTS_6_6": None,
}

for sym, val in patches.items():
    pattern = re.compile(r'^(# )?' + re.escape(sym) + r'[= ].*$', re.MULTILINE)
    replacement = f"# {sym} is not set" if val is None else f"{sym}={val}"

    if pattern.search(config):
        config = pattern.sub(replacement, config)
        print(f"  patched : {replacement}")
    else:
        if val is not None:
            config += f"\n{replacement}\n"
            print(f"  appended: {replacement}")
        else:
            print(f"  skip    : {sym} not present (already absent)")

with open(config_path, "w") as f:
    f.write(config)

print("Patch complete.\n")

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
with open(config_path) as f:
    final = f.read()

errors = 0
print("Verification:")

required_present = [
    "BR2_PACKAGE_LIBCURL=y",
    "BR2_PACKAGE_LIBCURL_CURL=y",
    # BusyBox init is the default — BR2_INIT_BUSYBOX=y is expected and correct
    "BR2_INIT_BUSYBOX=y",
]

required_absent = [
    "BR2_TARGET_GRUB2_X86_EFI=y",          # wrong symbol name (no _64_)
    "BR2_TARGET_GRUB2_I386_PC=y",           # selects HAS_LEGACY_BOOT → BR2_LEGACY
    "BR2_TARGET_GRUB2_HAS_LEGACY_BOOT=y",   # the legacy trigger
    "BR2_PACKAGE_CURL=y",                    # legacy curl name
    "BR2_TARGET_GRUB2_BUILTIN_MODULES=y",   # legacy unsplit symbol
    "BR2_LINUX_KERNEL_LATEST_VERSION=y",
    "BR2_LINUX_KERNEL_LATEST_LTS_6_6=y",
    "BR2_LEGACY=y",
]

for sym in required_present:
    if re.search(r'^' + re.escape(sym) + r'$', final, re.MULTILINE):
        print(f"  OK  : {sym} present")
    else:
        print(f"  FAIL: {sym} absent (required)", file=sys.stderr)
        errors += 1

for sym in required_absent:
    if re.search(r'^' + re.escape(sym) + r'$', final, re.MULTILINE):
        print(f"  FAIL: {sym} present (must not be)", file=sys.stderr)
        if "LEGACY" in sym:
            for line in final.splitlines():
                if "LEGACY" in line and "=y" in line:
                    print(f"    trigger: {line}", file=sys.stderr)
        errors += 1
    else:
        print(f"  OK  : {sym} absent")

if errors:
    print(f"\n{errors} check(s) failed.", file=sys.stderr)
    sys.exit(1)

print("\nAll checks passed.")
