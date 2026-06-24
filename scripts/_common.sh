#!/usr/bin/env bash
#
# LiveBoard — shared helpers (sourced by start.sh and dev.sh)
#
# Works on macOS (Homebrew PostgreSQL) and Linux (system/apt PostgreSQL).

set -euo pipefail

POSTGRES_PORT="${POSTGRES_PORT:-5432}"
BACKEND_PORT="${BACKEND_PORT:-8002}"
FRONTEND_PORT="${FRONTEND_PORT:-5175}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*"; }

kill_port() {
    local port=$1
    local pids
    pids=$(lsof -ti ":$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "$pids" | while read -r pid; do
            log_warn "Killing process on port $port (pid $pid)"
            kill -9 "$pid" 2>/dev/null || true
        done
    fi
}

stop_all() {
    log_info "Stopping old LiveBoard processes ..."
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    kill_port "$BACKEND_PORT"
    kill_port "$FRONTEND_PORT"
    sleep 1
    log_ok "Old processes cleared"
}

ensure_pg() {
    if pg_isready -h localhost -p "$POSTGRES_PORT" -q 2>/dev/null; then
        log_ok "PostgreSQL is already running on localhost:$POSTGRES_PORT"
        return 0
    fi

    # macOS — try Homebrew
    if command -v brew &>/dev/null; then
        local brew_pg
        brew_pg=$(brew --prefix postgresql@16 2>/dev/null || echo "")
        if [ -n "$brew_pg" ]; then
            log_info "Starting PostgreSQL via Homebrew ..."
            brew services start postgresql@16 2>/dev/null || true
        fi
    fi

    # Linux — try systemctl
    if command -v systemctl &>/dev/null; then
        for svc in postgresql postgresql@16-main; do
            if systemctl is-active --quiet "$svc" 2>/dev/null; then
                log_ok "PostgreSQL already active via systemd ($svc)"
                return 0
            fi
        done
        for svc in postgresql postgresql@16-main; do
            if systemctl start "$svc" 2>/dev/null; then
                log_info "Started PostgreSQL via systemd ($svc)"
                break
            fi
        done
    fi

    local max_attempts=15
    local attempt=1
    log_info "Waiting for PostgreSQL on localhost:$POSTGRES_PORT ..."
    while [ $attempt -le $max_attempts ]; do
        if pg_isready -h localhost -p "$POSTGRES_PORT" -q 2>/dev/null; then
            log_ok "PostgreSQL is ready (localhost:$POSTGRES_PORT)"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done

    log_error "PostgreSQL did not become ready in ${max_attempts}s"
    log_error "Ensure PostgreSQL is running on localhost:$POSTGRES_PORT"
    return 1
}

start_backend() {
    local port="${1:-$BACKEND_PORT}"
    local label="${2:-backend}"
    log_info "Starting $label on port $port ..."
    cd "$PROJECT_ROOT/backend"

    if [ ! -f .env ]; then
        cp .env.example .env
        log_info "Created backend/.env from .env.example"
    fi

    log_info "Running database migrations ..."
    uv run alembic upgrade head
    log_ok "Migrations complete"

    uv run uvicorn app.main:app \
        --host 0.0.0.0 \
        --port "$port" \
        --reload \
        --proxy-headers \
        --forwarded-allow-ips='*' \
        --log-level info \
        &
    echo "$!"  # return PID via stdout
    log_ok "$label started (port $port)"
}

wait_for_backend() {
    local port="${1:-$BACKEND_PORT}"
    local max_attempts=20
    local attempt=1
    log_info "Waiting for backend on port $port ..."
    while [ $attempt -le $max_attempts ]; do
        if curl -sfS "http://localhost:$port/health" >/dev/null 2>&1; then
            log_ok "Backend is ready (localhost:$port)"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    log_error "Backend did not become ready on port $port in ${max_attempts}s"
    return 1
}
