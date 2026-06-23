# LiveBoard — Tech Stack Decisions (ADR summary)

**Date:** 2026-06-19
**Status:** Locked for v1
**Relates to:** the three design specs in this directory (design, structure/acceptance, UX).

This document records the technology decisions for LiveBoard v1 and the rationale for
each, so the implementation roadmap and plans can reference a single source of truth.
Where a spec left a choice open, it is now closed here.

---

## 1. Backend

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Language / runtime | **Python ≥ 3.12** | f-string/typing ergonomics; avoids the 3.9 issues seen in tooling; modern `Decimal`/`zoneinfo`. |
| Package manager | **uv** | Spec mandate; fast, lockfile-based (`uv.lock` committed). |
| Web framework | **FastAPI** | Spec choice; async, Pydantic-native, auto OpenAPI (`/openapi.json`, `/docs`) — directly serves the "portable data service" goal. |
| ASGI server | **uvicorn[standard]** | Standard FastAPI pairing. |
| ORM | **SQLAlchemy 2.x** (typed, `Mapped[]`) | Mature, typed models, works with Alembic. |
| Migrations | **Alembic** | Spec choice; autogenerate from models. |
| DB driver | **psycopg 3** (`psycopg[binary]`) | Modern PostgreSQL driver, good Decimal/NUMERIC handling. |
| Validation / DTOs | **Pydantic v2** + **pydantic-settings** | Request/response models, env config; powers the self-describing envelope. |
| Password hashing | **passlib[bcrypt]** | Standard, vetted. |
| JWT | **PyJWT** | Actively maintained (chosen over python-jose); HS256 access + refresh tokens. |
| Numbers | **`decimal.Decimal`** end-to-end; `NUMERIC(28,10)` money/qty, `NUMERIC(28,12)` rates | Spec requirement; no float drift. JSON serialized as strings. |
| Time | **UTC `datetime`** (aware) + **`zoneinfo`** for `session_tz` trade-date derivation | Spec requirement; reject naive/non-UTC at ingestion. |
| Lint / format | **ruff** (lint + format) | Single fast tool. |
| Tests | **pytest** + **pytest-cov** + **httpx** (TestClient) | Unit (services) + API tests vs test Postgres; coverage gate on `app/services`. |

### Database
- **PostgreSQL 16** (Docker image `postgres:16`).
- A separate test database (`TEST_DATABASE_URL`) for API tests.

---

## 2. Frontend

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Language | **TypeScript** | Type-safe mirror of backend schemas (`lib/types.ts`). |
| Build tool | **Vite** | Spec choice; fast dev server + proxy to backend. |
| Framework | **React 18** | Spec choice. |
| Routing | **React Router** | Public/protected/admin route guards (`RequireAuth`, `RequireAdmin`). |
| Server cache / data fetching | **TanStack Query** | Caching, loading/error/refetch, pagination for `per_trade`; keeps pages thin. All data is backend-computed — Query just transports it. |
| UI / client state | **Zustand** | Lightweight store for auth/session, theme, P/L color scheme, comparison tray. Context only where it must (provider wiring). |
| Styling | **Tailwind CSS** | Utility-first; design tokens (§1.2 UX) defined as the Tailwind theme (dark default + light). |
| Component primitives | **Radix UI / shadcn-ui** | Headless, accessible primitives (modal focus trap, segmented controls, popovers) matching the a11y acceptance criteria. |
| Charts | **Recharts** | Spec choice; stepped line (equity), area-below-zero (drawdown), multi-series overlay with dash patterns. |
| Icons | **Lucide** | SVG icon set (no emoji-as-icon, per UX §6.5). |
| Fonts | **Fira Sans** (UI) + **Fira Code** (numeric, tabular-nums) | UX §1.3. |
| Tests | **Vitest** + **React Testing Library** | Component/unit; thin-frontend means little logic to test, focus on rendering states & guards. |
| Lint | **ESLint** + **Prettier** | Standard. |

### Frontend ↔ backend
- **Dev:** Vite proxy forwards `/api/*` → `http://localhost:8000` (no CORS locally).
- **Prod:** backend CORS allows `CORS_ORIGINS`; SPA uses `VITE_API_BASE_URL`.
- The HTTP API (OpenAPI) is the contract; TS types are generated/mirrored from it.

---

## 3. Infrastructure & tooling

| Concern | Decision | Rationale |
|---------|----------|-----------|
| Local orchestration | **Docker Compose** (full stack: `postgres` + `backend` + `frontend`) | One-command bring-up; deployment-agnostic. Dev may still run backend/front on host for fast reloads. |
| DB inspection (dev) | optional **adminer** service | Convenience. |
| Containers | backend `python:3.12-slim` + uv; frontend `node:20` build → static served by Vite preview / nginx | Standard. |
| Config | **Environment variables** via `.env` (documented in `.env.example`) | Single source; see §4. |
| CI (recommended) | lint + unit + API tests on push (GitHub-Actions-style); not required for v1 functionality | Quality gate (DoD-7). |
| Deployment target | **Deferred / host-agnostic** | Compose artifacts are portable; pick a host (Fly/Render/cloud) when needed. |

---

## 4. Configuration (env vars)

| Var | Scope | Purpose |
|-----|-------|---------|
| `DATABASE_URL` | backend | Postgres DSN (`postgresql+psycopg://…`) |
| `TEST_DATABASE_URL` | backend tests | Separate test DB |
| `JWT_SECRET` | backend | HMAC secret (HS256) |
| `JWT_ALGORITHM` | backend | default `HS256` |
| `ACCESS_TOKEN_TTL_MIN` | backend | e.g. 15 |
| `REFRESH_TOKEN_TTL_DAYS` | backend | e.g. 14 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | backend | seeded admin on startup (idempotent) |
| `CORS_ORIGINS` | backend | comma-separated SPA origins |
| `RISK_FREE_RATE` | backend | annual rf for Sharpe/Sortino (default `0`) |
| `ANNUALIZATION_DAYS` | backend | `365` (√365 / ×365) |
| `SHARPE_MIN_SAMPLE_TRADES` | backend | `20` (low_sample flag) |
| `SHARPE_MIN_ACTIVE_DAYS` | backend | `30` (low_sample flag) |
| `SHARPE_SUPPRESS_BELOW` | backend | `5` (suppress Sharpe/Sortino) |
| `PER_TRADE_MATCH_TOLERANCE` | backend | per-trade matcher window (default `300` s) |
| `VITE_API_BASE_URL` | frontend | API base; defaults to `/api` via dev proxy |

---

## 5. Key library versions (floors, pinned in lockfiles)

- Python `>=3.12`, fastapi `>=0.110`, sqlalchemy `>=2.0`, alembic `>=1.13`,
  psycopg `>=3.1`, pydantic `>=2.6`, pydantic-settings `>=2.2`, pyjwt `>=2.8`,
  passlib `>=1.7`, uvicorn `>=0.29`, pytest `>=8`, ruff `>=0.4`, httpx `>=0.27`.
- Node `>=20`, react `^18`, vite `^5`, typescript `^5`, @tanstack/react-query `^5`,
  zustand `^4`, tailwindcss `^3`, recharts `^2`, react-router-dom `^6`, vitest `^1`.

Exact versions are pinned by `uv.lock` and `package-lock.json`; the floors above are the
minimums the plan assumes.

---

## 6. Decisions explicitly deferred (YAGNI)

- Real deployment host / CDN / TLS termination.
- Background job queue (all computation is synchronous on-demand for v1).
- Caching layer (Redis) for computed metrics — recompute is acceptable at v1 scale.
- WebSockets / streaming (out of scope per design §12).
- Multi-region, horizontal scaling, read replicas.
