#!/usr/bin/env python3
"""
scripts/patch-buildroot-config.py

Patches a Buildroot .config after defconfig load to force symbols that cannot
be reliably set via defconfig due to Kconfig dependency-ordering constraints.

Usage:
    python3 scripts/patch-buildroot-config.py <path-to-.config>

Exit codes:
    0  all patches applied and verified
    1  a required symbol failed or BR2_LEGACY is set
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
#   "y"      → set to y
#   '""'     → set to empty string (clears legacy string traps)
#   None     → comment out / disable
# ---------------------------------------------------------------------------
patches = {
    # ── Toolchain ────────────────────────────────────────────────────────────
    # wchar + TLS are required by systemd even with musl.
    "BR2_TOOLCHAIN_BUILDROOT_WCHAR": "y",
    "BR2_TOOLCHAIN_BUILDROOT_TLS":   "y",

    # ── Init system ──────────────────────────────────────────────────────────
    "BR2_INIT_BUSYBOX":              None,   # disable
    "BR2_INIT_SYSTEMD":              "y",
    "BR2_PACKAGE_SYSTEMD":           "y",
    "BR2_PACKAGE_SYSTEMD_NETWORKD":  "y",
    "BR2_PACKAGE_SYSTEMD_RESOLVED":  "y",

    # ── curl: BR2_PACKAGE_CURL is the legacy name — must not be present ─────────
    # The correct symbols are BR2_PACKAGE_LIBCURL + BR2_PACKAGE_LIBCURL_CURL,
    # which are set directly in the defconfig. Ensure the old name is gone.
    "BR2_PACKAGE_CURL":              None,   # legacy name — disable if present

    # ── GRUB2 legacy string traps ─────────────────────────────────────────────
    # These unsplit string symbols trigger BR2_LEGACY if non-empty.
    # They were split into _PC and _EFI variants; force them empty.
    "BR2_TARGET_GRUB2_BUILTIN_MODULES": None,   # legacy unsplit symbol — disable
    "BR2_TARGET_GRUB2_BUILTIN_CONFIG":  None,   # legacy unsplit symbol — disable

    # ── Kernel: remove any moving-target symbols if they leaked in ────────────
    "BR2_LINUX_KERNEL_LATEST_VERSION":  None,
    "BR2_LINUX_KERNEL_LATEST_LTS_6_6":  None,
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
        if val is not None:
            config += f"\n{replacement}\n"
            print(f"  appended: {replacement}")
        else:
            print(f"  skip    : {sym} not present (already absent)")

with open(config_path, "w") as f:
    f.write(config)

print("Patch complete.")

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
with open(config_path) as f:
    final = f.read()

errors = 0

print("\nVerification:")

required_present = [
    "BR2_INIT_SYSTEMD=y",
    "BR2_TOOLCHAIN_BUILDROOT_WCHAR=y",
    "BR2_TOOLCHAIN_BUILDROOT_TLS=y",
    "BR2_PACKAGE_LIBCURL=y",
    "BR2_PACKAGE_LIBCURL_CURL=y",
]
required_absent = [
    "BR2_INIT_BUSYBOX=y",
    "BR2_TARGET_GRUB2_X86_EFI=y",          # wrong symbol name
    "BR2_TARGET_GRUB2_I386_PC=y",           # selects HAS_LEGACY_BOOT → BR2_LEGACY
    "BR2_TARGET_GRUB2_HAS_LEGACY_BOOT=y",   # the actual legacy trigger
    "BR2_PACKAGE_CURL=y",                    # legacy curl name → BR2_LEGACY
    "BR2_LINUX_KERNEL_LATEST_VERSION=y",
    "BR2_LINUX_KERNEL_LATEST_LTS_6_6=y",
    "BR2_LEGACY=y",
]

for sym in required_present:
    if re.search(r'^' + re.escape(sym) + r'$', final, re.MULTILINE):
        print(f"  OK  : {sym} present")
    else:
        print(f"  FAIL: {sym} is absent (required)", file=sys.stderr)
        errors += 1

for sym in required_absent:
    if re.search(r'^' + re.escape(sym) + r'$', final, re.MULTILINE):
        print(f"  FAIL: {sym} is present (must not be)", file=sys.stderr)
        if "LEGACY" in sym:
            # Print all legacy-related lines to help diagnose
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
