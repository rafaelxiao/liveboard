#!/usr/bin/env bash
#
# LiveBoard — production launcher (cross-platform)
#
# Starts PostgreSQL + backend on :8002, then builds frontend to dist/ for nginx.
# For development with HMR, use scripts/dev.sh instead.
#
# Usage:  bash scripts/start.sh            start all
#         bash scripts/start.sh --stop     stop old processes
#         bash scripts/start.sh --db       ensure PostgreSQL is running

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/_common.sh"

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
        ;;
    *)
        echo "Usage: $0 [--stop | --db]"
        echo ""
        echo "  (no args)   Stop old processes, start Postgres + backend, build frontend"
        echo "  --stop      Only stop old backend/frontend processes"
        echo "  --db        Only ensure PostgreSQL is running"
        echo ""
        echo "For development with hot reload: bash scripts/dev.sh"
        echo ""
        echo "Ports (override with env vars):"
        echo "  POSTGRES_PORT=${POSTGRES_PORT}"
        echo "  BACKEND_PORT=${BACKEND_PORT}"
        echo "  FRONTEND_PORT=${FRONTEND_PORT}"
        exit 1
        ;;
esac

stop_all
ensure_pg
BACKEND_PID=$(start_backend "$BACKEND_PORT" "backend" "systemd")
wait_for_backend "$BACKEND_PORT"

# Production: build static files for nginx
log_info "Building frontend ..."
cd "$PROJECT_ROOT/frontend"
npm run build
log_ok "Frontend built → dist/ (ready for nginx)"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}LiveBoard is running${NC}"
echo ""
echo "  Backend:   http://localhost:$BACKEND_PORT"
echo "  API docs:  http://localhost:$BACKEND_PORT/docs"
echo "  Frontend:  dist/ (serve with nginx or 'npm run preview')"
echo "  Postgres:  localhost:$POSTGRES_PORT"
echo ""
echo "  Backend PID: $BACKEND_PID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

trap '
    log_info "Shutting down backend ..."
    kill $BACKEND_PID 2>/dev/null || true
    log_ok "Backend stopped."
    exit 0
' INT TERM

wait
