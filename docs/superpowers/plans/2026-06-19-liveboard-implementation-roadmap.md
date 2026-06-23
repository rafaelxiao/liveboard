# LiveBoard — Implementation Roadmap

> **For agentic workers:** This is a **phased roadmap**, not a task-by-task execution plan.
> Each phase below is scoped to become its own detailed plan under
> `docs/superpowers/plans/` (written with the `superpowers:writing-plans` skill) when it is
> picked up. Build phases in order; each ends at an acceptance gate that maps to the
> 验收标准 in `2026-06-19-liveboard-structure-and-acceptance.md`.

**Goal:** Build LiveBoard — a FastAPI + React + PostgreSQL app that ingests trading fills
via API, computes multi-level quant metrics on the backend, and compares 2+ datasets.

**Architecture:** Thin React frontend over a portable, backend-computed HTTP/OpenAPI data
service. All financial computation lives in `app/services/`; routers stay thin; the React
app only fetches, lays out, charts, and formats.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2 / Alembic / PostgreSQL 16 / PyJWT;
React 18 / TypeScript / Vite / TanStack Query / Zustand / Tailwind + Radix / Recharts.
Docker Compose for the full stack. See `2026-06-19-liveboard-tech-stack-decisions.md`.

## Global Constraints (apply to every phase)

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates `NUMERIC(28,12)`; JSON numbers
  serialized as **strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (reject naive/non-UTC); trade date derived in series
  `session_tz`.
- **No financial computation in the frontend.** If a number is shown, the backend produced
  it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers
  parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest`
  green before a phase gate.
- Per-user data isolation everywhere; voided rows excluded from all computation.

---

## Phase map & dependencies

```
P0 Foundations ──► P1 Auth & Users ──► P2 Series & Ingestion ──► P3 Pairing & Capital ──┐
                                                                                         ▼
                            P6 Frontend Shell & Auth ◄── (consumes P1/P2 API)     P4 Metrics Engine
                                     │                                                   │
                                     ▼                                                   ▼
                            P7 Dashboard ◄────────────── (consumes P4 API) ───────  P5 Comparison Engine
                                     │                                                   │
                                     ▼                                                   ▼
                            P8 Comparison UI ◄───────────────────────────── (consumes P5 API)
                                     │
                                     ▼
                            P9 Hardening, Docs, Compose, CI
```

Backend phases P0→P5 are the critical path and can largely precede the frontend.
Frontend phases P6→P8 depend on the corresponding backend APIs being live (a real API,
not mocks — backend-first keeps the contract honest). P6 can start once P1/P2 exist.

---

## Phase 0 — Foundations & scaffolding

**Outcome:** A runnable empty FastAPI app + Postgres via Compose, migrations wired, CI-ready
test harness.

**Backend:**
- Repo layout per structure doc: `backend/app/{core,models,schemas,routers,services,alembic}`,
  `backend/tests/{unit,api}`.
- `pyproject.toml` (uv) with dependency floors; `ruff` + `pytest` config (coverage gate on
  `app/services`).
- `core/config.py` (pydantic-settings, all env vars from tech-stack §4), `db.py`
  (engine/session/Base/`get_db`), `core/errors.py` (typed exceptions + handlers →
  uniform error JSON), `main.py` (app factory, CORS, router aggregator, startup hook stub).
- Alembic env wired to `app.db.Base` + models metadata; first empty migration.
- `docker-compose.yml`: `postgres:16` (+ optional adminer); `.env.example`.
- `tests/conftest.py`: test engine/session, `TestClient`, factory helpers.

**Deliverable / gate:** `docker compose up` starts Postgres; `uv run uvicorn` serves
`/docs`; `uv run pytest` runs (a trivial health-check test passes); `alembic upgrade head`
on an empty DB succeeds.

---

## Phase 1 — Auth & user system

**Outcome:** Registration with admin approval, JWT login/refresh, API-key lifecycle,
admin endpoints, env-seeded admin.

**Backend:**
- Models: `User`, `ApiKey`.
- `core/security.py`: bcrypt hash/verify, JWT encode/decode (PyJWT, access+refresh),
  API-key generate/hash/verify (return full key once, store hash + prefix).
- `core/deps.py`: `get_current_user` (JWT), `get_api_user` (X-API-Key, touch
  `last_used_at`), `require_admin`, `require_approved`.
- `services/users.py` (register/login/status transitions, **idempotent admin seed** on
  startup), `services/api_keys.py`.
- Routers: `auth` (register/login/refresh/me), `api_keys` (create/list/revoke), `admin`
  (list/approve/reject).

**Acceptance gate (验收标准 A, B):** register→pending→approve→login→refresh→me;
pending/rejected login → 403; admin-only enforcement; API key shown once, hashed, revoke →
401; admin seed idempotent. Unit + API tests green.

---

## Phase 2 — Series, instruments, ingestion

**Outcome:** Create a series (currency/tz/instruments), batch-append fills (dedup, partial
success, audit), fund movements, FX rates, benchmark, void.

**Backend:**
- Models: `Series` (base_currency, session_tz), `Account`, `Strategy` (name_key),
  `Instrument` (inferred), `FxRate`, `BenchmarkReturn`, `FundMovement`, `Fill` (4 fee
  components, position_effect, audit cols), `IngestionBatch`.
- `services/ingestion.py`: batch fill **upsert by client_fill_id**, validation
  (qty>0, UTC ts, symbol uppercase+trim, fee defaults/signs, FundMovement bucket rules),
  auto-create strategy/instrument (inferred), 10k cap, partial-success report, void
  soft-delete, `IngestionBatch` audit.
- `services/series.py`: create (+ optional strategies/instruments/fund_movements), list
  w/ counts, detail w/ instruments + discovered symbols.
- Routers: `series`, `ingestion` (`fills:batch`, `fills:void`, `fund-movements`),
  `instruments`, `fx`, `benchmark`.

**Acceptance gate (验收标准 C + currency/tz/fee/audit groups):** batch dedup &
idempotency; partial success in one tx; 413 over cap; auto-create inferred instrument;
UTC rejection; void excludes-but-retains; `IngestionBatch` recorded; per-user ownership on
ingest. Unit + API tests green.

---

## Phase 3 — FIFO pairing & capital base

**Outcome:** Correct round-trips (multiplier, FX, fee split, long/short/partial,
tiebreak) and the double-entry capital base.

**Backend (pure services, heavy unit tests):**
- `services/fx.py`: `convert(amount, ccy_from, ccy_to, at)` via last-known FxRate ≤ ts;
  returns `(value, fx_missing)`.
- `services/pairing.py`: `pair_fills(fills, instrument) -> list[RoundTrip]` — FIFO per
  (strategy, symbol), `ts`+`client_fill_id` tiebreak, `(exit−entry)·qty·multiplier`
  sign-adjusted, instrument-ccy → base-ccy via `fx`, exit fees full + entry fees pro-rata,
  `fees_on_open_positions`, `fx_missing` flag. RoundTrip carries gross/net/fees/currency.
- `services/capital.py`: `account_base`/`strategy_base`/`free_cash`/`base_series` from
  non-voided FundMovements in base ccy, **external-flows-only** (no compounding).

**Acceptance gate (验收标准 D, E):** D1–D7 incl. multiplier (futures/options), tiebreak
determinism, fee pro-rata + open-leg reconciliation, long/short/partial; E1–E5 incl.
inter-strategy transfer net-zero, external-only base, FX conversion + missing-rate
flagging. Pure unit tests with fixtures.

---

## Phase 4 — Metrics engine

**Outcome:** Full multi-level metrics returned in the self-describing envelope.

**Backend:**
- `services/metrics.py`: `compute_metrics(session, series_id, level, *, strategy, symbol,
  date_from, date_to, trade_view, active_days_only) -> MetricsOut`.
  - Realized equity curve (stepped) + indexed/normalized curve; drawdown series.
  - TWR (split at external cashflows); daily return series; Sharpe/Sortino/volatility
    (rf, √365, zero-day, Sortino target 0); CAGR; Calmar; max drawdown.
  - Trade stats both **per-lot** and **per-position**: gross/net PnL, fees, win rate,
    profit factor, payoff, expectancy, consec W/L, largest W/L, hold, count; symbol-level
    contribution.
  - Flags: `realized_only`, `low_sample` (<20 trades or <30 days), `sharpe_suppressed`
    (<5), `fx_missing`, `open_positions_exist`; sample counts; `units` map.
- `services/benchmark.py`: alpha/beta/information ratio vs uploaded `BenchmarkReturn`
  (null when absent).
- Router: `metrics` (`GET /series/{id}/metrics` with level/strategy/symbol/date/
  trade_view/active_days_only).

**Acceptance gate (验收标准 F + risk/return/metrics/benchmark groups):** equity/indexed
curve, TWR neutralizes cashflow timing, pinned Sharpe conventions + low_sample/suppress,
expanded metrics correctness, symbol PnL-only, benchmark alpha/beta/IR, envelope shape &
units. Unit + API tests.

---

## Phase 5 — Comparison engine

**Outcome:** Stateless multi-series comparison with deterministic per-trade matcher.

**Backend:**
- `services/comparison.py`: `compare(session, user_id, series_ids, baseline_series_id,
  date_from, date_to, trade_view, page, page_size) -> ComparisonOut`.
  - Currency guard (only same base_currency diffed); baseline signing (2→B−A, 3+→vs
    baseline); account always; strategy by `name_key`; symbol within matched strategy.
  - Per-trade matcher: within aligned (strategy, symbol), pair by **same side + nearest
    ts within `PER_TRADE_MATCH_TOLERANCE`**, greedy; diff price slippage (abs+%), timing,
    qty, fee; surface **unmatched** per side; **paginated**.
  - Ownership: every series_id must belong to user (else 404).
- Router: `comparisons` (`POST /comparisons`).

**Acceptance gate (验收标准 G, H):** account-always, name_key matching, deterministic
matcher with multiple same-day trades, unmatched surfaced, baseline signing, pagination,
currency mismatch flag, cross-user rejection. Unit + API tests.

**>>> Backend MVP complete here: a fully usable, documented OpenAPI data service.**

---

## Phase 6 — Frontend shell & auth

**Outcome:** React app shell, routing/guards, auth flows, API-key & admin pages.

**Frontend:**
- Vite + TS + Tailwind (design tokens: dark default + light; P/L scheme tokens), Radix
  primitives, Lucide icons, fonts. `api/client.ts` (base URL, error normalization),
  `auth/` (AuthContext, tokenStore w/ silent refresh, RequireAuth/RequireAdmin), Zustand
  stores (auth, theme, pnl_color_scheme). `routes.tsx`, `AppShell`/`Sidebar`/`Topbar`,
  `ThemeToggle`, `PnlColorToggle`.
- Pages: Login, Register, AwaitingApproval, ApiKeys (+ copy-once modal), AdminUsers.

**Acceptance gate (验收标准 I, J, K):** login/register/awaiting-approval states; copy-once
key modal; admin approve/reject; guards redirect; theme + P/L toggles persist. Component
tests for states/guards.

---

## Phase 7 — Dashboard (single-series analysis)

**Outcome:** The primary analysis screen, fully wired to the metrics API.

**Frontend:**
- Pages: SeriesList (create w/ currency/tz, counts, compare tray), SeriesDetail
  (strategies, symbols, InstrumentReviewPanel for inferred, FxRatesPanel), Dashboard.
- Components: `SeriesPicker`, `LevelSelector`, `TradeViewSelector`, `DateRangePicker`,
  active-days toggle, `MetricCardGrid`/`MetricCard` (+ `RealizedBadge`), `EquityChart`
  (stepped, abs/indexed toggle), `DrawdownChart` (below-zero area), `TradeStatsTable`,
  `ContributionCard`. State/flags (low_sample, sharpe_suppressed, fx_missing,
  open_positions_exist) drive badges — **no recomputation**.
- TanStack Query hooks (`useSeries`, `useMetrics`); URL-synced selectors.

**Acceptance gate (验收标准 L, M):** level/date/trade-view selectors refetch; realized
labeling + DD caveat; symbol-level hides return metrics + shows contribution; low-sample/
suppressed/fx-gap states from flags; values formatted in base currency + active P/L scheme.

---

## Phase 8 — Comparison UI

**Outcome:** The flagship comparison view.

**Frontend:**
- Page: Comparison. Components: `SeriesPicker` (multi-select ≥2), baseline selector,
  side-by-side `MetricCardGrid`, overlaid `EquityChart` (colorblind-safe palette + dash
  patterns, baseline heavier), `PerTradeDiffTable` (matched-pair rows, unmatched
  disclosure, sortable, paginated, CSV export), `MetricComparisonRow` (A|B|Δ).
- `useComparison` hook (POST, paginated per_trade).

**Acceptance gate (验收标准 N):** pick 2+ (submit disabled <2); side-by-side cards;
overlaid curves; per-trade diff with deterministic matches + unmatched; currency-mismatch
flagged; baseline signing; pagination.

---

## Phase 9 — Hardening, docs, deploy, CI

**Outcome:** Production-ready repo meeting the Definition of Done.

- README: dev flow (`docker compose up`, `uv sync && uv run uvicorn`, `npm run dev`,
  migrations, tests), env vars, architecture overview.
- Full Docker Compose (postgres + backend + frontend); backend/frontend Dockerfiles.
- CI: `ruff`, `pytest` (unit + api), frontend `lint` + `build` + `vitest`.
- Coverage gate ≥90% on `app/services`. OpenAPI reviewed for completeness/units.
- Accessibility pass (contrast, keyboard nav, colorblind P/L triple-encoding, reduced
  motion). Responsive degradation per UX §7.
- Final sweep against all 验收标准 + DoD-1…DoD-9.

**Acceptance gate:** every 验收标准 group and DoD item checks out; clean `docker compose up`
brings up a working app with seeded admin.

---

## Sequencing notes & risks

- **Build backend-first (P0–P5), then frontend (P6–P8).** The frontend is forbidden from
  computing metrics, so it needs the real API; building it against the live OpenAPI keeps
  the portable-data contract honest.
- **Highest-risk logic is P3–P5** (FIFO+multiplier+FX, Sharpe/TWR conventions, deterministic
  matcher). These are pure services — invest in fixture-based unit tests there first; they
  carry the "wrong number" risk the PM audit flagged.
- **P3 multiplier & FX are foundational** — do not defer; retrofitting them into
  `pairing.py`/`metrics.py` later is expensive.
- Each phase is independently shippable/testable and becomes its own
  `docs/superpowers/plans/YYYY-MM-DD-liveboard-phaseN-*.md` when picked up.
