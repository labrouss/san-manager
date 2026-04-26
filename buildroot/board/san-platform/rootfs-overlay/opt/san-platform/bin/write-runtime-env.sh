#!/bin/sh
# Regenerates .env — called by S65san-platform, no systemctl dependency
exec /etc/init.d/S65san-platform start
