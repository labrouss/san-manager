#!/bin/sh
# =============================================================================
# /root/setup.sh
#
# SAN Platform — First Login Setup Wizard
#
# Runs automatically on the first login via /root/.profile.
# Guides the operator through:
#   1. Network configuration (DHCP or static IP)
#   2. Setting the root password
#   3. Application credentials (DB password, MDS switch password, admin UI)
#   4. Optional: MDS switch address
#   5. Starting the platform stack
#
# After completing setup, the wizard is disabled (stamp file written to
# prevent it from running again on subsequent logins).
# =============================================================================

STAMP="/var/lib/san-platform/.setup-done"
SECRETS="/opt/san-platform/secrets"
INTERFACES="/etc/network/interfaces"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
CYN='\033[0;36m'
BLD='\033[1m'
RST='\033[0m'

# ── Helpers ───────────────────────────────────────────────────────────────────
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

section() {
    printf "\n${BLD}${CYN}━━━  %s  ━━━${RST}\n\n" "$1"
}

ok()   { printf "  ${GRN}✓${RST}  %s\n" "$1"; }
warn() { printf "  ${YLW}!${RST}  %s\n" "$1"; }
err()  { printf "  ${RED}✗${RST}  %s\n" "$1"; }

ask() {
    # ask <var> <prompt> [default]
    _var="$1"; _prompt="$2"; _default="${3:-}"
    if [ -n "${_default}" ]; then
        printf "${YLW}  %s${RST} [%s]: " "${_prompt}" "${_default}"
    else
        printf "${YLW}  %s${RST}: " "${_prompt}"
    fi
    read -r _input
    eval "${_var}=\"${_input:-${_default}}\""
}

ask_secret() {
    # ask_secret <var> <prompt>
    _var="$1"; _prompt="$2"
    printf "${YLW}  %s${RST}: " "${_prompt}"
    stty -echo 2>/dev/null
    read -r _input
    stty echo 2>/dev/null
    printf "\n"
    eval "${_var}=\"${_input}\""
}

confirm() {
    # confirm <prompt> — returns 0 for yes, 1 for no
    printf "${YLW}  %s${RST} [y/N]: " "$1"
    read -r _ans
    case "${_ans}" in
        [yY]|[yY][eE][sS]) return 0 ;;
        *) return 1 ;;
    esac
}

write_secret() {
    _file="${SECRETS}/$1"; _value="$2"
    printf "%s" "${_value}" > "${_file}"
    chmod 600 "${_file}"
    ok "Saved to ${_file}"
}

# ── Check if already done ─────────────────────────────────────────────────────
[ -f "${STAMP}" ] && exit 0

# ── Require root ──────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || {
    err "This script must be run as root."
    exit 1
}

# =============================================================================
# STEP 0 — Welcome
# =============================================================================
banner
printf "  Welcome to the SAN Management Platform appliance.\n"
printf "  This wizard will configure the system before first use.\n"
printf "  Press ${BLD}Enter${RST} to keep the default shown in [brackets].\n"
printf "\n  Press Enter to begin..."
read -r _dummy

# =============================================================================
# STEP 1 — Network Configuration
# =============================================================================
banner
section "Step 1 of 5 — Network Configuration"

printf "  Current network interfaces:\n"
ip addr show eth0 2>/dev/null | grep -E "inet |link" | sed 's/^/    /' || \
    printf "    (eth0 not found)\n"
printf "\n"

if confirm "Use DHCP (automatic IP)?"; then
    # Write DHCP config
    cat > "${INTERFACES}" << 'NET'
auto lo
iface lo inet loopback

auto eth0
iface eth0 inet dhcp
NET
    ok "Network set to DHCP"

    # Bring interface up now
    ifdown eth0 2>/dev/null; ifup eth0 2>/dev/null
    sleep 2

    IP=$(ip route get 1.1.1.1 2>/dev/null \
        | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' \
        | head -1)
    [ -n "${IP}" ] && ok "Assigned IP: ${IP}" || warn "DHCP lease pending — IP not yet assigned"

else
    section "Static IP Configuration"
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

printf "\n  Press Enter to continue..."
read -r _dummy

# =============================================================================
# STEP 2 — Root Password
# =============================================================================
banner
section "Step 2 of 5 — Root Password"

printf "  Set the root (system administrator) password for SSH/console access.\n\n"

_pass_ok=0
while [ "${_pass_ok}" -eq 0 ]; do
    ask_secret ROOT_PASS1 "New root password"
    [ -z "${ROOT_PASS1}" ] && { warn "Password cannot be empty."; continue; }
    ask_secret ROOT_PASS2 "Confirm password"
    [ "${ROOT_PASS1}" = "${ROOT_PASS2}" ] && _pass_ok=1 || err "Passwords do not match — try again."
done

printf "%s\n%s\n" "${ROOT_PASS1}" "${ROOT_PASS1}" | passwd root 2>/dev/null \
    && ok "Root password updated" \
    || err "Failed to set root password"

unset ROOT_PASS1 ROOT_PASS2

printf "\n  Press Enter to continue..."
read -r _dummy

# =============================================================================
# STEP 3 — Application Credentials
# =============================================================================
banner
section "Step 3 of 5 — Application Credentials"

mkdir -p "${SECRETS}"

# Database password
printf "  ${BLD}PostgreSQL / TimescaleDB password${RST}\n"
printf "  This is the internal database password. Store it somewhere safe.\n\n"
_pass_ok=0
while [ "${_pass_ok}" -eq 0 ]; do
    ask_secret DB_PASS1 "Database password (min 8 chars)"
    [ ${#DB_PASS1} -lt 8 ] && { warn "Password too short (min 8 characters)."; continue; }
    ask_secret DB_PASS2 "Confirm database password"
    [ "${DB_PASS1}" = "${DB_PASS2}" ] && _pass_ok=1 || err "Passwords do not match."
done
write_secret "db_password.txt" "${DB_PASS1}"
unset DB_PASS1 DB_PASS2

printf "\n"

# Admin UI password
printf "  ${BLD}Web UI admin password${RST}\n"
printf "  This is the password for the 'admin' account in the browser interface.\n\n"
_pass_ok=0
while [ "${_pass_ok}" -eq 0 ]; do
    ask_secret ADMIN_PASS1 "Admin UI password (min 8 chars)"
    [ ${#ADMIN_PASS1} -lt 8 ] && { warn "Password too short."; continue; }
    ask_secret ADMIN_PASS2 "Confirm admin UI password"
    [ "${ADMIN_PASS1}" = "${ADMIN_PASS2}" ] && _pass_ok=1 || err "Passwords do not match."
done
write_secret "admin_password.txt" "${ADMIN_PASS1}"
unset ADMIN_PASS1 ADMIN_PASS2

printf "\n  Press Enter to continue..."
read -r _dummy

# =============================================================================
# STEP 4 — MDS Switch Settings
# =============================================================================
banner
section "Step 4 of 5 — MDS Switch Settings"

printf "  Configure the credentials used to connect to your Cisco MDS 9000\n"
printf "  series SAN switches. You can change these later in:\n"
printf "  ${CYN}/opt/san-platform/secrets/${RST}\n\n"

ask MDS_HOST "MDS switch IP or hostname (leave blank to skip)" ""

if [ -n "${MDS_HOST}" ]; then
    ask MDS_USER "MDS admin username" "admin"
    ask_secret MDS_PASS "MDS admin password"
    write_secret "mds_password.txt" "${MDS_PASS}"
    printf "%s" "${MDS_HOST}" > "${SECRETS}/mds_host.txt"
    printf "%s" "${MDS_USER}" > "${SECRETS}/mds_user.txt"
    chmod 600 "${SECRETS}/mds_host.txt" "${SECRETS}/mds_user.txt"
    ok "MDS settings saved"
    unset MDS_PASS
else
    warn "MDS switch not configured — you can add it later."
    # Keep placeholder
    [ -f "${SECRETS}/mds_password.txt" ] || printf "CHANGE_ME" > "${SECRETS}/mds_password.txt"
fi

printf "\n  Press Enter to continue..."
read -r _dummy

# =============================================================================
# STEP 5 — Review and Start
# =============================================================================
banner
section "Step 5 of 5 — Review & Start Platform"

CURRENT_IP=$(ip route get 1.1.1.1 2>/dev/null \
    | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
CURRENT_IP="${CURRENT_IP:-<not connected>}"

printf "  ${BLD}Configuration Summary${RST}\n\n"
printf "    IP Address    : ${GRN}%s${RST}\n"  "${CURRENT_IP}"
printf "    Web UI URL    : ${GRN}http://%s:8080${RST}\n" "${CURRENT_IP}"
printf "    Admin login   : ${GRN}admin${RST} / (password you just set)\n"
printf "    DB password   : ${GRN}(saved to secrets/)${RST}\n"
[ -f "${SECRETS}/mds_host.txt" ] && \
    printf "    MDS switch    : ${GRN}%s${RST}\n" "$(cat "${SECRETS}/mds_host.txt")" || \
    printf "    MDS switch    : ${YLW}not configured${RST}\n"
printf "\n"

if confirm "Start the SAN Platform now?"; then
    printf "\n  Starting platform services...\n\n"
    /etc/init.d/S40docker start
    /etc/init.d/S50san-platform-load start
    /etc/init.d/S60san-platform start

    sleep 3
    printf "\n"
    ok "Platform started!"
    printf "\n  Browse to: ${BLD}${CYN}http://%s:8080${RST}\n" "${CURRENT_IP}"
else
    warn "Platform not started. Start it manually with:"
    printf "      ${CYN}/etc/init.d/S60san-platform start${RST}\n"
fi

# =============================================================================
# Done — write stamp and update .profile
# =============================================================================
mkdir -p "$(dirname "${STAMP}")"
date -u > "${STAMP}"

printf "\n\n  ${GRN}${BLD}Setup complete!${RST}\n"
printf "  This wizard will not run again on subsequent logins.\n"
printf "  To re-run: ${CYN}rm %s && /root/setup.sh${RST}\n\n" "${STAMP}"

printf "  ${BLD}Useful commands:${RST}\n"
printf "    /etc/init.d/S60san-platform status|start|stop|restart\n"
printf "    docker compose -f /opt/san-platform/docker-compose.yml ps\n"
printf "    /root/setup.sh  (re-run this wizard)\n\n"
