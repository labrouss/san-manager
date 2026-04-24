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

print("\nAll checks passed.")
