#!/bin/sh
# /root/setup.sh — SAN Platform Initial Setup Wizard

STAMP="/var/lib/san-platform/.setup-done"
SECRETS="/opt/san-platform/secrets"
INTERFACES="/etc/network/interfaces"

RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
CYN='\033[0;36m'
BLD='\033[1m'
RST='\033[0m'

banner() {
    clear
    printf "${CYN}"
    cat << 'BANNER'
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║         SAN Management Platform — Initial Setup              ║
  ║                                                              ║
  ╚══════════════════════════════════════════════════════════════╝
BANNER
    printf "${RST}\n"
}

section() { printf "\n${BLD}${CYN}━━━  %s  ━━━${RST}\n\n" "$1"; }
ok()      { printf "  ${GRN}✓${RST}  %s\n" "$1"; }
warn()    { printf "  ${YLW}!${RST}  %s\n" "$1"; }
err()     { printf "  ${RED}✗${RST}  %s\n" "$1"; }

ask() {
    _var="$1"; _prompt="$2"; _default="${3:-}"
    [ -n "${_default}" ] && printf "${YLW}  %s${RST} [%s]: " "${_prompt}" "${_default}" \
                         || printf "${YLW}  %s${RST}: " "${_prompt}"
    read -r _input
    eval "${_var}=\"${_input:-${_default}}\""
}

ask_secret() {
    _var="$1"; _prompt="$2"
    printf "${YLW}  %s${RST}: " "${_prompt}"
    stty -echo 2>/dev/null; read -r _input; stty echo 2>/dev/null
    printf "\n"
    eval "${_var}=\"${_input}\""
}

confirm() {
    printf "${YLW}  %s${RST} [y/N]: " "$1"
    read -r _a
    case "${_a}" in [yY]*) return 0;; *) return 1;; esac
}

[ -f "${STAMP}" ] && exit 0
[ "$(id -u)" -eq 0 ] || { err "Must run as root."; exit 1; }

# =============================================================================
# STEP 0 — Welcome
# =============================================================================
banner
printf "  Welcome. This wizard configures the appliance before first use.\n"
printf "  Press ${BLD}Enter${RST} to keep the default shown in [brackets].\n\n"
printf "  Press Enter to begin..."; read -r _dummy

# =============================================================================
# STEP 1 — Hostname
# =============================================================================
banner
section "Step 1 of 6 — Hostname"
CURRENT_HOST=$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null || printf "san-platform")
ask NEWHOSTNAME "Appliance hostname" "san-platform"
if [ -n "${NEWHOSTNAME}" ] && [ "${NEWHOSTNAME}" != "${CURRENT_HOST}" ]; then
    hostname "${NEWHOSTNAME}"
    printf "%s\n" "${NEWHOSTNAME}" > /etc/hostname
    # Update /etc/hosts
    sed -i "s/127\.0\.1\.1.*/127.0.1.1\t${NEWHOSTNAME}/" /etc/hosts 2>/dev/null || \
        printf "127.0.1.1\t%s\n" "${NEWHOSTNAME}" >> /etc/hosts
    ok "Hostname set to: ${NEWHOSTNAME}"
fi
printf "\n  Press Enter to continue..."; read -r _dummy

# =============================================================================
# STEP 2 — Network
# =============================================================================
banner
section "Step 2 of 6 — Network Configuration"
printf "  Current eth0 address:\n"
ip addr show eth0 2>/dev/null | grep "inet " | sed 's/^/    /' || printf "    (not configured)\n"
printf "\n"

if confirm "Use DHCP (automatic IP)?"; then
    cat > "${INTERFACES}" << 'NET'
auto lo
iface lo inet loopback
auto eth0
iface eth0 inet dhcp
NET
    ifdown eth0 2>/dev/null; ifup eth0 2>/dev/null
    sleep 2
    IP=$(ip route get 1.1.1.1 2>/dev/null \
        | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
    [ -n "${IP}" ] && ok "DHCP IP: ${IP}" || warn "Waiting for DHCP lease..."
else
    ask STATIC_IP   "IP address"      "192.168.1.100"
    ask STATIC_MASK "Subnet mask"     "255.255.255.0"
    ask STATIC_GW   "Default gateway" "192.168.1.1"
    ask STATIC_DNS  "DNS server"      "8.8.8.8"
    cat > "${INTERFACES}" << NET
auto lo
iface lo inet loopback
auto eth0
iface eth0 inet static
    address ${STATIC_IP}
    netmask ${STATIC_MASK}
    gateway ${STATIC_GW}
    dns-nameservers ${STATIC_DNS}
NET
    ifdown eth0 2>/dev/null; ifup eth0 2>/dev/null
    ok "Static IP configured: ${STATIC_IP}"
    IP="${STATIC_IP}"
fi
printf "\n  Press Enter to continue..."; read -r _dummy

# =============================================================================
# STEP 3 — System Passwords
# =============================================================================
banner
section "Step 3 of 6 — System Passwords"
printf "  Sets the password for:\n"
printf "    • root  (console login)\n"
printf "    • admin (SSH login via: ssh admin@<ip>)\n\n"

_pass_ok=0
while [ "${_pass_ok}" -eq 0 ]; do
    ask_secret P1 "Password (min 8 chars)"
    [ "${#P1}" -lt 8 ] && { warn "Too short — minimum 8 characters."; continue; }
    ask_secret P2 "Confirm password"
    [ "${P1}" = "${P2}" ] && _pass_ok=1 || err "Passwords do not match."
done

printf "%s\n%s\n" "${P1}" "${P1}" | passwd root  2>/dev/null && ok "root password set"  || err "Failed to set root password"
printf "%s\n%s\n" "${P1}" "${P1}" | passwd admin 2>/dev/null && ok "admin password set" || warn "admin user may not exist yet"
unset P1 P2
printf "\n  Press Enter to continue..."; read -r _dummy

# =============================================================================
# STEP 4 — Application Credentials
# =============================================================================
banner
section "Step 4 of 6 — Application Credentials"
mkdir -p "${SECRETS}"

printf "  ${BLD}Database password${RST}\n\n"
_pass_ok=0
while [ "${_pass_ok}" -eq 0 ]; do
    ask_secret D1 "DB password (min 8 chars)"
    [ "${#D1}" -lt 8 ] && { warn "Too short."; continue; }
    ask_secret D2 "Confirm DB password"
    [ "${D1}" = "${D2}" ] && _pass_ok=1 || err "No match."
done
printf "%s" "${D1}" > "${SECRETS}/db_password.txt"; chmod 600 "${SECRETS}/db_password.txt"
ok "Database password saved"
unset D1 D2

printf "\n  ${BLD}Web UI admin password${RST}\n\n"
_pass_ok=0
while [ "${_pass_ok}" -eq 0 ]; do
    ask_secret A1 "Admin UI password (min 8 chars)"
    [ "${#A1}" -lt 8 ] && { warn "Too short."; continue; }
    ask_secret A2 "Confirm admin UI password"
    [ "${A1}" = "${A2}" ] && _pass_ok=1 || err "No match."
done
printf "%s" "${A1}" > "${SECRETS}/admin_password.txt"; chmod 600 "${SECRETS}/admin_password.txt"
ok "Admin UI password saved"
unset A1 A2
printf "\n  Press Enter to continue..."; read -r _dummy

# =============================================================================
# STEP 5 — MDS Switch Settings
# =============================================================================
banner
section "Step 5 of 6 — MDS Switch Settings"
ask MDS_HOST "MDS switch IP or hostname (leave blank to skip)" ""
if [ -n "${MDS_HOST}" ]; then
    ask MDS_USER "MDS admin username" "admin"
    ask_secret MDS_PASS "MDS admin password"
    printf "%s" "${MDS_PASS}"  > "${SECRETS}/mds_password.txt"; chmod 600 "${SECRETS}/mds_password.txt"
    printf "%s" "${MDS_HOST}"  > "${SECRETS}/mds_host.txt";     chmod 600 "${SECRETS}/mds_host.txt"
    printf "%s" "${MDS_USER}"  > "${SECRETS}/mds_user.txt";     chmod 600 "${SECRETS}/mds_user.txt"
    ok "MDS settings saved"
    unset MDS_PASS
else
    warn "MDS switch skipped — configure later in ${SECRETS}/"
    [ -f "${SECRETS}/mds_password.txt" ] || printf "CHANGE_ME" > "${SECRETS}/mds_password.txt"
fi
printf "\n  Press Enter to continue..."; read -r _dummy

# =============================================================================
# STEP 6 — Start Platform
# =============================================================================
banner
section "Step 6 of 6 — Start Platform"

CURRENT_IP=$(ip route get 1.1.1.1 2>/dev/null \
    | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
CURRENT_IP="${CURRENT_IP:-<not connected>}"

printf "  ${BLD}Configuration Summary${RST}\n\n"
printf "    Hostname    : ${GRN}%s${RST}\n"        "$(hostname)"
printf "    IP Address  : ${GRN}%s${RST}\n"        "${CURRENT_IP}"
printf "    Web UI      : ${GRN}http://%s:8080${RST}\n" "${CURRENT_IP}"
printf "    SSH access  : ${GRN}ssh admin@%s${RST}\n"   "${CURRENT_IP}"
[ -f "${SECRETS}/mds_host.txt" ] && \
    printf "    MDS switch  : ${GRN}%s${RST}\n" "$(cat "${SECRETS}/mds_host.txt")" || \
    printf "    MDS switch  : ${YLW}not configured${RST}\n"
printf "\n"

# Write stamp BEFORE starting so S65san-platform doesn't block
mkdir -p "$(dirname "${STAMP}")"
date -u > "${STAMP}"

if confirm "Start the SAN Platform now?"; then
    printf "\n  Stopping any existing stack...\n"
    /etc/init.d/S65san-platform stop 2>/dev/null || true
    sleep 2

    printf "  Loading Docker images (first time may take a moment)...\n"
    /etc/init.d/S55san-platform-load start

    printf "  Starting platform stack...\n"
    /etc/init.d/S65san-platform start

    sleep 5
    printf "\n"
    ok "Platform started!"
    printf "\n  Browse to: ${BLD}${CYN}http://%s:8080${RST}\n" "${CURRENT_IP}"
else
    warn "Start manually with: /etc/init.d/S65san-platform start"
fi

printf "\n\n  ${GRN}${BLD}Setup complete!${RST}\n"
printf "  This wizard will not run again.\n"
printf "  To reset:  ${CYN}/root/factory-reset.sh${RST}\n"
printf "  To re-run: ${CYN}rm %s && /root/setup.sh${RST}\n\n" "${STAMP}"
