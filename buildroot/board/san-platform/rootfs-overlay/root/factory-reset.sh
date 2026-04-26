#!/bin/sh
# /root/factory-reset.sh
# Clears all platform data and configuration for a clean restart.

RED='\033[0;31m'
YLW='\033[1;33m'
GRN='\033[0;32m'
RST='\033[0m'

printf "${RED}"
cat << 'WARN'
  ╔══════════════════════════════════════════════════════════════╗
  ║                    ⚠  FACTORY RESET  ⚠                      ║
  ║                                                              ║
  ║  This will PERMANENTLY DELETE:                               ║
  ║    • All database data (/var/lib/san-platform/pg_data)       ║
  ║    • All application secrets and credentials                 ║
  ║    • All Docker volumes and containers                       ║
  ║    • The setup completion stamp (setup wizard will re-run)   ║
  ║                                                              ║
  ║  The system will be returned to factory defaults.            ║
  ╚══════════════════════════════════════════════════════════════╝
WARN
printf "${RST}\n"

printf "${YLW}  Type 'RESET' to confirm, or anything else to cancel: ${RST}"
read -r CONFIRM
[ "${CONFIRM}" = "RESET" ] || { printf "  Cancelled.\n"; exit 0; }

printf "\nRunning factory reset...\n\n"

# Stop the platform stack
printf "  Stopping platform stack...\n"
/etc/init.d/S65san-platform stop 2>/dev/null || true

# Stop Docker
printf "  Stopping Docker...\n"
/etc/init.d/S45docker stop 2>/dev/null || true

# Remove all Docker containers, volumes, images
printf "  Removing Docker containers and volumes...\n"
/etc/init.d/S45docker start > /dev/null 2>&1
sleep 3
docker compose -f /opt/san-platform/docker-compose.yml down -v --remove-orphans 2>/dev/null || true
docker system prune -af --volumes 2>/dev/null || true

# Clear persistent data
printf "  Clearing persistent data...\n"
rm -rf /var/lib/san-platform/pg_data/*
rm -rf /var/lib/san-platform/logs/*
rm -f  /var/lib/san-platform/.setup-done
rm -f  /var/lib/san-platform/.images-loaded
rm -f  /var/lib/san-platform/.firstboot-done

# Clear secrets (reset to placeholder)
printf "  Resetting secrets...\n"
printf "san_secret" > /opt/san-platform/secrets/db_password.txt
printf "CHANGE_ME"  > /opt/san-platform/secrets/mds_password.txt
rm -f /opt/san-platform/secrets/jwt_secret.txt
rm -f /opt/san-platform/secrets/admin_password.txt
rm -f /opt/san-platform/secrets/mds_host.txt
rm -f /opt/san-platform/secrets/mds_user.txt
chmod 600 /opt/san-platform/secrets/*.txt 2>/dev/null || true

# Clear .env
rm -f /opt/san-platform/.env

# Reset hostname
hostname buildroot
printf "buildroot" > /etc/hostname 2>/dev/null || true

printf "\n${GRN}  Factory reset complete.${RST}\n"
printf "  Reboot to run the setup wizard on next login:\n"
printf "    reboot\n\n"
