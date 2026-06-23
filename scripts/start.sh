#!/usr/bin/env bash
#
# LiveBoard — dev server launcher (local PostgreSQL via Homebrew)
#
# Options:
#   ./scripts/start.sh           start all  (stop old + Postgres + backend + frontend)
#   ./scripts/start.sh --stop    only stop old processes
#   ./scripts/start.sh --db      only ensure Postgres is running
#
# Ports (override with env vars):
#   POSTGRES_PORT   default 5432
#   BACKEND_PORT    default 8002
#   FRONTEND_PORT   default 5175

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

POSTGRES_PORT="${POSTGRES_PORT:-5432}"
BACKEND_PORT="${BACKEND_PORT:-8002}"
FRONTEND_PORT="${FRONTEND_PORT:-5175}"

# Homebrew PostgreSQL paths
BREW_PREFIX="$(brew --prefix postgresql@16 2>/dev/null || echo /opt/homebrew/opt/postgresql@16)"
PG_BIN="$BREW_PREFIX/bin"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
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

# ---------------------------------------------------------------------------
# Stop old processes
# ---------------------------------------------------------------------------
stop_all() {
    log_info "Stopping old LiveBoard processes ..."

    # Kill old uvicorn / vite processes
    pkill -f "uvicorn app.main:app" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true

    # Kill anything lingering on our ports
    kill_port "$BACKEND_PORT"
    kill_port "$FRONTEND_PORT"

    sleep 1
    log_ok "Old processes cleared"
}

# ---------------------------------------------------------------------------
# Ensure PostgreSQL is running (via Homebrew service)
# ---------------------------------------------------------------------------
ensure_pg() {
    # Check if PostgreSQL is already accepting connections
    if "$PG_BIN/pg_isready" -h localhost -p "$POSTGRES_PORT" -q 2>/dev/null; then
        log_ok "PostgreSQL is already running on localhost:$POSTGRES_PORT"
        return 0
    fi

    # Try starting via brew services
    if command -v brew &>/dev/null; then
        log_info "Starting PostgreSQL via brew services ..."
        brew services start postgresql@16 2>/dev/null || true
    fi

    # Wait for it
    local max_attempts=15
    local attempt=1
    log_info "Waiting for PostgreSQL on localhost:$POSTGRES_PORT ..."
    while [ $attempt -le $max_attempts ]; do
        if "$PG_BIN/pg_isready" -h localhost -p "$POSTGRES_PORT" -q 2>/dev/null; then
            log_ok "PostgreSQL is ready (localhost:$POSTGRES_PORT)"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done

    log_error "PostgreSQL did not become ready in ${max_attempts}s"
    log_error "Try: brew services start postgresql@16"
    return 1
}

# ---------------------------------------------------------------------------
# Start Backend (host, hot reload)
# ---------------------------------------------------------------------------
start_backend() {
    log_info "Starting backend on port $BACKEND_PORT ..."
    cd "$PROJECT_ROOT/backend"

    # Ensure .env exists
    if [ ! -f .env ]; then
        cp .env.example .env
        log_info "Created backend/.env from .env.example"
    fi

    # Run migrations
    log_info "Running database migrations ..."
    uv run alembic upgrade head
    log_ok "Migrations complete"

    uv run uvicorn app.main:app \
        --host 0.0.0.0 \
        --port "$BACKEND_PORT" \
        --reload \
        --log-level info \
        &
    BACKEND_PID=$!
    log_ok "Backend started (pid $BACKEND_PID, port $BACKEND_PORT)"
}

# ---------------------------------------------------------------------------
# Start Frontend (host, hot reload)
# ---------------------------------------------------------------------------
start_frontend() {
    log_info "Starting frontend on port $FRONTEND_PORT ..."
    cd "$PROJECT_ROOT/frontend"

    npm run dev -- --port "$FRONTEND_PORT" &
    FRONTEND_PID=$!
    log_ok "Frontend started (pid $FRONTEND_PID, port $FRONTEND_PORT)"
}

# ---------------------------------------------------------------------------
# Wait for backend health endpoint
# ---------------------------------------------------------------------------
wait_for_backend() {
    local max_attempts=20
    local attempt=1
    log_info "Waiting for backend on port $BACKEND_PORT ..."
    while [ $attempt -le $max_attempts ]; do
        if curl -sfS "http://localhost:$BACKEND_PORT/health" >/dev/null 2>&1; then
            log_ok "Backend is ready (localhost:$BACKEND_PORT)"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
    done
    log_error "Backend did not become ready on port $BACKEND_PORT in ${max_attempts}s"
    return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "${1:-}" in
    --stop)
        stop_all
        log_ok "All processes stopped."
        exit 0
        ;;
    --db)
        ensure_pg
        exit 0
        ;;
    "")
        stop_all
        ensure_pg
        start_backend
        wait_for_backend
        start_frontend

        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo -e "  ${GREEN}LiveBoard is running${NC}"
        echo ""
        echo "  Backend:   http://localhost:$BACKEND_PORT"
        echo "  API docs:  http://localhost:$BACKEND_PORT/docs"
        echo "  Frontend:  http://localhost:$FRONTEND_PORT"
        echo "  Postgres:  localhost:$POSTGRES_PORT"
        echo ""
        echo "  Press Ctrl+C to stop all services"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        trap '
            log_info "Shutting down ..."
            kill $BACKEND_PID 2>/dev/null || true
            kill $FRONTEND_PID 2>/dev/null || true
            log_ok "All services stopped."
            exit 0
        ' INT TERM

        wait
        ;;
    *)
        echo "Usage: $0 [--stop | --db]"
        echo ""
        echo "  (no args)   Stop old processes, start Postgres + backend + frontend"
        echo "  --stop      Only stop old backend/frontend processes"
        echo "  --db        Only ensure PostgreSQL is running"
        echo ""
        echo "Ports (override with env vars):"
        echo "  POSTGRES_PORT=${POSTGRES_PORT}"
        echo "  BACKEND_PORT=${BACKEND_PORT}"
        echo "  FRONTEND_PORT=${FRONTEND_PORT}"
        exit 1
        ;;
esac
