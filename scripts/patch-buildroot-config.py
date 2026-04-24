#!/usr/bin/env python3
"""
scripts/patch-buildroot-config.py

Patches a Buildroot .config file to force symbols that cannot be reliably
set via defconfig due to Kconfig dependency-ordering constraints.

Usage:
    python3 scripts/patch-buildroot-config.py <path-to-.config>

Exit codes:
    0  all patches applied and verified
    1  a required symbol could not be forced (e.g. systemd still not set)
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
# Patches: symbol -> value
#   value = "y"   → set to y
#   value = None  → comment out (disable)
# ---------------------------------------------------------------------------
patches = {
    # Toolchain — wchar + TLS are required by systemd even with musl.
    # They must be enabled before systemd can be selected.
    "BR2_TOOLCHAIN_BUILDROOT_WCHAR": "y",
    "BR2_TOOLCHAIN_BUILDROOT_TLS":   "y",

    # Init system — disable busybox init, enable systemd.
    "BR2_INIT_BUSYBOX":              None,
    "BR2_INIT_SYSTEMD":              "y",

    # systemd sub-packages
    "BR2_PACKAGE_SYSTEMD":           "y",
    "BR2_PACKAGE_SYSTEMD_NETWORKD":  "y",
    "BR2_PACKAGE_SYSTEMD_RESOLVED":  "y",

    # curl CLI requires libcurl as parent package in Buildroot 2024.02
    "BR2_PACKAGE_LIBCURL":           "y",

    # Kernel — LATEST_VERSION is a legacy moving-target symbol removed in 2024.02.
    # The correct symbol is BR2_LINUX_KERNEL_LATEST_LTS_6_6 for the 6.6.x series.
    "BR2_LINUX_KERNEL_LATEST_VERSION":  None,
    "BR2_LINUX_KERNEL_LATEST_LTS_6_6":  "y",

    # GRUB2 — clear legacy string symbols that trigger BR2_LEGACY if non-empty.
    # BR2_TARGET_GRUB2_BUILTIN_MODULES was split into _PC and _EFI variants;
    # the old unsplit string must be empty to avoid the legacy wrapper firing.
    # BR2_TARGET_GRUB2_BUILTIN_CONFIG was similarly split.
    "BR2_TARGET_GRUB2_BUILTIN_MODULES": '""',
    "BR2_TARGET_GRUB2_BUILTIN_CONFIG":  '""',
}

for sym, val in patches.items():
    pattern = re.compile(r'^(# )?' + re.escape(sym) + r'[= ].*$', re.MULTILINE)
    if val is None:
        replacement = f"# {sym} is not set"
    else:
        replacement = f"{sym}={val}"

    if pattern.search(config):
        config = pattern.sub(replacement, config)
        print(f"  patched : {replacement}")
    else:
        config += f"\n{replacement}\n"
        print(f"  appended: {replacement}")

with open(config_path, "w") as f:
    f.write(config)

print("Patch complete.")

# ---------------------------------------------------------------------------
# Verify critical symbols
# ---------------------------------------------------------------------------
errors = 0

checks = {
    "BR2_INIT_SYSTEMD=y":              True,   # must be present
    "BR2_INIT_BUSYBOX=y":              False,  # must NOT be present
    "BR2_TOOLCHAIN_BUILDROOT_WCHAR=y": True,
    "BR2_TOOLCHAIN_BUILDROOT_TLS=y":   True,
    "BR2_PACKAGE_LIBCURL=y":           True,
    # GRUB2: old unsplit symbol must NOT be set to y (it's a legacy string trap)
    "BR2_TARGET_GRUB2_X86_EFI=y":     False,  # wrong name — must not exist
}

with open(config_path) as f:
    final = f.read()

print("\nVerification:")
for sym, should_exist in checks.items():
    found = bool(re.search(r'^' + re.escape(sym) + r'$', final, re.MULTILINE))
    if found == should_exist:
        print(f"  OK  : {sym} {'present' if should_exist else 'absent'}")
    else:
        state = "absent" if should_exist else "present"
        print(f"  FAIL: {sym} is {state} (expected {'present' if should_exist else 'absent'})")
        errors += 1

if errors:
    print(f"\n{errors} verification failure(s) — aborting", file=sys.stderr)
    sys.exit(1)

# Final sanity check: BR2_LEGACY must NOT be set
import re as _re
legacy_match = _re.search(r'^BR2_LEGACY=y', final, _re.MULTILINE)
if legacy_match:
    print("\nFATAL: BR2_LEGACY=y is set in .config — a legacy symbol is still active!", file=sys.stderr)
    # Print every line that might be a legacy trigger
    for line in final.splitlines():
        if "LEGACY" in line and "=y" in line:
            print(f"  trigger: {line}", file=sys.stderr)
    errors += 1
else:
    print("  OK  : BR2_LEGACY is not set")

if errors:
    print(f"\n{errors} verification failure(s) — aborting", file=sys.stderr)
    sys.exit(1)

print("\nAll checks passed.")
