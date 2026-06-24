#!/usr/bin/env bash
#
# LiveBoard — development server launcher (cross-platform)
#
# Starts PostgreSQL + dev backend (:8003) + Vite dev server with HMR.
# PRODUCTION backend on :8002 is NOT affected.
# For production, use scripts/start.sh instead.
#
# Usage:  bash scripts/dev.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/_common.sh"

DEV_BACKEND_PORT="${DEV_BACKEND_PORT:-8003}"

stop_all

# Kill only the dev backend (not production on :8002)
kill_port "$DEV_BACKEND_PORT"

ensure_pg

# Start dev backend on separate port
BACKEND_PID=$(start_backend "$DEV_BACKEND_PORT" "dev-backend")
wait_for_backend "$DEV_BACKEND_PORT"

# Start Vite dev server with HMR
log_info "Starting Vite dev server on port $FRONTEND_PORT ..."
cd "$PROJECT_ROOT/frontend"
VITE_API_BASE_URL="/liveboard/dev/api/v1" \
  npm run dev -- \
    --port "$FRONTEND_PORT" \
    --host 0.0.0.0 \
    --base /liveboard/dev/ \
    &
FRONTEND_PID=$!
log_ok "Frontend dev server started (pid $FRONTEND_PID, port $FRONTEND_PORT)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}LiveBoard dev is running${NC}"
echo ""
echo "  Dev backend:  http://localhost:$DEV_BACKEND_PORT"
echo "  Prod backend: http://localhost:$BACKEND_PORT  (separate)"
echo "  Frontend:     http://localhost:$FRONTEND_PORT"
echo "  Postgres:     localhost:$POSTGRES_PORT  (shared)"
echo ""
echo "  URLs (via nginx):"
echo "    Production:  /liveboard/"
echo "    Dev:         /liveboard/dev/"
echo ""
echo "  Press Ctrl+C to stop dev services"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

trap '
    log_info "Shutting down dev services ..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    log_ok "Dev services stopped."
    exit 0
' INT TERM

wait
