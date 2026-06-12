# Extreme Weather Tracker — task runner.
#
# Four independent layers, no root toolchain of their own: this Makefile is the
# single entry point. ingestion/ + api/ share the root .venv; web/ uses npm.
#
# Run `make` (or `make help`) to see every target.

# Load root .env and export it so recipes (notably the API, which reads
# DATABASE_URL straight from the environment) all see DATABASE_URL / FIRMS_MAP_KEY.
ifneq (,$(wildcard .env))
include .env
export
endif

VENV    := .venv
PY      := $(VENV)/bin/python
PIP     := $(VENV)/bin/pip
UVICORN := $(VENV)/bin/uvicorn

.DEFAULT_GOAL := help

# ---------------------------------------------------------------------------
# Help
# ---------------------------------------------------------------------------
.PHONY: help
help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
.PHONY: install install-py install-web venv
install: install-py install-web ## Install all dependencies (Python venv + web node_modules)

$(VENV)/bin/python:
	python3 -m venv $(VENV)

venv: $(VENV)/bin/python ## Create the shared root virtualenv

install-py: venv ## Install ingestion + api Python deps into the root venv
	$(PIP) install -q -U pip
	$(PIP) install -q -r ingestion/requirements.txt
	$(PIP) install -q -r api/requirements.txt

install-web: ## Install web dependencies (npm ci)
	cd web && npm ci

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
.PHONY: db-init
db-init: ## Apply db/schema.sql to $DATABASE_URL (idempotent)
	@test -n "$(DATABASE_URL)" || { echo "DATABASE_URL is not set (check .env)"; exit 1; }
	psql "$(DATABASE_URL)" -f db/schema.sql

# ---------------------------------------------------------------------------
# Ingestion (Python ETL — run from ingestion/, loads root .env)
# ---------------------------------------------------------------------------
.PHONY: ingest ingest-gdacs ingest-firms ingest-temperature
ingest: ## Run ingestion for all sources
	cd ingestion && ../$(PY) run.py

ingest-gdacs: ## Ingest GDACS only
	cd ingestion && ../$(PY) run.py --source gdacs

ingest-firms: ## Ingest NASA FIRMS only (needs FIRMS_MAP_KEY)
	cd ingestion && ../$(PY) run.py --source firms

ingest-temperature: ## Ingest Open-Meteo temperature only
	cd ingestion && ../$(PY) run.py --source temperature

# ---------------------------------------------------------------------------
# API (read-only FastAPI — localhost:8000)
# ---------------------------------------------------------------------------
.PHONY: api
api: ## Run the API with auto-reload on :8000
	@test -n "$(DATABASE_URL)" || { echo "DATABASE_URL is not set (check .env)"; exit 1; }
	cd api && ../$(UVICORN) index:app --reload --port 8000

# ---------------------------------------------------------------------------
# Web (Next.js — localhost:3000)
# ---------------------------------------------------------------------------
.PHONY: web build lint
web: ## Run the web dev server on :3000
	cd web && npm run dev

build: ## Build the web app (also typechecks)
	cd web && npm run build

lint: ## Lint the web app
	cd web && npm run lint

# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------
.PHONY: clean
clean: ## Remove venv, node_modules, build output and Python caches
	rm -rf $(VENV) web/node_modules web/.next
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
