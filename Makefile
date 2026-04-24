# =============================================================================
# SAN Management Platform — Makefile
# Three isolated Docker images: san-db · san-backend · san-frontend
# =============================================================================

.PHONY: help setup build up down restart logs ps test seed clean rebuild

COMPOSE = docker compose

help:
	@echo ""
	@echo "  SAN Platform — three-image deployment"
	@echo ""
	@echo "  First time:"
	@echo "    make setup     Create secret files (edit them first!)"
	@echo "    make build     Build backend + frontend images"
	@echo "    make up        Start all three containers"
	@echo ""
	@echo "  Daily:"
	@echo "    make up        Start (or restart stopped) containers"
	@echo "    make down      Stop all containers"
	@echo "    make restart   Rebuild images and restart"
	@echo "    make logs      Tail all container logs"
	@echo "    make ps        Show container status"
	@echo ""
	@echo "  Development:"
	@echo "    make seed      Load demo switch + zones + metrics"
	@echo "    make test      Run unit + integration tests"
	@echo "    make shell-db  psql shell inside the DB container"
	@echo "    make shell-be  sh shell inside the backend container"
	@echo ""

# ── First-time setup ─────────────────────────────────────────────────────────
setup:
	@mkdir -p secrets
	@if [ ! -f secrets/db_password.txt ]; then \
	  echo "san_secret" > secrets/db_password.txt; \
	  chmod 600 secrets/db_password.txt; \
	  echo "  Created secrets/db_password.txt  (change the value!)"; \
	fi
	@if [ ! -f secrets/mds_password.txt ]; then \
	  echo "CHANGE_ME" > secrets/mds_password.txt; \
	  chmod 600 secrets/mds_password.txt; \
	  echo "  Created secrets/mds_password.txt  (set your MDS password!)"; \
	fi
	@echo ""
	@echo "  Edit secrets/*.txt, then run:  make build && make up"
	@echo ""

# ── Image builds ─────────────────────────────────────────────────────────────
build:
	$(COMPOSE) build --no-cache

build-backend:
	$(COMPOSE) build --no-cache backend

build-frontend:
	$(COMPOSE) build --no-cache frontend

# ── Lifecycle ─────────────────────────────────────────────────────────────────
up:
	$(COMPOSE) up -d
	@echo ""
	@echo "  Services starting…"
	@echo "  Dashboard: http://localhost:$${FRONTEND_PORT:-8080}"
	@echo ""
	@$(COMPOSE) ps

down:
	$(COMPOSE) down

restart: build up

stop:
	$(COMPOSE) stop

# ── Observability ────────────────────────────────────────────────────────────
logs:
	$(COMPOSE) logs -f --tail=50

logs-db:
	$(COMPOSE) logs -f --tail=50 db

logs-backend:
	$(COMPOSE) logs -f --tail=50 backend

logs-frontend:
	$(COMPOSE) logs -f --tail=50 frontend

ps:
	$(COMPOSE) ps

# ── Debug shells ─────────────────────────────────────────────────────────────
shell-db:
	$(COMPOSE) exec db psql -U san_admin -d san_zoning

shell-be:
	$(COMPOSE) exec backend sh

shell-fe:
	$(COMPOSE) exec frontend sh

# ── Data operations ───────────────────────────────────────────────────────────
seed:
	$(COMPOSE) exec backend sh -c "npx tsx prisma/seed.ts"

snapshot:
	@[ -n "$(SWITCH_ID)" ] || (echo "Usage: make snapshot SWITCH_ID=<uuid> VSAN_ID=100" && exit 1)
	curl -s -X POST http://localhost:$${FRONTEND_PORT:-8080}/api/snapshots/capture \
	  -H "Content-Type: application/json" \
	  -d '{"switchId":"$(SWITCH_ID)","vsanId":$(VSAN_ID)}' | python3 -m json.tool

# ── Tests ────────────────────────────────────────────────────────────────────
test:
	cd backend && npm install --silent && npx vitest run tests/

test-watch:
	cd backend && npx vitest

# ── Cleanup ───────────────────────────────────────────────────────────────────
clean:
	$(COMPOSE) down -v --remove-orphans
	docker image rm -f san-platform/backend:latest san-platform/frontend:latest 2>/dev/null || true
	@echo "  Containers, volumes, and images removed."

rebuild: clean build up

