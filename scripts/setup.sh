#!/usr/bin/env bash
#
# LiveBoard — one-command project setup
#
# Usage:
#   ./scripts/setup.sh
#
# What it does:
#   1. Checks prerequisites (uv, node, docker/postgres)
#   2. Copies example env files if needed
#   3. Installs backend dependencies and runs migrations
#   4. Installs frontend dependencies
#   5. Prints instructions for starting the project

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

HAS_ERROR=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log_info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; HAS_ERROR=1; }
log_step()  { echo ""; echo -e "${BOLD}${CYAN}── $* ──${NC}"; }

die() {
    log_error "$*"
    exit 1
}

# ---------------------------------------------------------------------------
# Welcome
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║       LiveBoard Project Setup        ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
log_step "1. Checking prerequisites"

# --- uv (Python package manager) ---
if command -v uv &>/dev/null; then
    UV_VERSION=$(uv --version 2>/dev/null | head -1)
    log_ok "uv found: $UV_VERSION"
else
    log_error "uv not found — install it from https://docs.astral.sh/uv/getting-started/installation/"
fi

# --- node (>= 18) ---
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version | sed 's/^v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        log_ok "node found: v$NODE_VERSION"
    else
        log_error "node v$NODE_VERSION is too old — need >= 18"
    fi
else
    log_error "node not found — install Node.js >= 18 from https://nodejs.org/"
fi

# --- docker or postgres ---
PG_READY=0
if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
    log_ok "docker compose found"
    PG_READY=1
elif command -v pg_isready &>/dev/null; then
    log_ok "pg_isready found (native PostgreSQL)"
    PG_READY=1
else
    log_warn "Neither docker compose nor pg_isready found"
    log_warn "You'll need a running PostgreSQL instance before starting the app"
fi

# --- make ---
if command -v make &>/dev/null; then
    log_ok "make found"
else
    log_warn "make not found — optional, but useful for development tasks"
fi

if [ "$HAS_ERROR" -eq 1 ]; then
    die "Please fix the errors above and re-run this script."
fi

echo -e "${GREEN}All prerequisites satisfied.${NC}"

# ---------------------------------------------------------------------------
# 2. Environment files
# ---------------------------------------------------------------------------
log_step "2. Setting up environment files"

# Root .env
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    if [ -f "$PROJECT_ROOT/.env.example" ]; then
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
        log_ok "Created .env from .env.example"
    else
        log_warn ".env.example not found — skipping root .env"
    fi
else
    log_ok ".env already exists — skipping"
fi

# Backend .env
if [ ! -f "$PROJECT_ROOT/backend/.env" ]; then
    if [ -f "$PROJECT_ROOT/backend/.env.example" ]; then
        cp "$PROJECT_ROOT/backend/.env.example" "$PROJECT_ROOT/backend/.env"
        log_ok "Created backend/.env from backend/.env.example"
    else
        log_warn "backend/.env.example not found — skipping backend .env"
    fi
else
    log_ok "backend/.env already exists — skipping"
fi

# ---------------------------------------------------------------------------
# 3. Backend setup
# ---------------------------------------------------------------------------
log_step "3. Setting up backend"

cd "$PROJECT_ROOT/backend"

log_info "Installing Python dependencies with uv ..."
uv sync
log_ok "Python dependencies installed"

# Run database migrations
if [ "$PG_READY" -eq 1 ]; then
    log_info "Running database migrations ..."

    # Prefer docker compose, fall back to direct alembic
    if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
        if docker compose -f "$PROJECT_ROOT/docker-compose.yml" exec -T backend uv run alembic upgrade head 2>/dev/null; then
            log_ok "Migrations complete (docker compose)"
        else
            log_info "Docker compose exec failed, trying direct alembic ..."
            uv run alembic upgrade head
            log_ok "Migrations complete (direct)"
        fi
    else
        uv run alembic upgrade head
        log_ok "Migrations complete"
    fi
else
    log_warn "No PostgreSQL detected — skipping migrations"
    log_warn "Run 'uv run alembic upgrade head' after starting your database"
fi

cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# 4. Frontend setup
# ---------------------------------------------------------------------------
log_step "4. Setting up frontend"

cd "$PROJECT_ROOT/frontend"

log_info "Installing Node.js dependencies with npm ci ..."
npm ci
log_ok "Node.js dependencies installed"

cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# 5. Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${BOLD}${GREEN}║          Setup Complete!             ║${NC}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "  To start the development servers:"
echo ""
echo -e "    ${BOLD}./scripts/start.sh${NC}"
echo ""
echo -e "  Or start services individually:"
echo ""
echo -e "    ${BOLD}./scripts/start.sh --db${NC}      # ensure PostgreSQL is running"
echo -e "    ${BOLD}cd backend && uv run uvicorn app.main:app --reload${NC}"
echo -e "    ${BOLD}cd frontend && npm run dev${NC}"
echo ""
