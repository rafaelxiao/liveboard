# LiveBoard — Project Structure & Acceptance Criteria

**Date:** 2026-06-19
**Status:** Structural design + acceptance criteria
**Source of truth:** `2026-06-19-liveboard-design.md` (this document elaborates it; it does not change it)

This document turns the approved design into a concrete, buildable structure with
checkable acceptance criteria. **Part 1** is the project structure (backend, frontend,
config/tooling, module boundaries). **Part 2** is the 验收标准 (acceptance criteria, in
Chinese as requested).

---

# Part 1 — Project Structure

## 1.1 Repository top level

```
LiveBoard/
  backend/                  # FastAPI app + tests, managed by uv
  frontend/                 # React (Vite) app
  docker-compose.yml        # local Postgres (+ optional adminer) for dev/test
  .env.example              # documented env vars (copied to .env locally)
  README.md                 # run instructions (dev, migrations, tests)
  docs/                     # specs (this file lives under docs/superpowers/specs/)
```

Backend and frontend are separate package roots so each has its own toolchain, lockfile,
and CI lane. The two communicate over HTTP only (Vite dev proxy locally, CORS in prod).

---

## 1.2 Backend directory tree (`backend/`)

```
backend/
  pyproject.toml            # project metadata + deps (managed by uv); ruff/pytest config
  uv.lock                   # pinned dependency lockfile (committed)
  alembic.ini               # Alembic config; script_location = app/alembic
  .env.example              # symlinked/duplicated doc of required env (see §1.4)
  app/
    __init__.py
    main.py                 # build FastAPI app, CORS, register routers, startup admin-seed hook
    db.py                   # SQLAlchemy engine, SessionLocal, Base, get_db() dependency
    core/
      __init__.py
      config.py             # Settings (pydantic-settings) loaded from env; single source for config
      security.py           # password hash/verify, JWT encode/decode, API-key generate/hash/verify
      deps.py               # FastAPI deps: get_current_user (JWT), get_api_user (X-API-Key), require_admin, require_approved
      errors.py             # typed domain exceptions + FastAPI exception handlers (uniform error JSON)
    models/                 # SQLAlchemy ORM only (no business logic)
      __init__.py           # imports all models so Alembic autogenerate sees them
      user.py               # User(id, email, password_hash, role, status, created_at)
      api_key.py            # ApiKey(id, user_id, name, key_hash, prefix, last_used_at, created_at, revoked_at)
      series.py             # Series(id, user_id, name, tag, notes, base_currency, session_tz, created_at)
                            #   base_currency = ISO-4217; session_tz = IANA tz
      account.py            # Account(id, series_id unique 1:1)
      strategy.py           # Strategy(id, series_id, name, name_key); unique(series_id, name); name_key = lower+trim
      instrument.py         # Instrument(id, series_id, symbol, asset_class, currency, multiplier, tick_size?, lot_size?, inferred); unique(series_id, symbol)
      fx_rate.py            # FxRate(id, series_id, ccy_from, ccy_to, ts, rate)  # NUMERIC(28,12); as-of conversion to base_currency
      benchmark_return.py   # BenchmarkReturn(id, series_id, name, ts, return_pct)  # optional uploaded benchmark series
      fund_movement.py      # FundMovement(id, series_id, ts, currency, amount, from_bucket, to_bucket, from_strategy_id?, to_strategy_id?, created_at, updated_at, voided_at?)
      fill.py               # Fill(id, series_id, strategy_id, symbol, side, qty, price, commission, exchange_fee, regulatory_fee, financing_fee, ts, client_fill_id, signal_id?, position_effect?, created_at, updated_at, voided_at?); unique(series_id, client_fill_id)
      ingestion_batch.py    # IngestionBatch(id, series_id, api_key_id, received_at, kind, inserted, updated, rejected)  # audit trail per ingestion call
    schemas/                # Pydantic request/response DTOs (no ORM, no logic)
      __init__.py
      auth.py               # RegisterIn, LoginIn, TokenPair, RefreshIn, UserOut
      api_key.py            # ApiKeyCreateIn, ApiKeyCreatedOut (with full key), ApiKeyOut (prefix only)
      admin.py              # AdminUserOut
      series.py             # SeriesCreateIn (base_currency, session_tz, instruments?), SeriesOut, SeriesDetailOut, StrategyIn
      instrument.py         # InstrumentIn, InstrumentOut (incl. inferred flag)
      fx.py                 # FxRateIn, FxIngestOut
      benchmark.py          # BenchmarkIn (name + returns[]), BenchmarkIngestOut
      ingestion.py          # FillIn (fee components, position_effect), FillBatchIn, BatchResultOut (batch_id), FundMovementIn, FundIngestOut, VoidFillsIn, VoidOut
      metrics.py            # MetricsQuery (trade_view, active_days_only), MetricsEnvelope (meta+metrics+units+equity_curve+drawdown_series), EquityPoint, DrawdownPoint, MetaBlock, FlagsBlock
      comparison.py         # ComparisonIn (baseline_series_id, trade_view, per_trade_page/page_size), ComparisonOut (account/strategy/symbol/per_trade+unmatched blocks)
    routers/                # THIN HTTP layer: parse/validate -> call service -> serialize. No business logic.
      __init__.py           # api_router aggregator
      auth.py               # POST /auth/register|login|refresh, GET /auth/me
      api_keys.py           # POST/GET /api-keys, DELETE /api-keys/{id}
      admin.py              # GET /admin/users, POST /admin/users/{id}/approve|reject
      series.py             # POST /series, GET /series, GET /series/{id}
      ingestion.py          # POST /series/{id}/fills:batch, POST /series/{id}/fund-movements, POST /series/{id}/fills:void
      instruments.py        # POST /series/{id}/instruments  (declare/correct instrument specs)
      fx.py                 # POST /series/{id}/fx-rates
      benchmark.py          # POST /series/{id}/benchmark
      metrics.py            # GET /series/{id}/metrics  (level, date range, trade_view, active_days_only)
      comparisons.py        # POST /comparisons
    services/               # ALL business logic. Pure-ish functions taking a Session + typed args.
      __init__.py
      users.py              # register/approve/reject/login logic, status transitions, admin seed
      api_keys.py           # create (returns full key once), list, revoke, resolve key->user, touch last_used_at
      series.py             # create series (+ optional strategies/instruments/fund movements), list w/ counts, detail w/ discovered symbols + instruments
      ingestion.py          # batch fill upsert by client_fill_id, partial-success report, 10k cap, auto-create strategy/instrument, void, audit batch
      capital.py            # double-entry capital base from FundMovements, external-only, in base ccy (see signatures below)
      fx.py                 # as-of FxRate lookup + instrument-ccy -> base-ccy conversion; missing-rate flagging
      pairing.py            # FIFO round-trip construction per (strategy, symbol); long/short/partial; multiplier, ts+client_fill_id tiebreak, fee split, lot/position views
      metrics.py            # equity/indexed curve, TWR, CAGR, vol, Sharpe/Sortino/Calmar, drawdown, expanded trade stats; orchestrates capital+pairing+fx
      benchmark.py          # alpha/beta/information ratio vs uploaded benchmark
      comparison.py         # multi-series alignment (account/strategy/symbol) + deterministic per-trade matcher + pagination + unmatched
    alembic/
      env.py                # Alembic env; imports app.db.Base + models metadata; reads DB URL from settings
      script.py.mako        # migration template
      versions/             # generated migration scripts (one per schema change)
  tests/
    conftest.py             # fixtures: test engine/session, FastAPI TestClient, factory helpers, auth tokens
    unit/                   # service-layer tests, no HTTP
      test_capital.py       # capital base external-only (no PnL compounding) + inter-strategy transfer net-zero, base ccy
      test_fx.py            # as-of rate lookup, instrument-ccy -> base conversion, missing-rate flagging (not assumed 1.0)
      test_pairing.py       # FIFO long/short/partial + multiplier (futures/options) + ts/client_fill_id tiebreak + fee pro-rata split + open-leg fees; lot vs position views
      test_metrics.py       # equity/indexed curve, TWR vs cashflows, Sharpe/Sortino/Calmar/CAGR/vol conventions (rf, √365, zero-day, low_sample/suppress), expanded trade stats, symbol PnL-only
      test_benchmark.py     # alpha/beta/information ratio vs uploaded benchmark; null when absent
      test_ingestion.py     # upsert dedup, partial success, 10k cap, auto-create strategy/instrument, void soft-delete, audit batch, UTC/timezone validation, trade-date in session_tz
      test_comparison.py    # alignment (name_key/symbol), deterministic per-trade matcher (side+nearest-ts within tolerance), unmatched surfacing, baseline signing
    api/                    # FastAPI TestClient against a test Postgres
      test_auth.py          # register -> pending -> approve -> login; refresh; /me
      test_api_keys.py      # create (full key once), list (prefix only), revoke, X-API-Key auth
      test_admin.py         # admin-only access; approve/reject flows
      test_ingestion_api.py # batch dedup, partial success, 413 cap, fund movements, void, audit-batch recorded
      test_instruments_api.py # POST instruments upsert + inferred-on-unknown-symbol
      test_fx_api.py        # POST fx-rates; missing-rate flag surfaced in metrics
      test_benchmark_api.py # POST benchmark; alpha/beta/IR present, null without
      test_metrics_api.py   # level + date-range + trade_view + active_days_only, per-user isolation, self-describing envelope (meta/flags/units)
      test_comparison_api.py# multi-series comparison end-to-end: currency guard, baseline, per_trade pagination + unmatched
```

### Key service module boundaries & public signatures

These signatures define the testable contracts. (`Session` = SQLAlchemy session; concrete
return types live in `schemas/` or small dataclasses in the service module.)

**`services/capital.py`** — double-entry capital base. The only place that interprets buckets.
```python
# Bucket enum: EXTERNAL | FREE_CASH | STRATEGY
# All amounts are converted to series base_currency (via services/fx) before aggregation.
# EXTERNAL-only: realized trading PnL never flows back into the base (no compounding).
def account_base(session, series_id, at: datetime | None) -> Decimal
    # net of all EXTERNAL movements with ts <= at; internal transfers cancel; base ccy

def strategy_base(session, series_id, strategy_id, at: datetime | None) -> Decimal
    # net flow into that strategy bucket with ts <= at; base ccy

def free_cash(session, series_id, at: datetime | None) -> Decimal
    # net flow into FREE_CASH with ts <= at; base ccy

def base_series(session, series_id, level, ref_id, days: list[date]) -> dict[date, Decimal]
    # capital base sampled per day, for use as the Sharpe/Sortino/return denominator
```

**`services/fx.py`** — currency conversion via as-of FxRate lookup.
```python
def as_of_rate(session, series_id, ccy_from, ccy_to, ts: datetime) -> Decimal | None
    # last-known FxRate with rate.ts <= ts; None if no rate exists before ts (caller flags fx_missing)

def to_base(session, series_id, amount: Decimal, ccy: str, ts: datetime) -> Decimal | None
    # converts amount in `ccy` to series base_currency at the as-of rate; identity if ccy == base;
    # None when the required rate is missing (the fill is excluded from base aggregates, not assumed 1.0)
```

**`services/pairing.py`** — FIFO round-trip construction. Pure function over fills.
```python
@dataclass
class RoundTrip:
    strategy_id: int; symbol: str
    open_ts: datetime; close_ts: datetime
    qty: Decimal; direction: str           # long | short
    multiplier: Decimal                    # instrument contract/point value
    currency: str                          # instrument currency (pre-conversion)
    entry_price: Decimal; exit_price: Decimal
    gross_pnl: Decimal                     # (exit-entry)*qty*multiplier, sign-adjusted; instrument ccy
    entry_fees: Decimal; exit_fees: Decimal; total_fees: Decimal  # entry fees pro-rata by closed qty
    net_pnl: Decimal                       # gross_pnl - total_fees
    fx_missing: bool                       # True if as-of base-ccy rate was unavailable

def pair_fills(fills: list[Fill], instruments: dict[str, Instrument]) -> list[RoundTrip]
    # FIFO per (strategy, symbol); fills ordered by ts then client_fill_id (deterministic tiebreak);
    # supports long/short and partial (lot splitting); optional position_effect hint else side+net;
    # gross PnL = (exit-entry)*closed_qty*multiplier; exit fees in full + entry fees pro-rata by closed qty;
    # open-leg fees excluded from round-trips (reported separately as fees_on_open_positions)

def fees_on_open_positions(fills, instruments) -> Decimal     # fees on still-open lots, for reconciliation
def to_positions(round_trips: list[RoundTrip]) -> list[RoundTrip]  # group flat-to-flat lots into per-position trades
```

**`services/metrics.py`** — consumes capital + pairing + fx; never stores results.
```python
def compute_metrics(session, series_id, level, *, strategy=None, symbol=None,
                    date_from=None, date_to=None, trade_view="lot",
                    active_days_only=False) -> MetricsEnvelope
    # returns self-describing envelope: meta (level, base_currency, session_tz, date_range,
    #   trade_view, capital_base, sample counts, flags) + metrics (+units map) + equity_curve + drawdown_series
    # level=account|strategy: return-based (equity curve, TWR, CAGR, vol, Sharpe, Sortino, Calmar, max_dd) + trade stats
    # level=symbol: trade stats + realized PnL only (no return%/Sharpe/TWR); adds contribution-to-strategy

def equity_curve(round_trips, base) -> list[EquityPoint]  # cumulative realized PnL + indexed_return (PnL/base), stepped at closes
def drawdown_series(curve) -> list[DrawdownPoint]         # peak-to-trough on the realized curve
def twr(session, series_id, level, ref_id, round_trips) -> Decimal  # split at EXTERNAL cashflows, chained sub-periods
def daily_returns(round_trips, base_series) -> dict[date, Decimal]  # realized PnL/base resampled to calendar days
def sharpe(daily_returns) -> float | None   # rf=RISK_FREE_RATE, √ANNUALIZATION_DAYS; None when suppressed
def sortino(daily_returns) -> float | None  # downside deviation below target 0
def trade_stats(round_trips) -> TradeStatsOut
    # gross/net PnL, total fees, win rate, avg win/loss, profit factor, payoff_ratio, expectancy,
    # max_consec_wins, max_consec_losses, largest_win, largest_loss, avg holding, trade count
```

**`services/benchmark.py`** — benchmark-relative metrics (optional).
```python
def benchmark_metrics(return_series: dict[date, Decimal],
                      benchmark: dict[date, Decimal]) -> dict   # {alpha, beta, information_ratio}
    # computed only when a BenchmarkReturn series exists; all None otherwise
```

**`services/ingestion.py`** — idempotent batch append, validation, void & audit.
```python
def ingest_fills_batch(session, series_id, api_key_id, fills: list[FillIn]) -> BatchResultOut
    # rejects if len > 10_000 (router maps to 413); upserts on (series_id, client_fill_id);
    # validates each row: qty>0, ts is ISO-8601 UTC (reject naive/non-UTC), fee components default 0 (may be negative),
    #   symbols uppercased, strategy name_key lower+trim; auto-creates unknown strategies & instruments (inferred);
    # commits valid rows in one tx; writes an IngestionBatch audit row;
    # returns {batch_id, inserted, updated, rejected, errors:[{client_fill_id, row, reason}]}

def ingest_fund_movements(session, series_id, movements: list[FundMovementIn]) -> int
    # validates bucket/strategy pairing + UTC ts; auto-creates unknown strategies; returns count

def void_fills(session, series_id, client_fill_ids: list[str]) -> int
    # soft-delete: sets voided_at; rows retained for audit, excluded from all computation; returns voided count
```

**`services/comparison.py`** — stateless multi-series alignment + deterministic per-trade matcher.
```python
def compare(session, user_id, series_ids: list[int], *, baseline_series_id=None,
            date_from=None, date_to=None, trade_view="lot",
            per_trade_page=1, per_trade_page_size=500) -> ComparisonOut
    # currency guard: only series sharing base_currency are diffed; mismatches flagged currency_mismatch (no diff);
    # baseline: 2 series -> B-A; 3+ -> baseline_series_id (default first-picked) signs all diffs;
    # account: always; strategy: where name_key matches; symbol: where uppercased symbol matches in matched strategy;
    # per_trade: deterministic matcher within aligned (strategy, symbol) by same side + nearest ts within
    #   PER_TRADE_MATCH_TOLERANCE (default 5 min), greedy by time -> diff price_slippage(±,%)/timing_sec/qty_diff/fee_diff;
    #   unmatched fills surfaced (never dropped); per_trade is paginated;
    # enforces every series_id belongs to user_id (else 404/403)
```

**Boundary rules that keep units independently testable**
- `routers/*` contain no business logic — they validate input, call one service function,
  serialize the result, and map domain exceptions to HTTP codes.
- `services/capital.py`, `fx.py`, `pairing.py`, `metrics.py`, `benchmark.py`, `comparison.py`
  are deterministic given their inputs and are unit-tested with in-memory fixtures (no HTTP,
  minimal DB).
- `models/*` hold no logic beyond ORM mapping/constraints.
- `core/security.py` is the only place that knows how tokens/keys are hashed.

---

## 1.3 Frontend directory tree (`frontend/`)

```
frontend/
  package.json              # scripts: dev, build, preview, lint, test
  vite.config.ts            # Vite config + dev proxy (/api -> backend)
  tsconfig.json             # TypeScript config
  index.html                # SPA entry
  .env.example              # VITE_API_BASE_URL (optional; defaults to /api via proxy)
  src/
    main.tsx                # React root, providers (router, auth, query client)
    App.tsx                 # top-level layout + route outlet
    routes.tsx              # route table (public vs. protected vs. admin)
    api/
      client.ts             # fetch/axios instance: base URL, JSON, error normalization
      auth.ts               # register/login/refresh/me calls
      apiKeys.ts            # create/list/revoke API keys
      admin.ts              # list users, approve/reject
      series.ts             # list/create series, get detail
      ingestion.ts          # (optional) frontend-side edits if used
      metrics.ts            # get metrics (level, date range)
      comparison.ts         # post comparison
    auth/
      AuthContext.tsx       # current user + tokens in context; login/logout
      tokenStore.ts         # access/refresh token persistence + silent refresh on 401
      RequireAuth.tsx       # route guard (redirects to /login)
      RequireAdmin.tsx      # route guard (admin role only)
    pages/
      LoginPage.tsx         # email/password login; surfaces 403 "awaiting approval"
      RegisterPage.tsx      # signup; shows pending-approval confirmation
      AwaitingApprovalPage.tsx # explicit state for pending users
      ApiKeysPage.tsx       # list keys + create (copy-once modal) + revoke
      AdminUsersPage.tsx    # pending users table; approve/reject buttons
      SeriesListPage.tsx    # list/create series; show counts + ingestion status
      SeriesDetailPage.tsx  # series strategies + discovered symbols + review/correct inferred instruments
      DashboardPage.tsx     # series + level + date-range selectors -> cards + charts
      ComparisonPage.tsx    # pick 2+ series + date range -> side-by-side + overlay + diff table
    components/
      LevelSelector.tsx     # account | strategy | symbol picker
      DateRangePicker.tsx   # date_from / date_to control
      MetricCard.tsx        # single metric tile (with "realized" labeling where applicable)
      MetricCardGrid.tsx    # grid of metric cards
      EquityChart.tsx       # Recharts realized-PnL equity curve (single or overlaid)
      DrawdownChart.tsx     # Recharts drawdown series
      TradeStatsTable.tsx   # win rate, avg win/loss, profit factor, hold, count
      PerTradeDiffTable.tsx # comparison per-trade diff rows
      ApiKeyCreatedModal.tsx# copy-once full-key display
      SeriesPicker.tsx      # multi-select for comparison
      RealizedBadge.tsx     # reusable "realized" label for equity/drawdown
    state/
      useSeries.ts          # data-fetch hooks (caching/loading/error)
      useMetrics.ts
      useComparison.ts
    lib/
      format.ts             # number/currency/percent/date formatting
      types.ts              # shared TS types mirroring backend schemas
```

State approach: a server-cache library (e.g. TanStack Query) for API data via the
`state/use*.ts` hooks; React context only for auth/session. This keeps pages thin and
components presentational/testable.

---

## 1.4 Config & tooling

### Environment variables (documented in `.env.example`)
| Var | Scope | Purpose |
|-----|-------|---------|
| `DATABASE_URL` | backend | Postgres DSN, e.g. `postgresql+psycopg://user:pass@localhost:5432/liveboard` |
| `JWT_SECRET` | backend | HMAC secret for signing JWTs |
| `JWT_ALGORITHM` | backend | default `HS256` |
| `ACCESS_TOKEN_TTL_MIN` | backend | access token lifetime (e.g. 15) |
| `REFRESH_TOKEN_TTL_DAYS` | backend | refresh token lifetime (e.g. 14) |
| `ADMIN_EMAIL` | backend | seeded admin user on startup |
| `ADMIN_PASSWORD` | backend | seeded admin password (no-op if user exists) |
| `RISK_FREE_RATE` | backend | annual risk-free rate for Sharpe/Sortino (default `0`) |
| `ANNUALIZATION_DAYS` | backend | calendar-day annualization factor (default `365`; √365 / ×365) |
| `SHARPE_MIN_SAMPLE_TRADES` | backend | round-trips below this flag `low_sample` (default `20`) |
| `SHARPE_MIN_ACTIVE_DAYS` | backend | active days below this flag `low_sample` (default `30`) |
| `SHARPE_SUPPRESS_BELOW` | backend | round-trips below this suppress Sharpe/Sortino (null) (default `5`) |
| `PER_TRADE_MATCH_TOLERANCE` | backend | per-trade matcher nearest-ts window, seconds (default `300` = 5 min) |
| `CORS_ORIGINS` | backend | comma-separated allowed origins for the SPA |
| `TEST_DATABASE_URL` | backend tests | separate Postgres DB for API tests |
| `VITE_API_BASE_URL` | frontend | API base; defaults to `/api` (dev proxy) |

### Backend tooling (`pyproject.toml` + `uv`)
- Managed with `uv`: `uv sync` installs from `uv.lock`; `uv run` runs commands in the venv.
- Deps: `fastapi`, `uvicorn[standard]`, `sqlalchemy`, `alembic`, `psycopg[binary]`,
  `pydantic`, `pydantic-settings`, `passlib[bcrypt]`, `python-jose` (or `pyjwt`).
- Dev deps: `pytest`, `pytest-cov`, `httpx`, `ruff`.
- `pyproject.toml` also holds `[tool.ruff]`, `[tool.pytest.ini_options]` (e.g. coverage
  gate on `app/services`).

### Alembic
- `script_location = app/alembic`; `env.py` imports `app.db.Base` (with all models via
  `app/models/__init__.py`) for autogenerate; DB URL read from `Settings`, not hardcoded.
- Workflow: `uv run alembic revision --autogenerate -m "..."` then `uv run alembic upgrade head`.
- Tests run `alembic upgrade head` against `TEST_DATABASE_URL` in a fixture (or
  `Base.metadata.create_all` for speed — pick one and keep it consistent).

### Frontend ↔ backend
- **Dev:** Vite proxy forwards `/api/*` to `http://localhost:8000` — no CORS needed locally.
- **Prod:** backend enables CORS for `CORS_ORIGINS`; SPA calls the API base from
  `VITE_API_BASE_URL`.

### Local dev (`docker-compose.yml`)
- One `postgres` service (named volume for persistence) exposing 5432; optional
  `adminer` for DB inspection. App and frontend run on the host via `uv run uvicorn` and
  `npm run dev` (kept out of compose for fast reloads). A second DB (or the same server,
  different database) backs `TEST_DATABASE_URL`.

---

# Part 2 — 验收标准 (Acceptance Criteria)

> 说明：以下验收标准均为可执行、可检查项。后端以 Given/When/Then 或清单形式给出，每条对应
> 至少一个单元测试（`tests/unit`）或 API 测试（`tests/api`）。金额/数量采用 `Decimal`/`NUMERIC`
> 端到端精确计算并以字符串序列化，断言原则上精确；仅在不可避免处（如 Sharpe 年化）允许合理容差。
> 所有 `ts` 为 ISO-8601 UTC，交易日按 series `session_tz` 推导。

## 2.1 后端验收标准（Backend）

### A. 认证与用户审批流程（auth & user approval）
- **A1 注册创建 pending 用户**：Given 任意邮箱+密码，When `POST /auth/register`，Then 返回
  `201`，用户 `status=pending`，密码以哈希存储（数据库中不出现明文）。
- **A2 邮箱唯一**：When 用已存在邮箱再次注册，Then 返回冲突错误（`409`），不创建重复用户。
- **A3 pending 不能登录**：Given `status=pending` 用户，When `POST /auth/login`，Then 返回
  `403` 且消息为 "awaiting approval"，不签发任何 token。
- **A4 approved 可登录**：Given `status=approved` 用户，When 凭正确密码登录，Then 返回
  `access_token` + `refresh_token`；密码错误返回 `401`。
- **A5 refresh**：Given 有效 refresh token，When `POST /auth/refresh`，Then 返回新的
  `access_token`；过期/无效 refresh token 返回 `401`。
- **A6 /auth/me**：Given 有效 access token，When `GET /auth/me`，Then 返回当前用户信息
  （含 role、status），无 token 返回 `401`。
- **A7 admin 审批**：Given admin，When `POST /admin/users/{id}/approve`，Then 目标用户
  `status=approved`（返回 `204`）；`reject` 使其变为 `rejected`。rejected 用户登录得 `403`。
- **A8 admin 鉴权**：When 非 admin 调用任意 `/admin/*`，Then 返回 `403`。
- **A9 admin 种子**：Given 设置了 `ADMIN_EMAIL`/`ADMIN_PASSWORD`，When 应用启动，Then 存在
  一个 `role=admin, status=approved` 用户；再次启动为幂等 no-op（不重复创建、不覆盖密码）。

### B. API Key 生命周期（API key lifecycle）
- **B1 仅 approved 可创建**：Given approved 用户（JWT），When `POST /api-keys {name}`，Then
  返回 `201` 且**完整 key 仅此一次**出现在响应；pending 用户创建返回 `403`。
- **B2 哈希存储**：创建后数据库仅保存 `key_hash` 与短 `prefix`；完整 key 不可再次取回。
- **B3 列表只回显 prefix**：When `GET /api-keys`，Then 返回 `[{id, name, prefix, last_used_at,
  created_at}]`，不含完整 key 或 hash。
- **B4 撤销**：When `DELETE /api-keys/{id}`，Then 返回 `204` 并标记 `revoked_at`；此后用该 key
  调用 ingestion 返回 `401`。
- **B5 鉴权与 last_used**：Given 有效未撤销 key，When 携带 `X-API-Key` 调用 ingestion，Then
  鉴权通过且 `last_used_at` 被更新；无效/他人 key 返回 `401`。

### C. 数据摄取（ingestion：批量追加、去重、部分成功、上限）
- **C1 创建 series 一次**：When `POST /series`（API key，body 含 `base_currency`、`session_tz`、
  可选 `instruments`），Then 返回 `201 {series_id}`，自动创建对应 1:1 `Account`；可选
  `strategies`/`instruments`/`fund_movements` 一并落库。缺失或非法 `base_currency`(ISO-4217)/
  `session_tz`(IANA) 时整请求被拒（`422`）。
- **C2 批量追加**：When `POST /series/{id}/fills:batch` 提交合法 fills（含可选费用分项
  `commission/exchange_fee/regulatory_fee/financing_fee` 与 `position_effect`），Then 返回
  `{batch_id, inserted, updated, rejected, errors}`，且 `inserted` 行落库。
- **C3 client_fill_id 去重（幂等）**：Given 已存在某 `client_fill_id` 的 fill，When 重发**字段
  完全相同**的同 id，Then 计入 `updated`（或 no-op），不产生重复行；同 id 但**字段变化**时
  原行被就地更新（保留 `created_at`、刷新 `updated_at`）。重复运行整批安全。
- **C4 部分成功 + 单事务**：Given 一批中含非法行（如负数量、未知 side、缺字段、非 UTC 时间戳），
  When 提交，Then 合法行在**单一事务**内提交、非法行进入 `rejected` 且 `errors` 给出
  `{client_fill_id, row, reason}`；非法行不影响合法行落库。
- **C5 10k 上限**：When 单次 `:batch` 提交 > 10,000 条，Then 返回 `413`，整批不落库。
- **C6 自动创建策略与合约**：Given fill 引用未知策略名，When 摄取，Then 首次出现即创建该
  `Strategy`（`name_key` 为 lower+trim）；引用未知 symbol 时自动创建 `Instrument`
  （`asset_class=equity, multiplier=1, currency=base_currency, inferred=true`）以便后续更正。
- **C7 资金流水摄取**：When `POST /series/{id}/fund-movements`，Then 返回 `{ingested:n}`，
  bucket 取值限定 `EXTERNAL|FREE_CASH|STRATEGY`，`STRATEGY` 时必须给出对应策略名，否则该行
  被拒并报因；`from_bucket != to_bucket`、`amount > 0`。
- **C8 合约声明/更正**：When `POST /series/{id}/instruments`，Then 按 `(series_id, symbol)`
  upsert 合约规格（`asset_class/currency/multiplier/tick_size?/lot_size?`），并将 `inferred`
  置为 `false`；返回 `{upserted:n}`。
- **C9 FX 汇率摄取**：When `POST /series/{id}/fx-rates`，Then 落库 `{ccy_from, ccy_to, ts, rate}`
  时间序列（`rate` 为 `NUMERIC(28,12)`），返回 `{ingested:n}`，供 instrument ccy→base 的 as-of 换算。
- **C10 基准序列摄取（可选）**：When `POST /series/{id}/benchmark` 提交 `{name, returns:[{ts,
  return_pct}]}`，Then 落库为可选 `BenchmarkReturn`，返回 `{ingested:n}`；不影响核心“仅交易输入”约束。
- **C11 作废（void，软删除）**：When `POST /series/{id}/fills:void {client_fill_ids}`，Then 对应
  fill 被置 `voided_at`（软删除），返回 `{voided:n}`；被作废行**保留**于库中供审计，但**排除**于
  所有计算（配对/指标/比较）。绝不硬删除。
- **C12 摄取审计批次**：每次摄取调用写入一条 `IngestionBatch`
  `{id, series_id, api_key_id, received_at, kind, inserted, updated, rejected}`；可经审计查询追溯
  数据何时变更。

### D. FIFO 配对正确性（pairing）
- **D1 多头完整配对**：Given buy 100@10 后 sell 100@12（同一 strategy/symbol），Then 生成 1 条
  round-trip，`direction=long`，`gross_pnl = (12-10)*100*multiplier`，`net_pnl = gross_pnl - total_fees`。
- **D2 空头配对**：Given sell 50@20（开空）后 buy 50@18（平空），Then `direction=short`，
  `gross_pnl = (20-18)*50*multiplier`（已按空头符号调整），`net_pnl = gross_pnl - total_fees`。
- **D3 部分配对（一平多开）**：Given buy 100@10、buy 100@11，再 sell 150，Then 平仓按 FIFO 先
  消耗 100@10 再消耗 50@11，生成相应分拆 round-trip，PnL 按对应批次计算。
- **D4 部分配对（多平一开）**：Given buy 100@10，再 sell 40、sell 60，Then 一个开仓批次被两个
  平仓批次分别平掉，生成两条 round-trip。
- **D5 费用归集（出场全额 + 入场按量分摊）**：每条 round-trip 的费用 = 出场 fill 费用全额 +
  入场 fill 费用**按平仓量 pro-rata 分摊**；`total_fee = commission + exchange_fee +
  regulatory_fee + financing_fee`。
- **D6 隔离**：不同 `(strategy, symbol)` 的 fills 不会互相配对。
- **D7 未平仓**：仅有开仓而无平仓的 fills 不产生 round-trip（不计入已实现 PnL）；其开仓腿费用
  不计入任何 round-trip，单列为 `fees_on_open_positions` 以便对账。
- **D8 FIFO 同时间戳确定性**：Given 多个 fill `ts` 相同，Then 排序以 `ts` 为主、`client_fill_id`
  为次（tiebreak），重复计算结果稳定可复现。
- **D9 position_effect 提示（可选）**：给出 `position_effect` 时按其判定开/平；缺省时由 side +
  运行净头寸判定。
- **D10 逐笔(lot) vs 逐仓(position) 两种视图**：默认 `trade_view=lot`（每个 FIFO 平仓为一条
  round-trip）；`trade_view=position` 将“由平到平”的一段连续头寸的所有平仓合并为一笔交易；两视图
  由同一组 round-trip 派生，响应中标明所用视图。

### M2. 合约与乘数（instrument & multiplier）
- **M2-1 乘数缩放 PnL**：Given 同样的 (entry, exit, qty)，Then `gross_pnl` 随 `multiplier` 线性
  缩放——equity/crypto-spot `multiplier=1`；future（如 ES `multiplier=50`）、option（典型 `100`）
  按合约点值放大；以 fixture 校验数值。
- **M2-2 未知 symbol 自动推断**：Given fill 引用未声明的 symbol，Then 自动创建
  `Instrument(asset_class=equity, multiplier=1, currency=base_currency, inferred=true)`，且
  `GET /series/{id}` 暴露 `inferred=true` 供用户更正；显式 `POST /instruments` 后 `inferred=false`。
- **M2-3 资产类别**：`asset_class ∈ equity|future|option|fx|crypto|cfd`；`tick_size`/`lot_size`
  可选，仅用于校验/展示。

### CCY. 货币与汇率（currency & FX）
- **CCY-1 base_currency 校验**：Series 必须声明合法 ISO-4217 `base_currency`；所有指标、权益
  曲线、比较均以 base_currency 报告。
- **CCY-2 合约币种 → base 换算**：Given 合约 `currency` 与 base 不同，Then fill 的 PnL/费用先以
  合约币种计算，再用 fill `ts` 处（或之前最近一条）`FxRate` as-of 汇率换算到 base；币种相同则不换算。
- **CCY-3 缺失汇率标记并排除**：Given 所需 as-of 汇率缺失，Then 该 fill 被标记 `fx_missing=true`、
  **排除**于 base 货币聚合（**不**假设 1.0），且在响应 `meta.flags.fx_missing` 暴露缺口。
- **CCY-4 跨 series 货币护栏**：仅当多个 series 的 `base_currency` 相同才进行 diff；币种不同的
  series 并排展示并打 `currency_mismatch` 标志（无 diff）。

### TZ. 时间戳与时区（timestamps & trade date）
- **TZ-1 拒绝非 UTC**：所有 `ts` 必须为 ISO-8601 **UTC**；naive 或非 UTC 时间戳在摄取时被拒
  （计入 `rejected` 并报因）。
- **TZ-2 交易日按 session_tz 计算**：用于日期范围过滤与对齐的“交易日”取 `ts` 在 series
  `session_tz` 下的日历日期，而非 UTC 日期。
- **TZ-3 边界示例**：Given `2026-06-19T01:31:00Z` 且 `session_tz=America/New_York`（前一日
  21:31 ET），Then 该 fill 归属本地交易日 `2026-06-18`，与按 UTC 日期归类不同——以 fixture 校验。

### FEE. 费用语义（gross/net、分项、分摊、负费用）
- **FEE-1 gross vs net**：指标同时报告 `gross_pnl`、`total_fees`、`net_pnl`；胜率、profit factor
  及交易统计基于 **net**（gross 变体亦暴露）。
- **FEE-2 部分平仓入场费分摊**：部分平仓时入场腿费用按平仓量 pro-rata 归集到对应 round-trip。
- **FEE-3 开仓腿费用排除但对账**：仍未平仓头寸的开仓腿费用不计入任何 round-trip，单列
  `fees_on_open_positions`，使总额可对账。
- **FEE-4 负费用/返佣**：各费用分项默认 `0` 且可为**负**（如 maker rebate）；负费用正确参与
  `total_fee` 求和与 net PnL 计算。

### E. 资金基数 / 双分录（capital base, double-entry）
- **E1 账户基数 = 净外部资本**：account base(t) = Σ(EXTERNAL→内部) − Σ(内部→EXTERNAL)，
  `ts ≤ t`，以 base_currency 计。内部 bucket 间转账对账户基数贡献为 0。
- **E2 策略间转账净零**：Given `STRATEGY(a) → STRATEGY(b)`，Then 账户基数不变，策略 a 基数
  减少、策略 b 基数等额增加（合计净零）。
- **E3 策略基数**：strategy base(t) = 流入该策略 bucket 净额（含 `FREE_CASH→STRATEGY`、
  `EXTERNAL→STRATEGY`、来自其它策略的转入，减去流出），`ts ≤ t`。
- **E4 自由现金**：free cash(t) = 流入 `FREE_CASH` 净额，`ts ≤ t`。
- **E5 时变性**：在不同 t 取样，基数随 `ts ≤ t` 的流水单调累加变化；用作 Sharpe/Sortino/收益的
  分母时按日取样正确。
- **E6 仅外部资本、不复利**：基数仅由 EXTERNAL 流水构成；已实现交易 PnL **不**回流进基数。
  Given 一笔交易盈利使权益翻倍，但无新的外部注资，Then 分母（资金基数）保持不变——以 fixture 校验
  “赚钱不改变分母”。

### F. 指标正确性（metrics）
- **F1 已实现权益曲线**：account/strategy 级权益曲线为**已实现 PnL 累计**，在每个平仓时间点
  阶梯式跳变；未平仓不计入（不做市价标记）；同时返回 `indexed_return`（PnL ÷ 资金基数）归一化曲线。
- **F2 回撤**：drawdown 为该已实现曲线的峰到谷；`max_dd` 为最大回撤值，区间内无新高时正确累计；
  区间内存在未平仓头寸时 `max_dd` 被标注（`meta.flags.open_positions_exist`）。
- **F3 Sharpe/Sortino**：基于按日历日重采样的已实现 PnL 收益序列除以**时变资金基数**计算；无平仓
  日记为 0 收益日；Sortino 仅用下行波动（目标 0）。给定固定 fixture 时数值落在预期容差内。
- **F4 交易统计（所有级别）**：胜率、平均盈利、平均亏损、profit factor、payoff_ratio、expectancy、
  max_consec_wins、max_consec_losses、largest_win、largest_loss、平均持仓时长、交易次数，均与
  round-trip fixture 一致，且基于 net PnL（gross 变体亦暴露）。
- **F5 symbol 仅 PnL**：symbol 级返回已实现 PnL 与交易统计，并给出**对所属策略 PnL 的贡献占比**；
  **不**返回 return%/Sharpe/Sortino/TWR/CAGR（接口中这些字段缺省/为 null）。
- **F6 日期范围过滤**：account/strategy/symbol 各级均支持 `date_from`/`date_to`，仅纳入区间内
  平仓的 round-trip（交易日按 `session_tz` 计算，见 TZ-2）；边界含起含止一致实现。
- **F7 TWR（时间加权收益，headline）**：在每个外部现金流（触及 EXTERNAL 的 FundMovement）处切分
  子区间并链式相乘，中和入金/出金**时机**。Given 两个 series 交易完全相同但注资时间表不同，Then
  二者 TWR 相同——以 fixture 校验。
- **F8 风险约定（pinned）**：
  - 风险无风险利率取 `RISK_FREE_RATE`（年化，默认 0）。
  - 年化采用 `√ANNUALIZATION_DAYS`/`×ANNUALIZATION_DAYS`（默认 365），对应日历日重采样 + 0 收益补齐。
  - 无平仓日记为 0% 收益（会抑制波动、可能抬高 Sharpe，文档已声明该偏差）；另暴露
    `active_days_only` 变体（仅活跃日）。
  - 当 round-trips `< SHARPE_MIN_SAMPLE_TRADES (20)` **或** active days `< SHARPE_MIN_ACTIVE_DAYS (30)`
    时打 `low_sample` 标志；当 round-trips `< SHARPE_SUPPRESS_BELOW (5)` 时 Sharpe/Sortino **抑制**
    返回 null（`sharpe_suppressed=true`）。样本计数在 `meta.sample` 暴露。
- **F9 扩展指标存在且正确**：account/strategy 级返回 TWR、CAGR、volatility、Calmar，并在所有级别
  返回 expectancy、payoff_ratio、max_consec_wins/losses、largest_win/loss；以 fixture 校验数值
  与定义一致（Calmar = CAGR/|max_dd|，expectancy = 胜率×均盈 − 败率×均亏 等）。
- **F10 基准相对指标（可选）**：Given 已上传 `BenchmarkReturn`，Then 额外计算并返回 `alpha`、
  `beta`、`information_ratio`；未上传时三者为 null。

### G. 比较（comparison）
- **G1 账户级始终比较**：Given ≥2 series，When `POST /comparisons`，Then `account` 块包含每个
  series 的指标，无条件比较。
- **G2 策略按名匹配**：仅当**归一化策略名**（`name_key`，lower+trim）在多个 series 间相同才进入
  `strategy` 块对比；未匹配策略并列展示且不产生 diff（`matched=false`）。
- **G3 symbol 匹配**：在已匹配策略内，**大写归一化**后的 symbol 相同才比较，且仅 PnL 类指标。
- **G4 确定性逐笔配对（per-trade matcher）**：在已对齐的 `(strategy, symbol)` 内，跨 series 按
  **相同 side** + **容差窗内最近时间戳**（`PER_TRADE_MATCH_TOLERANCE`，默认 300s）贪心按时间配对；
  每对生成一行，含 `price_slippage`（绝对+%，从 baseline 视角带符号）、`timing_sec`、`qty_diff`、
  `fee_diff`。取代旧的按“date”天级匹配。
- **G5 未匹配 fills 显式暴露**：任一侧未配对的 fills 在 `per_trade.unmatched[series_id]` 列出
  （绝不静默丢弃）。
- **G6 baseline 与符号**：2 个 series 时 diff 为 `B − A`；3+ 时以 `baseline_series_id`
  （默认首选 series）为基准对所有 diff 签名。
- **G7 货币护栏**：仅 `base_currency` 相同的 series 间 diff；不同币种 series 在
  `meta.currency_mismatch_series` 标注并并排展示（无 diff）。
- **G8 per_trade 分页**：`per_trade` 按 `per_trade_page`/`per_trade_page_size` 分页，响应含
  `{page, page_size, total, rows, unmatched}`，限定响应体大小。
- **G9 无状态**：comparison 结果不持久化，无历史；重复请求结果幂等（输入相同则输出相同）。
- **G10 日期范围**：可选 `date_from/date_to` 约束所有级别，行为与 F6 一致。

### ENV. 自描述响应封套与精度（envelope, units & precision）
- **ENV-1 meta 完整**：metrics/comparison 响应的 `meta` 含 `level`、`base_currency`、
  `session_tz`、`date_range`、`trade_view`、`capital_base`、`sample`（round_trips/active_days）。
- **ENV-2 标志位**：`meta.flags` 含 `realized_only`、`low_sample`、`sharpe_suppressed`、
  `fx_missing`、`open_positions_exist`，取值与实际计算状态一致。
- **ENV-3 units 映射**：`metrics.units` 为每个数值字段标注单位（币种码/percent/ratio/
  annualized_ratio/seconds/count）；消费者无需额外知识即可解释字段。
- **ENV-4 可直接渲染序列**：`equity_curve`（含 `realized_pnl` + `indexed_return`）与
  `drawdown_series` 为已排序、带类型的点数组，前端不重采样/分桶/重算。
- **ENV-5 数值精度**：金额/数量为 `NUMERIC(28,10)`、汇率/比率为 `NUMERIC(28,12)`，端到端
  `Decimal`；JSON 中所有数值序列化为**字符串**以避免浮点漂移。
- **ENV-6 symbol 级字段裁剪**：symbol 级响应省略 return 类字段（return%/Sharpe/Sortino/TWR/CAGR
  为 null），仅保留 PnL 与交易统计 + 贡献占比。

### AUD. 审计、作废与“当前最佳估计”（audit, void & re-pairing）
- **AUD-1 作废排除计算、保留行**：被 `voided_at` 标记的 fill/fund-movement 不参与配对/指标/比较，
  但仍存于库中可审计查询。
- **AUD-2 迟到/回填 fill 重配历史**：Given 增量摄取一条更早 `ts` 的 fill，Then 后续 FIFO lots
  被重新配对、历史指标随之改变；指标语义为“**当前最佳估计**”，且审计批次记录变更时点（文档行为）。
- **AUD-3 摄取批次可追溯**：每次摄取写 `IngestionBatch`，计数（inserted/updated/rejected）与
  `received_at`、`api_key_id`、`kind` 可供审计。

### H. 日期过滤与按用户隔离（isolation）
- **H1 跨用户隔离（读/指标）**：用户只能访问自己的 series；访问他人 `series_id` 返回 `404`
  （不泄露存在性）。
- **H2 跨用户隔离（比较）**：`POST /comparisons` 若 `series_ids` 含非本人 series，则整请求被
  拒（`404`/`403`），不返回任何他人数据。
- **H3 摄取归属**：通过 API key 摄取的数据归属该 key 所属用户；无法向他人 series 追加。

## 2.2 前端验收标准（Frontend）

### I. 登录 / 注册 / 等待审批
- **I1**：注册成功后展示"已提交、等待管理员审批"的明确状态（AwaitingApproval），不直接进入
  Dashboard。
- **I2**：pending 用户登录时，前端捕获 `403` 并展示"awaiting approval"提示，而非通用错误。
- **I3**：approved 用户登录后获取并保存 token，跳转到默认受保护页（如 Series 列表）。
- **I4**：access token 过期时静默用 refresh token 续期；refresh 失败则登出并回到 `/login`。

### J. API Key 管理（copy-once）
- **J1**：创建 key 后弹出 copy-once 模态，展示**完整 key 一次**并提供复制按钮；关闭后无法再次
  查看完整 key。
- **J2**：列表仅展示 `name/prefix/last_used_at/created_at`，提供撤销操作；撤销后从列表移除或标记。
- **J3**：仅 approved 用户可进入并使用该页（pending 用户被引导至等待审批状态）。

### K. 管理员审批页
- **K1**：仅 admin 可见/可访问（非 admin 路由守卫拦截）。
- **K2**：展示 pending 用户列表，提供 approve/reject；操作后列表实时更新，状态反映到后端。

### L. Series 管理
- **L1**：可列出 series 并展示计数（如策略数/fills 数）与摄取状态。
- **L2**：可创建 series；详情页展示策略与已发现的 symbols。

### M. Dashboard
- **M1**：提供 series 选择、level 选择（account/strategy/symbol）、date-range 选择、trade_view
  选择（lot/position）、以及 `active_days_only` 开关。
- **M2**：展示 metric 卡片（含 TWR/CAGR/vol/Calmar/expectancy 等扩展指标）；account/strategy 级
  展示权益曲线与回撤图（Recharts）；卡片单位与标志位取自后端 `units`/`flags`，前端不计算。
- **M3**：权益/回撤相关 UI 明确标注 **"realized"**，诚实说明未做市价标记；区间内有未平仓头寸时
  对 max_dd 给出区分提示（`open_positions_exist`）。
- **M4**：symbol 级**不**展示 return%/Sharpe 卡片，仅展示 PnL 与交易统计及对策略的贡献。
- **M5**：调整 level/日期范围/trade_view 时图表与卡片随之刷新；`low_sample`/`sharpe_suppressed`/
  `fx_missing` 等标志位据后端 flags 显示徽标；加载/错误/空数据状态均有反馈。

### N. 比较视图
- **N1**：可挑选 **2+** series、设置 baseline、日期范围、trade_view 后发起比较（少于 2 个时禁止提交）。
- **N2**：并排展示各 series 的 metric 卡片（账户级始终展示）。
- **N3**：在同一张图上**叠加**多条权益曲线。
- **N4**：展示**分页**的 per-trade diff 表（按 side+最近时间戳对齐行，含 slippage/timing/qty/fee
  差异，diff 从 baseline 视角带符号）。
- **N5**：未匹配的策略/symbol/逐笔 fills 并列展示且明确标识"无可比对"（取自 `unmatched`）；币种不同的
  series 显示 `currency_mismatch` 提示。

## 2.3 横切关注点 / 完成定义（Cross-cutting / Definition of Done）

- **DoD-1 单元测试**：`app/services/` 全部核心逻辑（capital、fx、pairing、metrics、benchmark、
  ingestion、comparison）均有基于已知 fixture 的单元测试，覆盖 §D–G、M2、CCY、TZ、FEE、ENV、AUD
  的金融正确性（含 multiplier、FX 缺失标记、费用分摊与开仓腿、TWR、风险约定、lot/position 视图、
  确定性逐笔配对与 unmatched）与摄取幂等/作废。建议 services 行覆盖率门槛 ≥ 90%（在
  `pyproject.toml` 配置覆盖率 gate）。
- **DoD-2 API 测试**：通过 FastAPI `TestClient` 对**测试 Postgres** 运行，覆盖：auth 流程
  （register→pending→approve→login→refresh→me）、API key 鉴权、批量摄取（去重/部分成功/413
  上限/资金流水/作废/审计批次）、instrument/fx/benchmark 接口、metrics（level + 日期范围 +
  trade_view + active_days_only + 隔离 + 自描述封套 meta/flags/units）、comparison 端到端
  （货币护栏、baseline、per_trade 分页 + unmatched）。
- **DoD-3 错误处理**：统一错误 JSON（`core/errors.py` + 异常处理器）；域异常映射到正确 HTTP
  码（401/403/404/409/413/422）；摄取的部分成功通过响应体而非异常返回。
- **DoD-4 数据隔离**：所有读/指标/比较接口强制按 `user_id` 作用域；任何跨用户访问均被拒，并有
  测试覆盖（§H）。
- **DoD-5 迁移**：所有模型变更都有对应 Alembic 迁移；全新数据库 `alembic upgrade head` 可一次
  建好全部表与约束（含唯一约束 `unique(series_id, client_fill_id)`、`unique(series_id, name)`、
  `unique(series_id, symbol)`，以及 instrument/fx_rate/benchmark_return/ingestion_batch 表与
  软删除 `voided_at` 列、`NUMERIC(28,10)`/`NUMERIC(28,12)` 精度）。
- **DoD-6 可运行**：`docker-compose up` 起 Postgres；后端 `uv sync && uv run uvicorn` 可启动并
  自动种子 admin；前端 `npm run dev` 经 Vite 代理访问后端；README 记录全部步骤。
- **DoD-7 质量门**：`ruff` 通过、`pytest`（unit + api）全绿、前端 `lint` 与 `build` 成功，
  方可视为"完成"。
- **DoD-8 一致性**：本结构与接口不偏离设计 spec §8 的 API 形状与 §9 的分层（业务逻辑只在
  `app/services/`，router 保持薄）。
- **DoD-9 后端计算 / 数据可移植（backend-computed, portable data）**：
  - 所有指标计算均在后端完成；前端**不做任何金融计算**（无 PnL 聚合、无 Sharpe/回撤/胜率
    计算、无 FIFO 配对、无从 fills 反推数值）。审查前端代码不得出现此类逻辑。
  - metrics/comparison 响应是**自描述且完整**的：除数值外，附带 `unit`、解析后的日期范围、
    level、所用资金基数、样本计数，以及标志位（如 `realized_only`、`low_sample`、
    `sharpe_suppressed`），消费者无需额外知识即可解释每个字段。
  - 权益曲线、回撤序列、per-trade diff 均以**可直接渲染**的、已排序的、带类型的点数组返回；
    前端不重采样、不分桶、不重算。
  - 金额/数量使用精确表示（服务端 `Decimal`；序列化方式（字符串或足精度数值）一次性确定并
    在文档说明），无浮点漂移；每个数值字段标注单位（币种/百分比/比率/秒/计数）。
  - 响应**只含数据与元数据**，不含表现层信息（无颜色、无格式化后的展示字符串、无 UI 文案）；
    主题、P/L 配色、locale 格式化均由客户端负责。
  - HTTP API 为唯一公开契约，由 Pydantic 模型定义并经 `/openapi.json`（+`/docs`）暴露；React 应用
    只是其首个消费者。响应 schema 变更需版本化。
  - `app/services/*` 可脱离 FastAPI 独立调用（纯函数 + Session + 类型化参数），同一引擎可支撑
    CLI/批处理，而不只是 HTTP——以单元测试（无 HTTP）证明此独立性。

---

## Appendix — Decisions & Risks flagged

- **Backend root.** Placed FastAPI under `backend/` (not repo root) so frontend/backend
  have independent toolchains and CI lanes; spec's `app/` tree is preserved verbatim
  inside it.
- **Decimal money.** Recommend `Decimal`/`NUMERIC(28,10)` (money/qty) and `NUMERIC(28,12)`
  (rates/ratios) end-to-end to avoid float drift in PnL and capital math; JSON numbers
  serialized as strings. Tests assert with tolerance only where unavoidable (Sharpe).
- **Sharpe edge cases (risk).** Spec pins the conventions: `RISK_FREE_RATE=0`,
  `ANNUALIZATION_DAYS=365` (√365), Sortino target 0, zero-return days = 0% (documented
  Sharpe-inflation bias + `active_days_only` variant), `low_sample` when round_trips<20 or
  active_days<30, suppress (null) below 5. Define explicitly in tests: zero/again-zero base
  days, single-trade series, suppression thresholds, and annualization factor — the most
  likely sources of "wrong number" disputes.
- **Per-trade matcher (replaced day matching).** Comparison pairs fills within an aligned
  `(strategy, symbol)` by same side + nearest timestamp within `PER_TRADE_MATCH_TOLERANCE`
  (default 5 min), greedy by time; unmatched fills are surfaced, not dropped. This replaces
  the earlier day-level "date" matching — alignment is now at fill-timestamp granularity.
- **Date-range boundary semantics.** Standardized on inclusive-start/inclusive-end across
  metrics + comparison; trade date derived in series `session_tz`. Documented so F6/G10 stay
  consistent.
- **413 vs 422 for cap.** Followed spec: oversized batch → `413`; per-row validation
  failures → partial-success report (not request-level error).
- **Auth dual-mode for ingestion.** `POST /series` and ingestion accept API key (primary)
  and JWT (frontend edits) per spec; `deps.py` resolves either to a user, then the same
  ownership checks apply.
- **State lib choice (frontend).** TanStack Query suggested for server cache; not mandated
  by spec — flag for confirmation if the team prefers plain hooks/Redux.
