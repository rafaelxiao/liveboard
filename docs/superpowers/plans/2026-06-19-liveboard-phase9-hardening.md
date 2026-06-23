# LiveBoard Phase 9 — Hardening, Docs, Deploy & CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Assume Phases 0–8 are complete** — a full backend (`backend/app/{core,models,schemas,routers,services,alembic}` + `backend/tests/{unit,api}`) and a full frontend (`frontend/src/...`) already exist with their own passing tests. Phase 9 adds **integration hardening + ops + verification**, not new product features. Where a "test" is a verification command rather than a pytest/vitest file, the command is given concretely.

**Goal:** Turn the working-but-uncontainerized monorepo into a production-ready, one-command-bring-up, CI-gated repository that meets the full Definition of Done — multi-stage backend & frontend Dockerfiles, a full `docker-compose.yml` (postgres + backend + frontend with healthchecks and env wiring), a CI pipeline (ruff + pytest unit/api against a service Postgres + frontend eslint/build/vitest), a ≥90% coverage gate on `app/services`, an OpenAPI completeness/units review, an accessibility pass, a responsive pass, a README, and a final acceptance sweep against every 验收标准 group and DoD-1…DoD-9.

**Architecture:** No application logic changes. The backend stays a thin-router / fat-service FastAPI app whose `app/services/*` are the single computation source; the frontend stays a thin React consumer of the OpenAPI contract. Phase 9 wraps both in containers, wires them together via Compose with a healthcheck-ordered startup (db → backend migrate+serve → frontend static serve behind nginx reverse-proxying `/api`), and adds a CI workflow that runs the same checks a developer runs locally. Verification tasks are checklist-driven: each acceptance group and DoD item is mapped to the exact command or test that proves it.

**Tech Stack:** Backend image `python:3.12-slim` + `uv` (multi-stage: deps layer → runtime), running `alembic upgrade head` then `uvicorn app.main:app`. Frontend image `node:20` build stage → `nginx:1.27-alpine` static-serve stage (reverse-proxies `/api` to the backend in prod, mirroring the Vite dev proxy). PostgreSQL 16. CI: GitHub-Actions-style YAML using `astral-sh/setup-uv`, `actions/setup-node`, and a `postgres:16` service container. Coverage via `pytest-cov` with `--cov=app/services --cov-fail-under=90`. Lint: `ruff` (backend), `eslint` (frontend). Tests: `pytest` (unit + api), `vitest` (frontend).

## Global Constraints

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates `NUMERIC(28,12)`; JSON numbers serialized as **strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (reject naive/non-UTC); trade date derived in series `session_tz`.
- **No financial computation in the frontend.** If a number is shown, the backend produced it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest` green before a phase gate.
- Per-user data isolation everywhere; voided rows excluded from all computation.

---

## File Structure

Every file this phase creates or modifies (all paths relative to the repo root `LiveBoard/`):

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `backend/Dockerfile` | Create | Multi-stage `python:3.12-slim` + uv image; deps layer then runtime; entrypoint runs `alembic upgrade head` then `uvicorn` |
| `backend/.dockerignore` | Create | Exclude `.venv`, `__pycache__`, tests artifacts, `.env`, caches from build context |
| `backend/docker-entrypoint.sh` | Create | Wait-for-db (optional) → `alembic upgrade head` → exec `uvicorn app.main:app` |
| `frontend/Dockerfile` | Create | Multi-stage `node:20` build → `nginx:1.27-alpine` static serve with `/api` reverse-proxy |
| `frontend/.dockerignore` | Create | Exclude `node_modules`, `dist`, caches from build context |
| `frontend/nginx.conf` | Create | SPA history-fallback + `proxy_pass` of `/api/` to the backend service |
| `docker-compose.yml` | Modify | Add `backend` + `frontend` services to the existing `db` (+ `adminer`) service, with healthchecks, env wiring, and startup ordering |
| `.env.example` | Modify | Add the compose-only vars (`POSTGRES_*`, `BACKEND_PORT`, `FRONTEND_PORT`) used by the full stack |
| `backend/pyproject.toml` | Modify | Tighten the coverage gate: `--cov=app/services --cov-fail-under=90 --cov-branch` |
| `scripts/smoke.sh` | Create | End-to-end smoke check: compose up → `/health` + `/docs` → register/login round-trip |
| `.github/workflows/ci.yml` | Create | CI pipeline: backend (ruff + pytest unit/api against `postgres:16` service + coverage gate) + frontend (eslint + build + vitest) |
| `docs/openapi-review.md` | Create | OpenAPI completeness/units review checklist + how to regenerate `openapi.json` |
| `docs/accessibility-pass.md` | Create | A11y verification checklist (contrast AA/AAA, keyboard nav, colorblind triple-encoding, reduced motion) mapped to UX §6 |
| `docs/responsive-pass.md` | Create | Responsive verification checklist per UX §7 breakpoints |
| `README.md` | Modify (or Create if absent) | Dev flow (`docker compose up`, `uv sync && uv run uvicorn`, `npm run dev`, migrations, tests), env-var table, architecture overview |
| `docs/acceptance-sweep.md` | Create | Final checklist cross-referencing every 验收标准 group (A–N + M2/CCY/TZ/FEE/ENV/AUD) and DoD-1…DoD-9 to its verifying command/test |

> The existing Phase 0 `docker-compose.yml` already defines a `db` (`postgres:16`, named volume, healthcheck) and optional `adminer` service, plus `scripts/init-test-db.sh`. Phase 9 **extends** that file; it does not rewrite the `db` service.

---

## Tasks

> Work from the repo root `LiveBoard/`. `uv`, `pytest`, `alembic`, and `uvicorn` commands run **from `backend/`**; `npm`/`vitest`/`eslint` commands run **from `frontend/`**; `docker compose` commands run **from the repo root**. Commit after each task.

---

### Task 1: Backend Dockerfile + entrypoint (migrate-then-serve)

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `backend/docker-entrypoint.sh`

**Interfaces:**
- Consumes: the existing `backend/pyproject.toml` + `uv.lock`, `app.main:app`, `app/alembic/` migrations, and `settings.DATABASE_URL` (env-driven from Phase 0).
- Produces: a runnable backend image `liveboard-backend` that, on `docker run`, applies migrations (`alembic upgrade head`) and then serves `uvicorn app.main:app` on `:8000`. Consumed by Task 3 (compose) and the Task 10 smoke check.

- [ ] **Step 1: Write the check** — the deliverable is "the backend image builds and a container serves `/health` after auto-migrating." No image/Dockerfile exists yet, so the build command below fails. Capture that as the initial (failing) state.

- [ ] **Step 2: Run to see current state**
Run: `docker build -t liveboard-backend ./backend`
Expected (before the Dockerfile exists): FAIL — `failed to read dockerfile: open /…/backend/Dockerfile: no such file or directory`.

- [ ] **Step 3: Implement**

Create `backend/.dockerignore`:
```dockerignore
.venv/
__pycache__/
*.py[cod]
.pytest_cache/
.ruff_cache/
.coverage
htmlcov/
coverage.xml
.env
tests/
*.md
```

Create `backend/Dockerfile` (multi-stage: uv resolves deps into a venv, runtime is a slim layer that copies it):
```dockerfile
# syntax=docker/dockerfile:1

###############################################################################
# Stage 1 — builder: install dependencies into a self-contained venv with uv
###############################################################################
FROM python:3.12-slim AS builder

# uv: fast, lockfile-based installs. Pinned copy from the official image.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Install deps first (cached layer) using only the lock + manifest.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

# Now copy the application source and install the project itself.
COPY app ./app
COPY alembic.ini ./alembic.ini
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

###############################################################################
# Stage 2 — runtime: slim image with just the venv + app
###############################################################################
FROM python:3.12-slim AS runtime

# psycopg[binary] bundles libpq, so no system libpq needed; add curl for healthcheck.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 appuser

WORKDIR /app

# Bring over the resolved venv and the application code.
COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/app /app/app
COPY --from=builder /app/alembic.ini /app/alembic.ini
COPY docker-entrypoint.sh /app/docker-entrypoint.sh

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN chmod +x /app/docker-entrypoint.sh && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Container-level liveness probe (compose also defines one).
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD curl -fsS http://localhost:8000/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Create `backend/docker-entrypoint.sh` (apply migrations, then exec the passed command so signals reach uvicorn):
```bash
#!/usr/bin/env bash
set -euo pipefail

# Apply database schema migrations before serving. Idempotent: a no-op when
# the DB is already at head. Fails fast (set -e) if migrations error.
echo "[entrypoint] running alembic upgrade head ..."
alembic upgrade head

# Hand off to the container CMD (uvicorn). exec replaces PID 1 so SIGTERM from
# `docker stop` / compose reaches uvicorn for a graceful shutdown.
echo "[entrypoint] starting application: $*"
exec "$@"
```

> Note: `alembic.ini` has `script_location = app/alembic` and `env.py` reads the URL from `Settings` (Phase 0), so `alembic upgrade head` inside the container uses `DATABASE_URL` from the environment — no hardcoded URL.

- [ ] **Step 4: Verify**
Run: `docker build -t liveboard-backend ./backend`
Expected: PASS — image builds; final `=> naming to docker.io/library/liveboard-backend` line. Then sanity-check the image entrypoint without a DB:
Run: `docker run --rm --entrypoint sh liveboard-backend -c "uvicorn --version && alembic --version && python -c 'import app.main'"`
Expected: PASS — prints uvicorn + alembic versions and imports `app.main` with no traceback (proves the venv + source are wired and the app module imports cleanly).

- [ ] **Step 5: Commit**
```bash
git add backend/Dockerfile backend/.dockerignore backend/docker-entrypoint.sh
git commit -m "P9: backend multi-stage Dockerfile (uv) + migrate-then-serve entrypoint"
```

---

### Task 2: Frontend Dockerfile + nginx static serve (with `/api` proxy)

**Files:**
- Create: `frontend/Dockerfile`, `frontend/.dockerignore`, `frontend/nginx.conf`

**Interfaces:**
- Consumes: the existing `frontend/package.json` (`build` script → `dist/`), `package-lock.json`, and the SPA source. Honors `VITE_API_BASE_URL` (defaults to `/api`).
- Produces: a static-serving image `liveboard-frontend` (nginx) that serves the built SPA on `:80`, does SPA history-fallback, and reverse-proxies `/api/` to the backend service — mirroring the Vite dev proxy so the same relative `/api` base works in dev and prod. Consumed by Task 3 (compose).

- [ ] **Step 1: Write the check** — deliverable: "the frontend image builds and nginx serves `index.html` with SPA fallback + proxies `/api`." No Dockerfile yet → build fails. Capture as initial state.

- [ ] **Step 2: Run to see current state**
Run: `docker build -t liveboard-frontend ./frontend`
Expected (before the Dockerfile exists): FAIL — `failed to read dockerfile`.

- [ ] **Step 3: Implement**

Create `frontend/.dockerignore`:
```dockerignore
node_modules/
dist/
.vite/
.eslintcache
.env
*.md
coverage/
```

Create `frontend/nginx.conf` (SPA fallback + API reverse-proxy; `backend` is the compose service name resolved via Docker DNS):
```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Long-cache hashed static assets emitted by Vite.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Reverse-proxy API calls to the backend service (mirrors the Vite dev proxy).
    location /api/ {
        proxy_pass         http://backend:8000/;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # SPA history fallback: unknown routes serve index.html (client-side router).
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

> The `location /api/` block strips the `/api` prefix via the trailing slash on `proxy_pass http://backend:8000/;` so `/api/auth/login` → `backend:8000/auth/login`, matching the router paths (`/auth/...`). Keep this consistent with `VITE_API_BASE_URL=/api`.

Create `frontend/Dockerfile` (node build stage → nginx serve stage):
```dockerfile
# syntax=docker/dockerfile:1

###############################################################################
# Stage 1 — build the SPA with Vite
###############################################################################
FROM node:20-slim AS build

WORKDIR /app

# Install deps from the lockfile first (cached layer).
COPY package.json package-lock.json ./
RUN npm ci

# Build. VITE_API_BASE_URL defaults to /api (served by the nginx proxy below).
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY . .
RUN npm run build

###############################################################################
# Stage 2 — serve the static build with nginx
###############################################################################
FROM nginx:1.27-alpine AS runtime

# Replace the default site with our SPA-fallback + API-proxy config.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO- http://localhost:80/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 4: Verify**
Run: `docker build -t liveboard-frontend ./frontend`
Expected: PASS — image builds; `npm run build` emits `dist/` and the final nginx image is tagged. Then confirm static serving in isolation (no backend needed; `/api` will 502 until backend is up, which is expected):
Run: `docker run --rm -d -p 8081:80 --name lb-fe-test liveboard-frontend && sleep 2 && curl -fsS http://localhost:8081/ | grep -qi "<div id=\"root\"" && echo SPA_OK; docker rm -f lb-fe-test`
Expected: PASS — prints `SPA_OK` (nginx returns the SPA `index.html`).

- [ ] **Step 5: Commit**
```bash
git add frontend/Dockerfile frontend/.dockerignore frontend/nginx.conf
git commit -m "P9: frontend Dockerfile (node build -> nginx static serve + /api proxy)"
```

---

### Task 3: Full Docker Compose (db + backend + frontend) with healthchecks & env wiring

**Files:**
- Modify: `docker-compose.yml` (repo root) — add `backend` + `frontend` to the existing `db` (+ `adminer`) services
- Modify: `.env.example` — add compose-only vars

**Interfaces:**
- Consumes: the `liveboard-backend` (Task 1) and `liveboard-frontend` (Task 2) build contexts; the existing `db` service + `scripts/init-test-db.sh`; env from `.env`.
- Produces: a one-command full stack — `db` (healthy) → `backend` (waits for db-healthy, migrates, serves, healthy) → `frontend` (waits for backend-healthy, serves on the host port). Satisfies DoD-6 and the Phase 9 gate's "clean `docker compose up` brings up a working app with seeded admin."

- [ ] **Step 1: Write the check** — deliverable: `docker compose config` validates a 3-service stack with correct `depends_on … condition: service_healthy` ordering and env wiring. Today the file only has `db` (+ `adminer`), so the assertions below (presence of `backend`/`frontend`) fail.

- [ ] **Step 2: Run to see current state**
Run: `docker compose config --services`
Expected (before edit): prints only `db` (and `adminer`) — no `backend`, no `frontend`.

- [ ] **Step 3: Implement**

Edit `docker-compose.yml` to the full stack (keep the existing `db` + `adminer` definitions; add `backend` + `frontend`; keep the `liveboard_pgdata` volume):
```yaml
services:
  db:
    image: postgres:16
    container_name: liveboard-db
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-liveboard}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-liveboard}
      POSTGRES_DB: ${POSTGRES_DB:-liveboard}
    ports:
      - "5432:5432"
    volumes:
      - liveboard_pgdata:/var/lib/postgresql/data
      - ./scripts/init-test-db.sh:/docker-entrypoint-initdb.d/init-test-db.sh:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-liveboard} -d ${POSTGRES_DB:-liveboard}"]
      interval: 5s
      timeout: 5s
      retries: 10

  backend:
    build:
      context: ./backend
    image: liveboard-backend
    container_name: liveboard-backend
    depends_on:
      db:
        condition: service_healthy
    environment:
      # Inside the compose network the DB host is the service name `db`.
      DATABASE_URL: postgresql+psycopg://${POSTGRES_USER:-liveboard}:${POSTGRES_PASSWORD:-liveboard}@db:5432/${POSTGRES_DB:-liveboard}
      JWT_SECRET: ${JWT_SECRET:-change-me-in-production}
      JWT_ALGORITHM: ${JWT_ALGORITHM:-HS256}
      ACCESS_TOKEN_TTL_MIN: ${ACCESS_TOKEN_TTL_MIN:-15}
      REFRESH_TOKEN_TTL_DAYS: ${REFRESH_TOKEN_TTL_DAYS:-14}
      ADMIN_EMAIL: ${ADMIN_EMAIL:-admin@example.com}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-change-me}
      CORS_ORIGINS: ${CORS_ORIGINS:-http://localhost:${FRONTEND_PORT:-5173}}
      RISK_FREE_RATE: ${RISK_FREE_RATE:-0}
      ANNUALIZATION_DAYS: ${ANNUALIZATION_DAYS:-365}
      SHARPE_MIN_SAMPLE_TRADES: ${SHARPE_MIN_SAMPLE_TRADES:-20}
      SHARPE_MIN_ACTIVE_DAYS: ${SHARPE_MIN_ACTIVE_DAYS:-30}
      SHARPE_SUPPRESS_BELOW: ${SHARPE_SUPPRESS_BELOW:-5}
      PER_TRADE_MATCH_TOLERANCE: ${PER_TRADE_MATCH_TOLERANCE:-300}
    ports:
      - "${BACKEND_PORT:-8000}:8000"
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8000/health || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 20s

  frontend:
    build:
      context: ./frontend
      args:
        VITE_API_BASE_URL: /api
    image: liveboard-frontend
    container_name: liveboard-frontend
    depends_on:
      backend:
        condition: service_healthy
    ports:
      - "${FRONTEND_PORT:-5173}:80"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:80/ >/dev/null 2>&1 || exit 1"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s

  adminer:
    image: adminer:4
    container_name: liveboard-adminer
    profiles: ["tools"]
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "8080:8080"

volumes:
  liveboard_pgdata:
```

Append the compose-only vars to `.env.example` (the backend app vars already exist from Phase 0):
```bash
# --- Docker Compose full-stack (Phase 9) ---
# Postgres container credentials (must match the user/pass/db in DATABASE_URL).
POSTGRES_USER=liveboard
POSTGRES_PASSWORD=liveboard
POSTGRES_DB=liveboard
# Host port mappings for the full stack.
BACKEND_PORT=8000
FRONTEND_PORT=5173
# Admin seed password (the email already exists above as ADMIN_EMAIL).
ADMIN_PASSWORD=change-me
```

> CORS: in the full stack the browser hits the frontend origin (`http://localhost:5173`) and nginx proxies `/api` server-side, so cross-origin is avoided. `CORS_ORIGINS` is still set so a directly-exposed backend (`localhost:8000`) accepts the SPA origin during development.

- [ ] **Step 4: Verify**
Run: `docker compose config --services`
Expected: PASS — prints `db`, `backend`, `frontend`, `adminer`. Then validate the merged config + dependency conditions:
Run: `docker compose config | grep -A3 "depends_on"`
Expected: PASS — `backend` depends on `db` with `condition: service_healthy`; `frontend` depends on `backend` with `condition: service_healthy`. (Full bring-up is exercised in Task 10's smoke check.)

- [ ] **Step 5: Commit**
```bash
git add docker-compose.yml .env.example
git commit -m "P9: full docker-compose (db+backend+frontend) with healthchecks + env wiring"
```

---

### Task 4: Coverage gate — ≥90% on `app/services`

**Files:**
- Modify: `backend/pyproject.toml` (`[tool.pytest.ini_options]` addopts + `[tool.coverage.*]`)

**Interfaces:**
- Consumes: the existing unit + api test suites (Phases 1–5) that exercise `app/services/*`.
- Produces: a hard CI/local gate — `pytest` fails when `app/services` line coverage drops below 90%. Satisfies DoD-1's "建议 services 行覆盖率门槛 ≥ 90%".

- [ ] **Step 1: Write the check** — the gate is the test. Set `--cov-fail-under=90` on `--cov=app/services`. The "failing state" is measuring current coverage; if any service module is under-tested, the gate fails and the gap must be closed (add unit fixtures) before proceeding.

- [ ] **Step 2: Run to see current state**
Run: `cd backend && uv run pytest --cov=app/services --cov-report=term-missing`
Expected: a coverage table per `app/services/*.py` with a TOTAL line. Record the TOTAL %. If it is already ≥90%, the gate will pass once enabled; if `< 90%`, the `Missing` columns name the exact lines/branches needing tests.

- [ ] **Step 3: Implement**

Edit `backend/pyproject.toml` to make the gate enforced and branch-aware:
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-q --cov=app/services --cov-branch --cov-report=term-missing --cov-fail-under=90"
filterwarnings = ["error::DeprecationWarning"]

[tool.coverage.run]
source = ["app/services"]
branch = true

[tool.coverage.report]
show_missing = true
skip_covered = false
# Exclude lines that are not meaningful to cover.
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "raise NotImplementedError",
    "\\.\\.\\.",
]
```

> If Step 2 showed `< 90%`, **before** committing: add targeted unit tests under `backend/tests/unit/` for the uncovered branches in `capital.py`, `fx.py`, `pairing.py`, `metrics.py`, `benchmark.py`, `ingestion.py`, `comparison.py` (these are the DoD-1 financial-correctness modules and should already be near-complete from Phases 3–5). Re-run Step 2 until TOTAL ≥ 90%.

- [ ] **Step 4: Verify**
Run: `cd backend && uv run pytest`
Expected: PASS — the suite runs and the footer shows `Required test coverage of 90% reached. Total coverage: <NN.NN>%` (≥90). A deliberate downward check (optional): temporarily set `--cov-fail-under=100` and confirm pytest exits non-zero with `Coverage failure: total of NN is less than fail-under=100`, proving the gate is wired; then revert to 90.

- [ ] **Step 5: Commit**
```bash
git add backend/pyproject.toml
git commit -m "P9: enforce >=90% branch coverage gate on app/services"
```

---

### Task 5: CI pipeline (ruff + pytest unit/api + frontend eslint/build/vitest)

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `backend/pyproject.toml` (deps + ruff + pytest/coverage config), `frontend/package.json` (`lint`, `build`, `test` scripts), and `scripts/init-test-db.sh` semantics (a `liveboard_test` DB).
- Produces: a push/PR quality gate that runs the same checks a developer runs locally, against a `postgres:16` service container. Satisfies DoD-7 (`ruff` green, `pytest` unit+api green, frontend `lint` + `build` + `vitest` green).

- [ ] **Step 1: Write the check** — deliverable: a CI workflow that lints + tests both packages and enforces the coverage gate. No workflow exists yet, so the validation in Step 2 reports "no workflows."

- [ ] **Step 2: Run to see current state**
Run: `ls .github/workflows/ 2>/dev/null || echo "no workflows dir"`
Expected (before): prints `no workflows dir`. (If `act` or `actionlint` is available, `actionlint .github/workflows/ci.yml` will also fail with "file not found.")

- [ ] **Step 3: Implement**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

# Cancel superseded runs on the same ref to save minutes.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  backend:
    name: Backend (ruff + pytest unit/api + coverage)
    runs-on: ubuntu-latest

    # A real Postgres for the API tests (TestClient against test Postgres, DoD-2).
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: liveboard
          POSTGRES_PASSWORD: liveboard
          POSTGRES_DB: liveboard
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U liveboard -d liveboard"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      DATABASE_URL: postgresql+psycopg://liveboard:liveboard@localhost:5432/liveboard
      TEST_DATABASE_URL: postgresql+psycopg://liveboard:liveboard@localhost:5432/liveboard_test
      JWT_SECRET: ci-secret
      JWT_ALGORITHM: HS256
      ACCESS_TOKEN_TTL_MIN: "15"
      REFRESH_TOKEN_TTL_DAYS: "14"
      ADMIN_EMAIL: admin@example.com
      ADMIN_PASSWORD: ci-admin-pw
      CORS_ORIGINS: http://localhost:5173
      RISK_FREE_RATE: "0"
      ANNUALIZATION_DAYS: "365"
      SHARPE_MIN_SAMPLE_TRADES: "20"
      SHARPE_MIN_ACTIVE_DAYS: "30"
      SHARPE_SUPPRESS_BELOW: "5"
      PER_TRADE_MATCH_TOLERANCE: "300"

    defaults:
      run:
        working-directory: backend

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true

      - name: Set up Python
        run: uv python install 3.12

      - name: Sync dependencies (incl. dev)
        run: uv sync --frozen --dev

      - name: Create the test database
        run: |
          PGPASSWORD=liveboard psql -h localhost -U liveboard -d liveboard \
            -tc "SELECT 1 FROM pg_database WHERE datname='liveboard_test'" \
            | grep -q 1 || \
          PGPASSWORD=liveboard psql -h localhost -U liveboard -d liveboard \
            -c "CREATE DATABASE liveboard_test"

      - name: Ruff lint
        run: uv run ruff check .

      - name: Ruff format check
        run: uv run ruff format --check .

      - name: Apply migrations to the main DB
        run: uv run alembic upgrade head

      - name: Pytest (unit + api) with coverage gate
        run: uv run pytest

  frontend:
    name: Frontend (eslint + build + vitest)
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: ESLint
        run: npm run lint

      - name: Type-check + build
        run: npm run build

      - name: Vitest
        run: npm run test -- --run
```

> Notes: `setup-uv` provides `uv`; `apt`'s `psql` client ships on `ubuntu-latest` so the test-DB create step works without extra installs. The backend job's `pytest` step inherits the ≥90% gate from `pyproject.toml` (Task 4). `npm run test -- --run` forces vitest's non-watch mode in CI.

- [ ] **Step 4: Verify**
Run: `actionlint .github/workflows/ci.yml` (if `actionlint` is installed) — Expected: no findings. If `actionlint` is unavailable, validate YAML syntax: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"` → Expected: `yaml ok`. Then confirm the scripts the workflow calls exist locally:
Run: `cd backend && uv run ruff check . && cd ../frontend && npm run lint && npm run build && npm run test -- --run`
Expected: PASS — the exact commands CI runs all succeed locally (this is the most reliable proxy for a green pipeline). On the first push, confirm the GitHub Actions run is green.

- [ ] **Step 5: Commit**
```bash
git add .github/workflows/ci.yml
git commit -m "P9: CI pipeline (backend ruff+pytest+coverage on service postgres; frontend lint+build+vitest)"
```

---

### Task 6: OpenAPI completeness & units review

**Files:**
- Create: `docs/openapi-review.md`

**Interfaces:**
- Consumes: the running backend's `/openapi.json` (auto-generated from the Pydantic schemas).
- Produces: a documented review checklist verifying the contract is complete, every numeric field is a **string-serialized Decimal**, every metric field has a `units` entry, and the envelope shape matches design §8. Satisfies the roadmap's "OpenAPI reviewed for completeness/units" and DoD-8/DoD-9.

- [ ] **Step 1: Write the check** — deliverable: a dump of `/openapi.json` plus a checklist that each acceptance-relevant endpoint and the metrics/comparison `units` map are present and correct. No review doc exists yet.

- [ ] **Step 2: Run to see current state**
Run: `cd backend && uv run python -c "import json,app.main; print(json.dumps(app.main.app.openapi()))" > /tmp/openapi.json && python -c "import json;d=json.load(open('/tmp/openapi.json'));print(len(d['paths']),'paths');[print(p) for p in sorted(d['paths'])]"`
Expected: prints the path count and every route. Confirm the full surface is present: `/auth/register|login|refresh|me`, `/api-keys` (+`/{id}`), `/admin/users` (+`/{id}/approve|reject`), `/series` (+`/{id}`), `/series/{id}/instruments|fx-rates|benchmark|fills:batch|fund-movements|fills:void|metrics`, `/comparisons`, `/health`.

- [ ] **Step 3: Implement**

Create `docs/openapi-review.md`:
```markdown
# OpenAPI Completeness & Units Review (Phase 9)

Regenerate the spec:

```bash
cd backend
uv run python -c "import json,app.main; print(json.dumps(app.main.app.openapi(), indent=2))" > ../docs/openapi.json
```

Or browse interactively at `http://localhost:8000/docs` (Swagger UI) and
`http://localhost:8000/openapi.json` (raw) while the backend runs.

## Endpoint completeness checklist (design §8)

- [ ] Auth: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`
- [ ] API keys: `POST /api-keys`, `GET /api-keys`, `DELETE /api-keys/{id}`
- [ ] Admin: `GET /admin/users`, `POST /admin/users/{id}/approve`, `POST /admin/users/{id}/reject`
- [ ] Series: `POST /series`, `GET /series`, `GET /series/{id}`
- [ ] Ingestion: `POST /series/{id}/fills:batch`, `POST /series/{id}/fund-movements`,
      `POST /series/{id}/fills:void`
- [ ] Instruments / FX / Benchmark: `POST /series/{id}/instruments`,
      `POST /series/{id}/fx-rates`, `POST /series/{id}/benchmark`
- [ ] Metrics: `GET /series/{id}/metrics` with query params
      `level, strategy, symbol, date_from, date_to, trade_view, active_days_only`
- [ ] Comparison: `POST /comparisons` with body
      `series_ids, baseline_series_id, date_from, date_to, trade_view, per_trade_page, per_trade_page_size`

## Status-code coverage (DoD-3)

- [ ] `401` (no/invalid token or revoked key), `403` (pending/rejected/non-admin),
      `404` (cross-user series), `409` (duplicate email), `413` (batch > 10k),
      `422` (validation) all appear in the relevant operations' `responses`.

## Self-describing envelope (design §8, ENV-1…ENV-6)

- [ ] `MetricsEnvelope` schema has `meta`, `metrics`, `equity_curve`, `drawdown_series`.
- [ ] `meta` includes `level`, `base_currency`, `session_tz`, `date_range`,
      `trade_view`, `capital_base`, `sample{round_trips,active_days}`, and
      `flags{realized_only,low_sample,sharpe_suppressed,fx_missing,open_positions_exist}`.
- [ ] `metrics.units` maps EVERY numeric metric field to a unit
      (currency code / `percent` / `ratio` / `annualized_ratio` / `seconds` / `count`).
- [ ] Decimal money/qty/rate fields are typed as **string** in the schema
      (serialized as strings, ENV-5) — not `number`.
- [ ] `equity_curve` points = `{ts, realized_pnl, indexed_return}`;
      `drawdown_series` points = `{ts, drawdown, drawdown_pct}` (ENV-4).
- [ ] Symbol-level response nulls return-based fields (return%/Sharpe/Sortino/TWR/CAGR) (ENV-6).
- [ ] Comparison response: `meta` (incl. `baseline_series_id`, `currency_mismatch_series`),
      `account`, `strategy`, `symbol`, `per_trade{page,page_size,total,rows,unmatched}`.

## Automated assertions (run alongside the manual review)

```bash
cd backend
uv run python - <<'PY'
import json, app.main
spec = app.main.app.openapi()
paths = spec["paths"]
required = [
    "/auth/register", "/auth/login", "/auth/refresh", "/auth/me",
    "/api-keys", "/admin/users",
    "/series", "/series/{id}", "/series/{id}/metrics",
    "/series/{id}/fills:batch", "/series/{id}/fund-movements", "/series/{id}/fills:void",
    "/series/{id}/instruments", "/series/{id}/fx-rates", "/series/{id}/benchmark",
    "/comparisons",
]
missing = [p for p in required if p not in paths]
assert not missing, f"missing paths: {missing}"
# Numeric metric fields must be strings, and a units map must exist.
schemas = spec["components"]["schemas"]
assert any("units" in (s.get("properties") or {}) for s in schemas.values()), \
    "no schema exposes a units map"
print("OpenAPI completeness assertions passed:", len(paths), "paths")
PY
```
```

> Tick each box after inspecting `/openapi.json`. The automated snippet is the fast first pass; the manual boxes catch semantics (e.g. a field typed `string` but missing from `units`).

- [ ] **Step 4: Verify**
Run: `cd backend && uv run python - <<'PY'` … (the assertion block above) — Expected: PASS — prints `OpenAPI completeness assertions passed: <N> paths` with no `AssertionError`. Then manually tick every checklist box in `docs/openapi-review.md` against `/openapi.json`.
Expected: every box checked; any gap (missing units entry, a Decimal field typed as `number`) is filed as a fix in the relevant schema before the box is ticked.

- [ ] **Step 5: Commit**
```bash
git add docs/openapi-review.md docs/openapi.json
git commit -m "P9: OpenAPI completeness/units review checklist + regenerated spec"
```

---

### Task 7: Accessibility pass (contrast, keyboard, colorblind triple-encoding, reduced motion)

**Files:**
- Create: `docs/accessibility-pass.md`

**Interfaces:**
- Consumes: the running frontend (Tasks 2/3 or `npm run dev`) and UX §6 (accessibility) + §1.2 (P/L triple-encoding) + §4 (chart rules).
- Produces: a verifiable a11y checklist with concrete checks (contrast ratios on the §1.2 palette, keyboard nav of selectors/modals/charts, P/L color+sign+glyph triple-encoding, `prefers-reduced-motion`). Satisfies the roadmap's accessibility-pass scope and the frontend's I–N a11y obligations.

- [ ] **Step 1: Write the check** — deliverable: a checklist mapped to UX §6 with the exact tool/command/manual step for each item. None exists yet.

- [ ] **Step 2: Run to see current state**
Run: `cd frontend && npx --yes @axe-core/cli@latest http://localhost:5173/login || echo "axe baseline captured (note violations)"`
Expected: prints any current axe violations on the login route (run the dev server or compose first). Record the baseline so the pass closes each finding. (If the app requires auth, also run axe against `/series` after logging in with the seeded admin.)

- [ ] **Step 3: Implement**

Create `docs/accessibility-pass.md`:
```markdown
# Accessibility Pass (Phase 9) — verifies UX §6 + §1.2 + §4

Run against the running SPA (`docker compose up` or `npm run dev`).
Automated sweep per route: `npx @axe-core/cli http://localhost:5173/<route>`.

## 1. Contrast — WCAG AA (≥4.5:1), AAA where feasible (UX §6.1)

- [ ] `text/primary` on `bg/surface` (dark `#F8FAFC` on `#0F172A`) ≥ 7:1 (AAA).
- [ ] `text/muted` floors at slate-400 dark (`#94A3B8`) / slate-600 light (`#475569`) — never lighter.
- [ ] `accent/primary` (`#3B82F6` dark / `#2563EB` light) on surface ≥ 4.5:1 for button text.
- [ ] `pnl/gain` rose `#F43F5E` and `pnl/loss` emerald `#10B981` on dark surface ≥ 4.5:1
      for the numeric value text size used.
- [ ] `warning` amber and `info` sky badges ≥ 4.5:1 against their backgrounds.
- [ ] Focus ring `#93C5FD`, 2px + 2px offset, visible on every interactive element in BOTH themes.
- [ ] Verify ratios with a contrast tool (axe reports violations automatically; spot-check
      borderline pairs in a contrast checker).

## 2. Colorblind-safe P/L triple-encoding (UX §6.2, §1.2)

- [ ] Every P/L value is encoded by **(1) color + (2) sign (+/−) + (3) glyph (▲/▼)** —
      never color alone. Check MetricCard, TradeStatsTable, PerTradeDiffTable, chart tooltips.
- [ ] Flipping `pnl_color_scheme` (`red-up` ⇄ `green-up`) via `PnlColorToggle` recolors all
      `pnl/gain`·`pnl/loss` values consistently and leaves sign/glyph intact.
- [ ] UI status colors (`success/ui` emerald, `danger/ui` rose) do NOT flip with the P/L scheme.
- [ ] Comparison overlay series use color **and** dash pattern (solid/dashed/dotted/…), and
      avoid green/red (reserved for P/L). Legend shows swatch + dash sample.
- [ ] Drawdown conveys meaning by geometry (below-zero area) + ▼ on the max-DD label, not hue alone.
- [ ] `PerTradeDiffTable` provides exact numbers (non-color channel) + CSV export.

## 3. Keyboard navigation (UX §6.3)

- [ ] Tab order matches visual order on every page.
- [ ] Sidebar nav is a list of links (arrow-navigable); `LevelSelector`/`TradeViewSelector`
      are radio groups (arrow keys move selection).
- [ ] `ApiKeyCreatedModal` and `ConfirmPopover` trap focus, focus lands sensibly (key field
      pre-selected), `Esc` triggers the dismissal guard, and focus is restored on close.
- [ ] Charts expose keyboard scrubbing (← →) on the active series and a focusable legend.
- [ ] Table header sort buttons are focusable and operable by Enter/Space.
- [ ] All icon-only buttons have `aria-label`; all form inputs use `<label for>`.

## 4. Loading / empty / error + reduced motion (UX §6.4)

- [ ] Errors use `AlertBanner` with `role="alert"`/`aria-live="assertive"` near the problem —
      never red-border-only. Field errors have text + icon beneath the field.
- [ ] Empty states use `EmptyState` (message + CTA) — never a blank pane.
- [ ] Loading uses skeletons with reserved dimensions; async buttons disable + spin.
- [ ] With OS `prefers-reduced-motion: reduce`: chart draw-in animation disabled, skeleton
      shimmer becomes a static tint, transitions drop to opacity-only. Verify by toggling the
      OS setting (or DevTools "Emulate CSS prefers-reduced-motion").

## 5. Other (UX §6.5)

- [ ] No emojis as UI icons (Lucide SVGs at 24×24). `cursor-pointer` on clickable rows/cards.
- [ ] Hover feedback via color/opacity (no layout-shifting scale). Transitions 150–300ms.

## Result

- [ ] axe-core CLI reports **0 serious/critical violations** on `/login`, `/register`,
      `/series`, `/dashboard`, `/compare`, `/api-keys`, `/admin/users`.
- [ ] All manual boxes above checked; any fix committed to `frontend/`.
```

- [ ] **Step 4: Verify**
Run: `cd frontend && for r in login register series dashboard compare api-keys admin/users; do npx --yes @axe-core/cli@latest "http://localhost:5173/$r"; done`
Expected: PASS — 0 serious/critical violations per route (auth-gated routes checked after login as the seeded admin). Then complete every manual box in `docs/accessibility-pass.md`; fix any failures in the frontend and re-run.
Expected: all boxes ticked; axe clean.

- [ ] **Step 5: Commit**
```bash
git add docs/accessibility-pass.md frontend/
git commit -m "P9: accessibility pass (contrast/keyboard/colorblind triple-encoding/reduced-motion) + fixes"
```

---

### Task 8: Responsive degradation pass (per UX §7 breakpoints)

**Files:**
- Create: `docs/responsive-pass.md`

**Interfaces:**
- Consumes: the running frontend and UX §7 breakpoint table.
- Produces: a checklist verifying graceful degradation at ≥1440 / 1024–1439 / 768–1023 / <768 px, including the heavy-table mobile treatment and the "supported, not optimized" guarantees. Satisfies the roadmap's "Responsive degradation per UX §7."

- [ ] **Step 1: Write the check** — deliverable: a per-breakpoint checklist with the exact viewport widths to emulate. None exists yet.

- [ ] **Step 2: Run to see current state**
Run: open the SPA in a browser and use DevTools device toolbar to set widths `1440`, `1280`, `1024`, `820`, `390`. Record where layout breaks today (overflow, clipped controls, horizontal page scroll).
Expected: a noted baseline of any current breakage at each width.

- [ ] **Step 3: Implement**

Create `docs/responsive-pass.md`:
```markdown
# Responsive Pass (Phase 9) — verifies UX §7

Emulate each width in DevTools (or resize). Check Dashboard + Comparison
(the data-dense screens) and the auth/admin/series screens.

## ≥1440px (default)
- [ ] 240px sidebar; MetricCardGrid 4–6 cols; equity + drawdown side-by-side; wide diff table.

## 1024–1439px
- [ ] MetricCardGrid 3–4 cols; equity & drawdown **stack vertically** (full-width each);
      sidebar may auto-collapse to 64px icon rail.

## 768–1023px (tablet)
- [ ] Sidebar becomes a collapsible drawer (hamburger); cards 2 cols; controls bar wraps to
      two rows; charts full-width stacked; tables get `overflow-x-auto`.

## <768px (mobile)
- [ ] Single column; cards 1–2 cols; sidebar = off-canvas drawer; Dashboard controls collapse
      into a "Filters" sheet.
- [ ] `PerTradeDiffTable` → stacked card-per-row OR summary list + "open full table" view
      (NOT a clipped wide table). Charts remain; legend moves below.
- [ ] Multi-series overlay + per-trade diff show a non-blocking "best on a larger screen" hint.

## Cross-cutting guarantees (UX §7)
- [ ] No horizontal **page** scroll at any width (table-local scroll is allowed).
- [ ] Body text ≥16px on mobile; touch targets ≥44×44px.
- [ ] Every screen remains usable on a phone (read metrics, read a single equity curve).

## Result
- [ ] All four breakpoints verified on Dashboard + Comparison; auth/series/admin screens
      verified at <768px. Fixes committed to `frontend/`.
```

- [ ] **Step 4: Verify**
Run: emulate `1440 / 1280 / 1024 / 820 / 390` px and walk each checklist item on Dashboard, Comparison, SeriesList, Login, AdminUsers.
Expected: PASS — every box checked; no horizontal page scroll at any width; the diff table degrades to cards/summary on mobile; touch targets ≥44px. Fix any breakage in `frontend/` (Tailwind responsive classes) and re-verify.

- [ ] **Step 5: Commit**
```bash
git add docs/responsive-pass.md frontend/
git commit -m "P9: responsive degradation pass per UX §7 + fixes"
```

---

### Task 9: README (dev flow, env vars, architecture overview)

**Files:**
- Modify (or Create if absent): `README.md` (repo root)

**Interfaces:**
- Consumes: every prior task's commands (compose, uv/uvicorn, npm, alembic, pytest, vitest) + the env-var tables from tech-stack §4 / structure §1.4.
- Produces: the canonical run document. Satisfies DoD-6's "README 记录全部步骤" and the roadmap's README scope.

- [ ] **Step 1: Write the check** — deliverable: a README documenting the exact, copy-pasteable commands for the three run modes (full compose, host backend, host frontend), migrations, tests, the env-var table, and an architecture overview. Today there is no functional README.

- [ ] **Step 2: Run to see current state**
Run: `test -f README.md && wc -l README.md || echo "no README.md"`
Expected: `no README.md` (or a stub). The commands it should document are validated to work by Tasks 1–5 and the Task 10 smoke check.

- [ ] **Step 3: Implement**

Create `README.md`:
```markdown
# LiveBoard

A FastAPI + React + PostgreSQL app that ingests trading fills via API, computes
multi-level quant metrics on the backend, and compares 2+ datasets. **All financial
computation lives in the backend** (`backend/app/services/`); the React app only
fetches, lays out, charts, and formats. The HTTP/OpenAPI API is the one public contract.

## Architecture

```
┌────────────┐   /api (HTTP/OpenAPI)   ┌─────────────────────────┐      ┌────────────┐
│  Frontend  │ ──────────────────────► │  Backend (FastAPI)      │ ───► │ PostgreSQL │
│ React/Vite │   JWT + X-API-Key       │  thin routers           │      │     16     │
│ (nginx in  │ ◄────────────────────── │  fat services (compute) │ ◄─── │            │
│  prod)     │   self-describing JSON  │  app/services/*         │      │            │
└────────────┘                         └─────────────────────────┘      └────────────┘
```

- **Backend:** Python 3.12 / FastAPI / SQLAlchemy 2 / Alembic / PyJWT, managed by `uv`.
  Business logic is in `app/services/*` (framework-free, callable without HTTP); routers
  parse → call one service → serialize. Money/qty are `Decimal`/`NUMERIC(28,10)`, rates
  `NUMERIC(28,12)`, serialized as strings; every metric field carries a `units` entry.
- **Frontend:** React 18 / TypeScript / Vite / TanStack Query / Zustand / Tailwind + Radix /
  Recharts. Thin consumer — no financial math.
- **Data isolation:** every `Series` belongs to a user; all reads/metrics/comparisons are
  user-scoped.

## Quick start — full stack with Docker Compose

```bash
cp .env.example .env          # then edit secrets (JWT_SECRET, ADMIN_PASSWORD, …)
docker compose up --build     # db (migrate on boot) → backend → frontend
```

- Frontend: <http://localhost:5173>
- Backend API + docs: <http://localhost:8000/docs> (OpenAPI at `/openapi.json`)
- The backend auto-applies migrations and seeds the admin (`ADMIN_EMAIL`/`ADMIN_PASSWORD`)
  on startup. Log in with those credentials.
- Optional DB UI: `docker compose --profile tools up adminer` → <http://localhost:8080>.

Tear down (keep data): `docker compose down`. Wipe data too: `docker compose down -v`.

## Local dev (fast reload, app on host, Postgres in Docker)

Start just Postgres:
```bash
docker compose up -d db
```

### Backend
```bash
cd backend
uv sync                                   # install deps from uv.lock
cp ../.env.example .env                    # backend reads ./.env
uv run alembic upgrade head                # create schema
uv run uvicorn app.main:app --reload       # http://localhost:8000/docs
```

### Frontend
```bash
cd frontend
npm install
npm run dev                                # http://localhost:5173 (Vite proxies /api → :8000)
```

## Migrations

```bash
cd backend
uv run alembic revision --autogenerate -m "describe change"   # after editing models/
uv run alembic upgrade head                                   # apply
uv run alembic downgrade -1                                   # roll back one
```

A fresh database is fully built by `alembic upgrade head` (DoD-5).

## Tests & quality gates

```bash
# Backend — ruff + unit/api tests + >=90% coverage gate on app/services
cd backend
uv run ruff check . && uv run ruff format --check .
uv run pytest                              # unit (services) + api (TestClient vs test Postgres)

# Frontend — eslint + build + vitest
cd frontend
npm run lint
npm run build
npm run test -- --run
```

CI (`.github/workflows/ci.yml`) runs the same checks on every push/PR against a
`postgres:16` service container.

## Environment variables

| Var | Scope | Purpose | Default |
|-----|-------|---------|---------|
| `DATABASE_URL` | backend | Postgres DSN (`postgresql+psycopg://…`) | — |
| `TEST_DATABASE_URL` | backend tests | Separate test DB | — |
| `JWT_SECRET` | backend | HMAC secret (HS256) | — |
| `JWT_ALGORITHM` | backend | JWT alg | `HS256` |
| `ACCESS_TOKEN_TTL_MIN` | backend | Access token lifetime (min) | `15` |
| `REFRESH_TOKEN_TTL_DAYS` | backend | Refresh token lifetime (days) | `14` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | backend | Seeded admin on startup (idempotent) | — |
| `CORS_ORIGINS` | backend | Comma-separated SPA origins | `http://localhost:5173` |
| `RISK_FREE_RATE` | backend | Annual rf for Sharpe/Sortino | `0` |
| `ANNUALIZATION_DAYS` | backend | √N / ×N annualization | `365` |
| `SHARPE_MIN_SAMPLE_TRADES` | backend | `low_sample` flag threshold | `20` |
| `SHARPE_MIN_ACTIVE_DAYS` | backend | `low_sample` flag threshold | `30` |
| `SHARPE_SUPPRESS_BELOW` | backend | Suppress Sharpe/Sortino below N trades | `5` |
| `PER_TRADE_MATCH_TOLERANCE` | backend | Per-trade matcher window (seconds) | `300` |
| `VITE_API_BASE_URL` | frontend | API base (dev proxy → `/api`) | `/api` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | compose | Postgres container creds | `liveboard` |
| `BACKEND_PORT` / `FRONTEND_PORT` | compose | Host port mappings | `8000` / `5173` |

## Project layout

```
LiveBoard/
  backend/    FastAPI app (app/{core,models,schemas,routers,services,alembic}) + tests, uv
  frontend/   React (Vite) app
  docker-compose.yml   full stack: postgres + backend + frontend (+ optional adminer)
  .env.example         documented env vars
  docs/                specs, plans, and Phase-9 review checklists
```

## Notes on the data model

- Equity/drawdown are **realized-only** (no mark-to-market); the UI labels this honestly.
- Capital base is **external flows only** (no compounding); TWR is the headline return.
- Voided rows are retained for audit but excluded from all computation.
- See `docs/superpowers/specs/` for the full design, structure/acceptance, and UX specs.
```

> If a README already exists, merge these sections rather than blindly overwriting; keep any project-specific notes already present.

- [ ] **Step 4: Verify**
Run: `grep -Eq "docker compose up" README.md && grep -q "uv run uvicorn app.main:app" README.md && grep -q "npm run dev" README.md && grep -q "alembic upgrade head" README.md && grep -q "uv run pytest" README.md && echo "README commands present"`
Expected: PASS — prints `README commands present`. Then dry-run the three documented flows (compose up; host backend; host frontend) to confirm each command is copy-pasteable and correct.
Expected: each documented command runs as written.

- [ ] **Step 5: Commit**
```bash
git add README.md
git commit -m "P9: README — dev flow, env vars, architecture overview"
```

---

### Task 10: End-to-end smoke check + final acceptance sweep (验收标准 A–N + DoD-1…9)

**Files:**
- Create: `scripts/smoke.sh`, `docs/acceptance-sweep.md`

**Interfaces:**
- Consumes: the full stack (Tasks 1–3), the coverage gate (Task 4), CI (Task 5), and the review docs (Tasks 6–9); the entire acceptance set from `2026-06-19-liveboard-structure-and-acceptance.md`.
- Produces: (a) a scripted clean-bring-up smoke test proving `docker compose up` yields a working app with a seeded admin reachable end-to-end; (b) the authoritative checklist mapping **every** 验收标准 group and DoD item to its verifying command/test. This is the Phase 9 gate.

- [ ] **Step 1: Write the check** — deliverable: a smoke script (compose up → `/health` + `/docs` → register/login round-trip) and an acceptance-sweep doc enumerating A, B, C, D, M2, CCY, TZ, FEE, E, F, G, ENV, AUD, H, I, J, K, L, M, N + DoD-1…9. Neither exists yet.

- [ ] **Step 2: Run to see current state**
Run: `test -f scripts/smoke.sh && echo "exists" || echo "no smoke script"`
Expected: `no smoke script`.

- [ ] **Step 3: Implement**

Create `scripts/smoke.sh` (clean bring-up + end-to-end reachability; exits non-zero on any failure):
```bash
#!/usr/bin/env bash
set -euo pipefail

# End-to-end smoke test for the full Docker Compose stack.
# Proves: clean `docker compose up` → db migrated → backend healthy with seeded
# admin → frontend served → register + login round-trip works end-to-end.

BACKEND="http://localhost:${BACKEND_PORT:-8000}"
FRONTEND="http://localhost:${FRONTEND_PORT:-5173}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me}"

cleanup() { docker compose down -v >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "==> Building and starting the full stack (detached)"
docker compose up -d --build

echo "==> Waiting for backend health (up to ~90s)"
for i in $(seq 1 30); do
  if curl -fsS "$BACKEND/health" >/dev/null 2>&1; then echo "backend healthy"; break; fi
  sleep 3
  if [ "$i" -eq 30 ]; then echo "FAIL: backend never became healthy"; docker compose logs backend; exit 1; fi
done

echo "==> /health returns ok"
curl -fsS "$BACKEND/health" | grep -q '"ok"' || { echo "FAIL: /health body"; exit 1; }

echo "==> OpenAPI docs reachable"
curl -fsS -o /dev/null -w "%{http_code}" "$BACKEND/docs"   | grep -q 200 || { echo "FAIL: /docs"; exit 1; }
curl -fsS -o /dev/null            "$BACKEND/openapi.json"  || { echo "FAIL: /openapi.json"; exit 1; }

echo "==> Frontend served (SPA index)"
curl -fsS "$FRONTEND/" | grep -qi 'id="root"' || { echo "FAIL: frontend index"; exit 1; }

echo "==> Frontend proxies /api to backend"
curl -fsS -o /dev/null -w "%{http_code}" "$FRONTEND/api/health" | grep -q 200 \
  || { echo "FAIL: /api proxy"; exit 1; }

echo "==> Seeded admin can log in"
ADMIN_LOGIN=$(curl -fsS -X POST "$BACKEND/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
echo "$ADMIN_LOGIN" | grep -q 'access_token' || { echo "FAIL: admin login"; exit 1; }

echo "==> Register a new user → pending (201)"
EMAIL="smoke+$(date +%s)@example.com"
REG_CODE=$(curl -fsS -o /dev/null -w "%{http_code}" -X POST "$BACKEND/auth/register" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"pw-smoke-123\"}")
[ "$REG_CODE" = "201" ] || { echo "FAIL: register code $REG_CODE"; exit 1; }

echo "==> Pending user login is rejected (403)"
PEND_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BACKEND/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"pw-smoke-123\"}")
[ "$PEND_CODE" = "403" ] || { echo "FAIL: pending login expected 403, got $PEND_CODE"; exit 1; }

echo "ALL SMOKE CHECKS PASSED"
```
Make it executable: `chmod +x scripts/smoke.sh`.

Create `docs/acceptance-sweep.md` — the authoritative final checklist. Each row maps an acceptance group / DoD item to the command or test that proves it:
```markdown
# Phase 9 Final Acceptance Sweep

Run order: (1) backend gates, (2) frontend gates, (3) full-stack smoke, (4) manual UI/a11y/responsive.

```bash
# 1. Backend: lint + unit/api tests + >=90% services coverage gate
cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest && cd ..
# 2. Frontend: eslint + build + vitest
cd frontend && npm run lint && npm run build && npm run test -- --run && cd ..
# 3. Full stack end-to-end
bash scripts/smoke.sh
```

## Backend acceptance (验收标准 2.1)

| Group | What it asserts | Verifying test / command |
|-------|-----------------|--------------------------|
| **A** Auth & approval (A1–A9) | register→pending→approve→login→refresh→me; pending/rejected→403; admin-only; idempotent admin seed | `tests/api/test_auth.py`, `tests/api/test_admin.py`; admin seed via `tests/unit` + smoke admin login |
| **B** API key lifecycle (B1–B5) | create-once full key, hashed storage, prefix-only list, revoke→401, X-API-Key auth + `last_used_at` | `tests/api/test_api_keys.py` |
| **C** Ingestion (C1–C12) | series create + 1:1 account; batch upsert/dedup; partial success in one tx; 413 cap; auto-create strategy/instrument; fund movements; instruments/fx/benchmark; void soft-delete; IngestionBatch audit | `tests/unit/test_ingestion.py`, `tests/api/test_ingestion_api.py`, `tests/api/test_instruments_api.py`, `tests/api/test_fx_api.py`, `tests/api/test_benchmark_api.py` |
| **D** FIFO pairing (D1–D10) | long/short/partial; exit-full + entry-prorata fees; isolation; open-leg excluded; same-ts tiebreak; position_effect; lot vs position views | `tests/unit/test_pairing.py` |
| **M2** Instrument & multiplier (M2-1…3) | multiplier scales PnL; unknown symbol inferred; asset_class set | `tests/unit/test_pairing.py`, `tests/api/test_instruments_api.py` |
| **CCY** Currency & FX (CCY-1…4) | base_currency validation; instrument-ccy→base as-of conversion; missing-rate flag + exclusion; cross-series currency guard | `tests/unit/test_fx.py`, `tests/api/test_fx_api.py`, `tests/api/test_comparison_api.py` |
| **TZ** Timestamps (TZ-1…3) | reject non-UTC; trade date in session_tz; boundary example | `tests/unit/test_ingestion.py` (UTC + session_tz fixtures) |
| **FEE** Fee semantics (FEE-1…4) | gross/net; entry-fee prorata; open-leg `fees_on_open_positions`; negative fees | `tests/unit/test_pairing.py`, `tests/unit/test_metrics.py` |
| **E** Capital base (E1–E6) | external-only net; inter-strategy net-zero; strategy/free-cash bases; time-varying; no compounding | `tests/unit/test_capital.py` |
| **F** Metrics (F1–F10) | realized + indexed equity; drawdown; Sharpe/Sortino conventions; trade stats; symbol PnL-only; date filter; TWR neutralizes timing; pinned risk conventions; expanded metrics; benchmark alpha/beta/IR | `tests/unit/test_metrics.py`, `tests/unit/test_benchmark.py`, `tests/api/test_metrics_api.py`, `tests/api/test_benchmark_api.py` |
| **G** Comparison (G1–G10) | account always; name_key strategy match; symbol match; deterministic per-trade matcher; unmatched surfaced; baseline signing; currency guard; pagination; stateless; date range | `tests/unit/test_comparison.py`, `tests/api/test_comparison_api.py` |
| **ENV** Envelope/units/precision (ENV-1…6) | meta complete; flags accurate; units map; render-ready series; string Decimals; symbol field trimming | `tests/api/test_metrics_api.py`; `docs/openapi-review.md` (Task 6) |
| **AUD** Audit & void (AUD-1…3) | void excludes/retains; late fill re-pairs; IngestionBatch traceable | `tests/unit/test_ingestion.py`, `tests/unit/test_pairing.py` |
| **H** Isolation (H1–H3) | cross-user series→404; comparison cross-user rejected; ingest ownership | `tests/api/test_metrics_api.py`, `tests/api/test_comparison_api.py`, `tests/api/test_ingestion_api.py` |

## Frontend acceptance (验收标准 2.2)

| Group | What it asserts | Verifying test / command |
|-------|-----------------|--------------------------|
| **I** Login/register/awaiting (I1–I4) | pending confirmation; 403 awaiting copy; approved redirect; silent refresh | `frontend` vitest component tests for auth pages/guards + manual smoke |
| **J** API keys copy-once (J1–J3) | copy-once modal; prefix-only list + revoke; approved-only | vitest for `ApiKeyCreatedModal`/`ApiKeysPage` + manual |
| **K** Admin approvals (K1–K2) | admin-only guard; approve/reject live update | vitest for `RequireAdmin`/`AdminUsersPage` + manual |
| **L** Series management (L1–L2) | list + counts; create + detail (strategies/symbols) | vitest + manual |
| **M** Dashboard (M1–M5) | selectors refetch; cards/charts from backend; realized labeling + DD caveat; symbol-level trimming; flag badges; load/empty/error states | vitest for selectors/cards/flag-badges + manual |
| **N** Comparison (N1–N5) | pick ≥2 (submit disabled <2); side-by-side cards; overlaid curves; paginated per-trade diff; unmatched + currency mismatch | vitest for `PerTradeDiffTable`/`SeriesPicker` + manual |

## Definition of Done (验收标准 2.3)

| DoD | Requirement | Verifying command / artifact |
|-----|-------------|------------------------------|
| **DoD-1** Unit tests + ≥90% services coverage | services fixtures cover D–G/M2/CCY/TZ/FEE/ENV/AUD + ingestion | `cd backend && uv run pytest` (coverage gate, Task 4) |
| **DoD-2** API tests vs test Postgres | auth/api-key/ingestion/instrument/fx/benchmark/metrics/comparison end-to-end | `tests/api/*` run by `uv run pytest` against `TEST_DATABASE_URL` |
| **DoD-3** Error handling | uniform error JSON; 401/403/404/409/413/422; partial success via body | `tests/api/*` status-code assertions; `docs/openapi-review.md` status-code section |
| **DoD-4** Data isolation | all read/metrics/comparison user-scoped; cross-user rejected | `tests/api/test_metrics_api.py`, `test_comparison_api.py` (§H) |
| **DoD-5** Migrations | fresh DB built by `alembic upgrade head`; all unique/NUMERIC constraints | `uv run alembic upgrade head` on empty DB (entrypoint Task 1; CI Task 5) |
| **DoD-6** Runnable | compose up Postgres; backend `uv sync && uv run uvicorn` + admin seed; frontend `npm run dev` via proxy; README | `bash scripts/smoke.sh`; README (Task 9) |
| **DoD-7** Quality gate | ruff green; pytest unit+api green; frontend lint + build green | sweep commands (1)+(2) above; CI `.github/workflows/ci.yml` (Task 5) |
| **DoD-8** Consistency | API shape = design §8; layering = §9 (logic only in services, thin routers) | `docs/openapi-review.md`; code review of `routers/*` vs `services/*` |
| **DoD-9** Backend-computed / portable data | no FE financial math; self-describing complete responses; render-ready typed series; string Decimals + units; data-only (no presentation); OpenAPI contract; services callable w/o HTTP | `docs/openapi-review.md`; FE code review (grep for PnL/Sharpe/FIFO math); `tests/unit/*` prove services run without FastAPI |

## Phase 9 gate sign-off

- [ ] Sweep commands (1) backend + (2) frontend both green.
- [ ] `bash scripts/smoke.sh` prints `ALL SMOKE CHECKS PASSED` (clean compose up → seeded admin reachable end-to-end).
- [ ] CI green on the latest push.
- [ ] `docs/openapi-review.md`, `docs/accessibility-pass.md`, `docs/responsive-pass.md` fully ticked.
- [ ] Every acceptance group (A–N + M2/CCY/TZ/FEE/ENV/AUD) and DoD-1…DoD-9 row above checked.
```

- [ ] **Step 4: Verify**
Run: `bash scripts/smoke.sh`
Expected: PASS — ends with `ALL SMOKE CHECKS PASSED`: the stack builds, the backend migrates + becomes healthy, `/health`/`/docs`/`/openapi.json` respond, the frontend serves the SPA and proxies `/api`, the seeded admin logs in, a new registration returns 201 (pending), and a pending login is 403. Then run the full sweep:
Run: `cd backend && uv run ruff check . && uv run pytest && cd ../frontend && npm run lint && npm run build && npm run test -- --run`
Expected: PASS — backend lint clean, pytest green with coverage ≥90%, frontend lint/build/vitest green. Finally tick every row in `docs/acceptance-sweep.md`.
Expected: all acceptance groups + DoD-1…9 checked; the Phase 9 gate is satisfied.

- [ ] **Step 5: Commit**
```bash
git add scripts/smoke.sh docs/acceptance-sweep.md
git commit -m "P9: e2e smoke check + final acceptance sweep (验收标准 A–N + DoD-1…9)"
```

---

## Self-Review — Phase 9 acceptance-gate coverage

The Phase 9 gate has two clauses: **(1) clean `docker compose up` brings up a working full-stack app with a seeded admin reachable end-to-end**, and **(2) every 验收标准 group and DoD item checks out.** Both are covered:

1. **Clean compose up → working app with seeded admin** → **Tasks 1–3** build the backend image (migrate-then-serve entrypoint), the frontend image (nginx static-serve + `/api` proxy), and the full `docker-compose.yml` with healthcheck-ordered startup (`db` healthy → `backend` migrates+healthy → `frontend`). **Task 10's `scripts/smoke.sh`** proves it end-to-end: builds the stack, waits for backend health, checks `/health` + `/docs` + `/openapi.json`, confirms the SPA is served and `/api` is proxied, logs in as the seeded admin, and exercises a register→pending→403-login round-trip. This is the literal gate command (DoD-6).

2. **Every acceptance group + DoD item** → **Task 10's `docs/acceptance-sweep.md`** is the explicit cross-reference table: backend groups **A, B, C, D, M2, CCY, TZ, FEE, E, F, G, ENV, AUD, H** each map to their `tests/unit` and/or `tests/api` files; frontend groups **I, J, K, L, M, N** map to vitest component tests + manual UI verification; **DoD-1…DoD-9** each map to a concrete command or artifact. The ≥90% services coverage gate (DoD-1) is enforced in **Task 4** (`--cov=app/services --cov-fail-under=90`); API-vs-test-Postgres (DoD-2) and the full quality gate (DoD-7) run in **Task 5's CI** against a `postgres:16` service container; OpenAPI completeness/units + the portable-data contract (DoD-3/DoD-8/DoD-9) are reviewed in **Task 6**; accessibility (UX §6 — contrast AA/AAA, keyboard nav, P/L color+sign+glyph triple-encoding, reduced motion) in **Task 7**; responsive degradation (UX §7 breakpoints) in **Task 8**; and the README dev flow + env table + architecture overview (DoD-6) in **Task 9**.

**Scope discipline:** Phase 9 introduces **no application features and no financial logic** — it adds Dockerfiles, a compose topology, a CI workflow, a coverage gate, four review/verification docs, a smoke script, and a README. The only code that may change is (a) targeted **unit tests** added if Task 4 finds services coverage < 90%, and (b) **frontend a11y/responsive fixes** surfaced by Tasks 7–8 — both squarely "integration hardening," not new behavior. All Global Constraints continue to hold: money/qty stay `Decimal`/string-serialized with `units`; UTC ingestion + `session_tz` trade dates are unchanged; the frontend remains computation-free (re-verified by the DoD-9 review); business logic stays in `app/services/*` (re-verified by the DoD-8 review); per-user isolation and void-exclusion are re-asserted via the §H/AUD rows of the sweep.