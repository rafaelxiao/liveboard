# LiveBoard

> Quantitative trading analytics — ingest fills, pair round-trips, compute risk metrics.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Quick Start

```bash
git clone https://github.com/yourusername/LiveBoard.git
cd LiveBoard
cp .env.example .env
bash scripts/setup.sh
docker compose up -d  # or: bash scripts/start.sh
```

Open http://localhost:5175 — login with credentials from `.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`).

API docs at http://localhost:8002/v1/docs (backend) or http://localhost:5175/api/v1/docs (frontend proxy).

## Architecture

LiveBoard is a two-tier application:

| Tier | Stack |
|------|-------|
| **Backend** | FastAPI + SQLAlchemy + PostgreSQL 16 + Alembic |
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS + Recharts |

Data flow: Trades are ingested via REST API, paired into round-trips (FIFO), converted to base currency, then metrics are computed — Net PnL, TWR, CAGR, Sharpe, Sortino, Calmar, drawdown curves, equity curves, trade concentration.

All financial computation happens in the backend; the frontend renders data and metadata only.

## Features

- **Ingestion pipeline** — REST API for fills, fund movements, instruments, FX rates, benchmarks
- **Round-trip pairing** — FIFO lot matching with fee allocation across legs
- **Multi-currency** — Automatic FX conversion to series base currency
- **Drill-down hierarchy** — Series → Strategy → Symbol breadcrumb navigation
- **Risk metrics** — Sharpe, Sortino, Calmar, CAGR, TWR, Win Rate, Profit Factor
- **Equity & Drawdown** — Absolute and indexed curves with hover period-to-date stats
- **Head-to-head comparison** — Account-level and strategy-level side-by-side with normalized curves
- **Theming** — Dark mode + red-up/green-up PnL color scheme toggle
- **i18n** — English / 简体中文 with persistent language preference (localStorage)
- **API Keys** — Programmatic access for automated ingestion

## Prerequisites

- **uv** (Python package manager) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- **Node.js >= 18**
- **Docker** + Docker Compose (recommended) OR **PostgreSQL 16** installed locally

### PostgreSQL (no Docker)

| OS | Install |
|----|---------|
| macOS | `brew install postgresql@16 && brew services start postgresql@16` |
| Ubuntu/Debian | `sudo apt install postgresql-16 && sudo systemctl start postgresql` |

Then create a database:
```bash
createdb liveboard  # or configure DATABASE_URL in backend/.env
```

## Local Development

### With Docker (recommended)

```bash
cp .env.example .env
docker compose up -d
```

### Without Docker

```bash
# 1. Ensure PostgreSQL 16 is running, then:
bash scripts/setup.sh

# 2. Development (hot reload + HMR)
bash scripts/dev.sh

# 3. Or production (build static files + backend only)
bash scripts/start.sh
```

> **Dev vs Prod**: `dev.sh` starts backend on `:8003` + Vite on `:5175` with HMR.
> `start.sh` starts backend on `:8002` + builds `dist/` for nginx. Both share the same database.

### Nginx configuration

Copy `liveboard.nginx.conf` into your nginx config. It sets up:

| Path | Purpose |
|------|---------|
| `/liveboard/` | Production frontend (static files from `dist/`) |
| `/liveboard/dev/` | Dev frontend (Vite HMR on `:5175`) |
| `/liveboard/api/` | Production API → backend `:8002` |
| `/liveboard/dev/api/` | Dev API → backend `:8003` |

## Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (psycopg 3) |
| `TEST_DATABASE_URL` | Separate database for API tests |
| `JWT_SECRET` | HMAC-SHA256 signing secret |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Initial admin credentials (idempotent seed) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `VITE_API_BASE_URL` | Frontend API base path (prod: `/liveboard/api/v1`, dev: auto-set by `dev.sh`) |
| `BACKEND_PORT` / `FRONTEND_PORT` | Ports for `scripts/start.sh` (8002 / 5175) |
| `RISK_FREE_RATE` | Annual risk-free rate for Sharpe/Sortino |
| `SHARPE_MIN_SAMPLE_TRADES` | Min round-trips before flagging low sample |
| `PER_TRADE_MATCH_TOLERANCE` | Seconds tolerance for per-trade benchmark matching |

## Testing

```bash
# Backend — unit tests (no DB needed)
cd backend && uv run pytest tests/unit/ -v

# Backend — API tests (requires TEST_DATABASE_URL)
cd backend && uv run pytest tests/api/ -v

# Backend — full suite with coverage gate (≥90% on app/services)
cd backend && uv run pytest

# Frontend
cd frontend && npx vitest run

# Integration smoke test (requires running stack)
bash scripts/smoke.sh
```

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/setup.sh` | Install dependencies, copy `.env`, run migrations |
| `scripts/start.sh` | **Production** — start backend + build frontend to `dist/` |
| `scripts/dev.sh` | **Development** — start backend + Vite dev server with hot reload |
| `scripts/smoke.sh` | Integration smoke test |
| `scripts/generate_mock_data.py` | Generate test trade data |
| `scripts/init-test-db.sh` | Initialize the test database |

> All scripts are cross-platform. PostgreSQL is auto-detected via Homebrew (macOS) or systemd (Linux).
>
> `dev.sh` is what you want during development (instant HMR).
> `start.sh` builds static files for nginx — run this on the server, then `npm run build` after code changes.

## Deployment

Docker Compose is production-ready. For cloud deployment:

1. Set a strong `JWT_SECRET` (`openssl rand -hex 32`)
2. Change default admin credentials
3. Set `CORS_ORIGINS` to your domain
4. Use a reverse proxy (nginx / Caddy) with HTTPS — see `liveboard.nginx.conf`

After deploying, update the frontend by rebuilding:
```bash
cd frontend && npm run build   # nginx picks up dist/ automatically
```

## Pushing from mainland China

GitHub is intermittently blocked. Embed your token in the remote URL:
```bash
git remote set-url origin https://TOKEN@github.com/rafaelxiao/liveboard.git
```
Then keep retrying — it connects on some attempts.

## License

MIT — see [LICENSE](LICENSE)
