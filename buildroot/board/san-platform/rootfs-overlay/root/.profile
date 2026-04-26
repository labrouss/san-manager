#!/bin/sh
# /root/.profile — root user login profile

# Auto-run setup wizard on first login
if [ ! -f /var/lib/san-platform/.setup-done ]; then
    exec /root/setup.sh
fi

# After setup: show status and useful info
printf "\n  SAN Management Platform\n"
printf "  ─────────────────────────────────────────────\n"

IP=$(ip route get 1.1.1.1 2>/dev/null \
    | awk '/src/ {for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
[ -n "${IP}" ] \
    && printf "  Web UI  : http://%s:8080\n" "${IP}" \
    || printf "  Web UI  : http://<ip>:8080  (network not ready)\n"

printf "  Stack   : /etc/init.d/S60san-platform {status|start|stop|restart}\n"
printf "  Setup   : /root/setup.sh\n"
printf "  ─────────────────────────────────────────────\n\n"
