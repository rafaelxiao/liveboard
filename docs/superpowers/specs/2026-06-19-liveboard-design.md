# LiveBoard — Design Specification

**Date:** 2026-06-19
**Status:** Approved design, pending spec review

## 1. Purpose

LiveBoard is a standalone web application for ingesting trading data programmatically,
computing multi-level performance metrics, and comparing two or more datasets
side-by-side. Trades are tagged (e.g. "real" / "sim") but the tag is just a label —
comparison logic is tag-agnostic.

It is **not** related to the `to-the-moon` project beyond living in the same parent
directory.

## 2. Technology Stack

- **Backend:** FastAPI (Python), dependency management via `uv`. Business logic lives in
  the service layer (no separate framework-free engine package — logic is in
  `app/services/`).
- **Database:** PostgreSQL via SQLAlchemy ORM, schema migrations via Alembic.
- **Frontend:** React (Vite build), charts via Recharts.
- **Mode:** Incremental ingestion (data appended over time), on-demand computation
  (metrics and comparisons computed when requested). No real-time streaming dashboards.

### Architectural principle — backend-computed, portable data; thin frontend

**All metric computation happens on the backend.** The frontend performs **no** financial
math — no PnL aggregation, no Sharpe/drawdown/win-rate calculation, no FIFO pairing, no
re-deriving values from raw fills. The React app only: fetches already-computed results,
arranges layout, renders charts/tables, formats display (currency/percent/locale), and
handles selectors. If a number appears in the UI, the backend produced it.

This keeps the frontend thin **and** makes the backend a **standalone, portable data
service** that other apps (a CLI, a notebook, a mobile client, another team's dashboard)
can consume directly. To honor that, the API contract must be:

- **Self-describing & complete.** A metrics/comparison response carries everything a
  consumer needs to render without back-references: values **plus** their units, the
  resolved date range, the level, the capital base used, sample counts, and flags (e.g.
  `realized_only: true`, `low_sample: true`, `sharpe_suppressed: true`). No consumer
  should need tribal knowledge to interpret a field.
- **Render-ready series.** Equity curve, drawdown series, and per-trade diff rows are
  returned as fully-formed arrays of typed points (timestamp + value + any annotation),
  pre-sorted, ready to plot. The frontend does not resample, bucket, or recompute.
- **Numerically precise & explicit.** Monetary and quantity values use a precise
  representation (Decimal server-side; serialized as strings or sufficiently-precise
  numbers, decided once and documented) so no consumer suffers float drift. Each numeric
  field states its unit (currency code, percent, ratio, seconds, count).
- **Stable & versioned.** Response schemas are defined by Pydantic models and surfaced via
  the auto-generated **OpenAPI** spec at `/v1/openapi.json` (+ `/v1/docs`). The HTTP API is the
  one public contract; the React app is just its first consumer. Breaking changes are
  versioned.
- **Consumer-agnostic.** Responses contain data and metadata only — never presentation
  concerns (no colors, no formatted display strings, no UI labels). Presentation (theme,
  P/L color scheme, locale formatting) is the client's job. This keeps the payload
  reusable across very different front-ends.

**Implication for the service layer:** `app/services/*` are the single source of truth for
all computation and must be usable independently of FastAPI (plain functions over a
Session + typed args), so the same engine could back a CLI or batch job, not only HTTP.

## 3. Authentication & Users

### Credential types
- **JWT** (access + refresh tokens) for browser login. React sends
  `Authorization: Bearer <jwt>` on read/dashboard calls.
- **API keys** for programmatic ingestion. Sent as `X-API-Key: <key>`. Keys are shown
  in full exactly once on creation, stored hashed (only a short non-secret `prefix` is
  retained for display), and revocable.

### User lifecycle
- **Open signup with admin approval.** Anyone may `POST /auth/register`. New users start
  with `status = pending`.
- A `pending` user attempting to log in receives `403` with an "awaiting approval"
  message. API keys can only be created by `approved` users.
- An **admin** approves or rejects pending users.
- **Admin bootstrapping:** an admin user is seeded from environment variables
  (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) on application startup. If the user already exists,
  seeding is a no-op.

### Ownership
- **Per-user private.** Every `Series` belongs to a `user_id`. All reads, metrics, and
  comparisons are scoped to the authenticated user. A user can never see or compare
  another user's data.

## 4. Domain Model

```
User (id, email, password_hash, role=user|admin, status=pending|approved|rejected, created_at)

ApiKey (id, user_id, name, key_hash, prefix, last_used_at, created_at, revoked_at?)

Series (id, user_id, name, tag, notes, base_currency, session_tz, created_at)
  # base_currency = ISO-4217 (e.g. "USD"); session_tz = IANA tz (e.g. "America/New_York")
  └─ Account (series_id 1:1 — top of the hierarchy)
       ├─ Instrument (series_id, symbol, asset_class, currency, multiplier, tick_size?, lot_size?)
       │                # one row per distinct symbol in the series; defines PnL scaling
       ├─ FxRate (series_id, ccy_from, ccy_to, ts, rate)
       │                # time series of rates to convert instrument ccy → base_currency
       ├─ BenchmarkReturn (series_id, name, ts, return_pct)     # optional uploaded benchmark series
       ├─ FundMovement (id, series_id, ts, currency, amount, from_bucket, to_bucket,
       │                from_strategy_id?, to_strategy_id?, created_at, voided_at?)
       └─ Strategy (id, series_id, name, name_key)              # name_key = normalized (lower+trim) for matching
            └─ Fill (id, series_id, strategy_id, symbol, side=buy|sell, qty, price,
                     commission, exchange_fee, regulatory_fee, financing_fee,
                     ts, client_fill_id, signal_id?, position_effect?,
                     created_at, updated_at, voided_at?)
                     # client_fill_id unique per series; total fee = sum of the fee components

IngestionBatch (id, series_id, api_key_id, received_at, kind, inserted, updated, rejected)
                     # audit trail of every ingestion call
```

### Hierarchy
Account → Strategy → Symbol. An account holds **free cash** and allocates funds across
multiple strategies; each strategy trades multiple symbols.

### Instrument model (multiplier & asset class)
Every distinct `symbol` in a series has an `Instrument` row defining how price maps to
money:
- `asset_class` ∈ `equity | future | option | fx | crypto | cfd`.
- `multiplier` (Decimal, **default 1**) — contract/point value. Realized PnL is
  `(exit − entry) · qty · multiplier − fees`. Equities/crypto-spot use `1`; futures use
  the contract point value (e.g. ES = 50); options typically `100`.
- `currency` (ISO-4217) — the currency the instrument trades/settles in; may differ from
  the series `base_currency`.
- `tick_size` / `lot_size` — optional, for validation/display.
- Instruments may be posted explicitly; if a fill references an unknown symbol, an
  Instrument is auto-created with `asset_class=equity, multiplier=1, currency=base_currency`
  and flagged `inferred=true` so the user can correct it.

### Currency & FX
- Each series declares a `base_currency`. All metrics, equity curves, and comparisons are
  reported in the base currency.
- A fill's PnL and fees are first computed in the **instrument currency**, then converted
  to base currency using the `FxRate` series at (or as-of, last-known-before) the fill's
  `ts`. If instrument currency == base currency, no conversion.
- If a required FX rate is missing, the affected fill is flagged (`fx_missing=true`) and
  excluded from base-currency aggregates, with the gap surfaced in the response rather than
  silently assuming 1.0.
- Cross-series comparison is only performed between series sharing a `base_currency`;
  series with differing base currencies are shown side-by-side with a "currency mismatch"
  flag (no diff).

### Fee / cost model
- Fees are itemized per fill: `commission`, `exchange_fee`, `regulatory_fee`,
  `financing_fee` (borrow/overnight carry). Each defaults to `0` and may be **negative**
  (e.g. maker rebate). `total_fee = commission + exchange_fee + regulatory_fee +
  financing_fee`.
- Metrics report **both gross and net** realized PnL (`gross_pnl`, `total_fees`,
  `net_pnl`). Win rate, profit factor, and trade stats are computed on **net** PnL (gross
  variants also exposed).
- On a **partial close**, the entry leg's fees are attributed **pro-rata by closed qty**.
- Fees on the **open leg of still-open positions** do not belong to any closed round-trip;
  they are excluded from round-trip PnL but reported as a separate
  `fees_on_open_positions` line so totals reconcile.

### Fund model (double-entry)
A single `FundMovement` records money (in a stated `currency`) moving between two
**buckets**. A bucket is one of: `EXTERNAL` (outside world), `FREE_CASH` (account-level
uninvested cash), or a specific `STRATEGY` (identified by `strategy_id`). `type` is a
human-readable label derived from the bucket pair.

| Operation | from_bucket → to_bucket |
|-----------|-------------------------|
| Deposit to account | `EXTERNAL → FREE_CASH` |
| Withdraw from account | `FREE_CASH → EXTERNAL` |
| Allocate cash to a strategy | `FREE_CASH → STRATEGY(a)` |
| Pull cash back from a strategy | `STRATEGY(a) → FREE_CASH` |
| **Transfer between strategies** | `STRATEGY(a) → STRATEGY(b)` |
| Direct external deposit to a strategy | `EXTERNAL → STRATEGY(a)` |

This makes inter-strategy transfers net-zero at the account level automatically and
supports add/deduct at both account and strategy levels.

### Capital base (time-varying)
- Capital base of a bucket at time *t* = (Σ inflows to the bucket) − (Σ outflows from the
  bucket), over all non-voided `FundMovement` with `ts ≤ t`, **in base currency**.
- **Account base** at *t* = net of all `EXTERNAL` movements with `ts ≤ t` (i.e. external
  capital currently inside the account; transfers between internal buckets cancel out).
- **Strategy base** at *t* = net flow into that strategy's bucket with `ts ≤ t`.
- **Free cash** at *t* = net flow into `FREE_CASH` with `ts ≤ t`.
- **No compounding:** the base is **external flows only** — realized trading PnL does
  **not** flow back into the base. The denominator therefore represents *return on
  invested (external) capital*. This is a deliberate, documented choice.
- Symbols have **no** capital base (see §6).

### Timestamps & trade date
- All `ts` values are **ISO-8601 UTC**; naive or non-UTC timestamps are rejected at
  ingestion.
- The **trade date** used for date-range filtering (§6) and per-trade alignment (§7) is the
  calendar date of `ts` **in the series' `session_tz`**, not UTC. This keeps a 21:31 ET
  fill on the correct local trading day.

### Derived (computed at request time, never stored as truth)
- **RoundTrip** — FIFO-paired fills per `(strategy, symbol)` producing realized PnL.
- **Comparison** — computed on-demand over a set of series + a date range. Stateless;
  not persisted.

### Data integrity, audit & corrections
- Every ingestion call writes an `IngestionBatch` audit row (counts + timestamp + key).
- Fills and fund movements carry `created_at` / `updated_at`; corrections are **upserts**
  by `client_fill_id` (fills) and updates leave an audit trail.
- Erroneous data is **voided** (soft-delete via `voided_at`), never hard-deleted; voided
  rows are excluded from all computation but retained for audit.
- Because ingestion is incremental, a **late/backdated fill re-pairs subsequent FIFO lots**
  and changes historical metrics. Metrics are therefore always the **"current best
  estimate"** as of the latest data; this is documented behavior, and the audit trail lets
  a user see when data changed.

### Numeric precision
- Money and quantities use `NUMERIC(28,10)` in PostgreSQL and `Decimal` in Python end-to-
  end (covers crypto's fractional qty and 8+ price decimals without truncation).
- Rates/ratios (`rate`, `return_pct`, multiplier) use `NUMERIC(28,12)`.
- All numeric values are serialized as **strings** in JSON to avoid float drift on any
  consumer; each field's unit is declared in the response `units` map (§8).

## 5. FIFO Pairing Rule

- Per `(strategy, symbol)`, closing fills are matched against open fills **first-in,
  first-out**.
- **Deterministic order:** fills are ordered by `ts`, then `client_fill_id` as a tiebreak,
  so identical-timestamp fills pair reproducibly.
- Supports both **long and short** positions. A `(strategy, symbol)` is netted, so it is
  either net-long or net-short at any time (no simultaneous hedged long+short). An optional
  `position_effect` hint may be supplied; absent it, side + running net position determines
  open vs close.
- Supports **partial fills** — one closing fill may consume multiple open lots, and one
  open lot may be closed by multiple closing fills.
- **Realized PnL** at each close = `(exit_price − entry_price) · closed_qty · multiplier`
  (sign-adjusted for shorts), in instrument currency, then converted to base currency via
  the as-of FX rate.
- **Fees** are attributed to the round-trip: the exit fill's fees in full, plus the entry
  fill's fees **pro-rata by closed qty**. Fees on still-open lots are excluded (reported
  separately as `fees_on_open_positions`).
- This is the standard brokerage convention.

### Trade-stat grouping (two views)
Trade statistics are offered in **two selectable views**:
- **Per-lot** (default) — each FIFO close is one round-trip (one entry lot ↔ one close
  portion). Closest to broker round-trip accounting.
- **Per-position** — all closes that drain a single contiguous open position (from flat to
  flat) are grouped into one "trade." Closer to how a trader thinks about a decision.

Both views are computed from the same round-trips; the API exposes which view a stats block
uses.

## 6. Metrics

All metrics are filterable by a date range at every level, reported in the series
`base_currency`, and computed on **net** PnL (with gross variants also exposed).

| Level | Return-based metrics | PnL & trade statistics |
|-------|----------------------|------------------------|
| **Account** | ✅ equity curve, TWR, CAGR, volatility, Sharpe, Sortino, Calmar, max drawdown (base = net external capital incl. free cash) | ✅ |
| **Strategy** | ✅ equity curve, TWR, CAGR, volatility, Sharpe, Sortino, Calmar, max drawdown (base = net flow into the strategy bucket) | ✅ |
| **Symbol** | ❌ no fixed capital → no return%/Sharpe/TWR | ✅ realized PnL (gross/net), win rate, avg win/loss, holding period, trade count, profit factor, contribution to strategy |

### Input is trades only
Only fills are posted (no NAV snapshots, no market price data). Consequences, surfaced
honestly in the UI:

- **Equity curve** = cumulative **realized** PnL, stepped at close timestamps. Open
  positions are not marked to market; unrealized swings are invisible. Labeled
  "realized" in the UI. The backend also returns a **return-indexed/normalized** curve
  (PnL ÷ capital base) so series with different capital bases compare fairly (frontend
  stays thin and does not compute it).
- **Drawdown** = peak-to-trough on that realized-PnL curve. **Caveat:** max drawdown
  reflects *closed* trades only — an open position deeply underwater shows no drawdown
  until closed, so realized max-DD can materially understate risk. This DD-specific caveat
  is surfaced distinctly from the generic "realized" badge, and max-DD is annotated when
  open positions exist in the range.

### Return methodology
- **TWR (time-weighted return)** is the **headline** return measure: the period is split at
  each external cashflow (FundMovement touching EXTERNAL), sub-period returns are chained,
  neutralizing deposit/withdrawal *timing* so strategies with different funding schedules
  compare fairly.
- The **daily return series** (realized PnL ÷ time-varying base, resampled to calendar
  days) feeds Sharpe/Sortino/volatility.

### Risk-metric conventions (pinned)
- **Risk-free rate:** `RISK_FREE_RATE` (annual, default `0`, documented) — config-driven.
- **Annualization:** `√365` and `×365` on the calendar-day return series (matches calendar
  resampling with zero-return fill-in), via `ANNUALIZATION_DAYS=365` in config.
- **Sortino target:** `0` (downside deviation below zero); configurable.
- **Zero-return days:** calendar days with no close are treated as **0% return**. This
  damps volatility and can **inflate Sharpe** for infrequent traders — explicitly
  documented; an "active-days-only" variant is also exposed.
- **Low sample / suppression:** Sharpe/Sortino are flagged `low_sample` when round-trips
  `< SHARPE_MIN_SAMPLE_TRADES (20)` **or** active days `< SHARPE_MIN_ACTIVE_DAYS (30)`, and
  **suppressed** (returned null) below `SHARPE_SUPPRESS_BELOW (5)` round-trips. Sample
  counts are returned so the frontend can badge without recomputing.

### Trade statistics (all levels)
Realized PnL (gross & net), total fees, win rate, average win, average loss, profit factor,
payoff ratio, expectancy, max consecutive wins, max consecutive losses, largest win,
largest loss, average holding period, trade count — under both per-lot and per-position
views (§5). Symbol level adds contribution to its strategy's PnL.

### Benchmark (optional)
If a `BenchmarkReturn` series is uploaded for a series, the backend additionally computes
**alpha, beta, and information ratio** of the (account/strategy) return series vs the
benchmark. Absent a benchmark, these fields are null. Benchmark returns are a separate
optional input and do not violate the trades-only constraint for core metrics.

## 7. Comparison Model

- User hand-picks **two or more** series.
- An optional date range constrains all levels.
- **Currency guard:** only series sharing a `base_currency` are diffed; a mismatched series
  is shown side-by-side with a `currency_mismatch` flag (no diff).
- **Baseline series:** with 2 series the diff is `B − A`; with 3+ a selectable baseline
  (default first-picked) signs all diffs relative to it.
- **Account level:** always compared across the chosen series.
- **Strategy level:** compared where the **normalized** strategy name (`name_key`,
  lower+trim) matches across series; unmatched strategies are shown side-by-side without a
  diff.
- **Symbol level:** compared where the (normalized) symbol matches within a matched
  strategy (PnL metrics only).
- **Per-trade matching (deterministic):** within an aligned `(strategy, symbol)`, fills are
  paired across series by **same side**, **nearest timestamp within a tolerance window**
  (`PER_TRADE_MATCH_TOLERANCE`, default 5 min, configurable), greedy by time. Each matched
  pair yields a diff row: price slippage (abs + %, signed from the baseline's perspective),
  timing (`Δ seconds`), qty diff, fee diff. **Unmatched** fills on either side are listed
  explicitly (never silently dropped). This replaces day-level "date" matching — alignment
  is at fill-timestamp granularity.
- **Stateless:** `POST /v1/comparisons` returns the full result; nothing is persisted and
  there is no comparison history.

## 8. API

### Auth (public / JWT)
```
POST /v1/auth/register       {email, password}        → 201 {user}  (status=pending)
POST /v1/auth/login          {email, password}        → {access_token, refresh_token}
                                                          (403 if pending/rejected)
POST /v1/auth/refresh        {refresh_token}          → {access_token}
GET  /v1/auth/me             (JWT)                     → {user}
```

### API key management (JWT only)
```
POST   /v1/api-keys          (JWT) {name}   → 201 {id, name, key}   # full key shown ONCE
GET    /v1/api-keys          (JWT)          → [{id, name, prefix, last_used_at, created_at}]
DELETE /v1/api-keys/{id}     (JWT)          → 204                    # revoke
```

### Admin (JWT, admin role only)
```
GET   /v1/admin/users                  → [{id, email, status, role, created_at}]
POST  /v1/admin/users/{id}/approve     → 204
POST  /v1/admin/users/{id}/reject      → 204
```

### Ingestion (API key; also accepts JWT for frontend edits)

The posting model is **incremental append**: create a series once, then append fill
batches and fund movements over time.

```
POST /v1/series                        (API key)
  body: { name, tag, notes?, base_currency, session_tz,
          strategies?: [{name}],
          instruments?: [{symbol, asset_class, currency, multiplier, tick_size?, lot_size?}],
          fund_movements?: [{ts, currency, from_bucket, to_bucket,
                             from_strategy?, to_strategy?, amount}] }
  → 201 { series_id }

POST /v1/series/{id}/instruments       (API key)   # declare/correct instrument specs
  body: [ {symbol, asset_class, currency, multiplier, tick_size?, lot_size?}, ... ]
  → 201 { upserted: n }

POST /v1/series/{id}/fx-rates          (API key)   # rates: instrument ccy → base ccy
  body: [ {ccy_from, ccy_to, ts, rate}, ... ]
  → 201 { ingested: n }

POST /v1/series/{id}/benchmark         (API key)   # optional benchmark return series
  body: { name, returns: [ {ts, return_pct}, ... ] }
  → 201 { ingested: n }

POST /v1/series/{id}/fills:batch       (API key)   # batch append method
  body: { fills: [ { client_fill_id, strategy, symbol, side, qty, price, ts,
                     commission?, exchange_fee?, regulatory_fee?, financing_fee?,
                     position_effect?, signal_id? }, ... ] }   # ≤ 10,000 per request
  → 200 { batch_id, inserted: n, updated: n, rejected: n,
          errors: [ { client_fill_id, row, reason }, ... ] }
  → 413 if batch exceeds 10,000 fills

POST /v1/series/{id}/fund-movements    (API key)
  body: [ { ts, currency, from_bucket, to_bucket, from_strategy?, to_strategy?, amount }, ... ]
  → 201 { ingested: n }

POST /v1/series/{id}/fills:void        (API key)   # soft-delete erroneous fills
  body: { client_fill_ids: [...] }
  → 200 { voided: n }
```

**Ingestion rules:**
- **Timestamps:** all `ts` are ISO-8601 **UTC**; naive/non-UTC are rejected. Trade date is
  derived in the series `session_tz` (§4).
- **Idempotency / dedup:** every fill carries a caller-supplied `client_fill_id` (unique
  per series). The server **upserts** on it — re-sending an id is a no-op; the same id
  with changed fields updates in place. Retries and re-runs are safe.
- **Auto-create strategies & instruments:** a fill naming an unknown strategy creates it;
  an unknown symbol auto-creates an `Instrument` (`equity, multiplier=1,
  currency=base_currency, inferred=true`) for later correction.
- **Validation:** `qty > 0`; `price` may be negative (spreads/some futures) but is
  validated per asset class; fee components default `0` and may be negative (rebates);
  symbols and strategy names are **normalized** (uppercase+trim for symbols, lower+trim
  `name_key` for strategies); `ts` not in the far future; FundMovement requires
  `from_bucket != to_bucket`, `amount > 0`, and a strategy id when a bucket is `STRATEGY`.
- **Partial success:** a fill batch with some invalid rows commits the valid rows and
  returns a per-row report (`inserted` / `updated` / `rejected` + reasons). Valid rows
  for one batch commit in a single transaction, and the call is recorded as an
  `IngestionBatch` (audit).
- **Size cap:** 10,000 fills per `:batch` request; larger loads are chunked by the
  caller (`413` if exceeded).
- **Void, not delete:** `:void` soft-deletes by setting `voided_at`; voided rows are
  excluded from all computation but retained for audit.
- `bucket` values are `EXTERNAL`, `FREE_CASH`, or `STRATEGY` (with `from_strategy` /
  `to_strategy` naming the strategy when the bucket is `STRATEGY`).

### Read / dashboard (JWT)
```
GET /series                                          → [{id, name, tag, base_currency, created_at, counts}]
GET /series/{id}                                     → detail + strategies + instruments (incl. inferred) + discovered symbols
GET /series/{id}/metrics
      ?level=account|strategy|symbol&strategy=&symbol=
      &date_from=&date_to=&trade_view=lot|position&active_days_only=false
                                                     → metrics block (see envelope below)
```

All metric/comparison responses use a **self-describing envelope** (per the §2 portable-data
contract):
```jsonc
{
  "meta": { "level": "account", "base_currency": "USD", "session_tz": "America/New_York",
            "date_range": {"from": "...", "to": "..."}, "trade_view": "lot",
            "capital_base": "100000.00", "sample": {"round_trips": 142, "active_days": 88},
            "flags": {"realized_only": true, "low_sample": false, "sharpe_suppressed": false,
                      "fx_missing": false, "open_positions_exist": true} },
  "metrics": { "net_pnl": "...", "gross_pnl": "...", "total_fees": "...",
               "fees_on_open_positions": "...", "twr": "...", "cagr": "...",
               "volatility": "...", "sharpe": "...", "sortino": "...", "calmar": "...",
               "max_drawdown": "...", "win_rate": "...", "profit_factor": "...",
               "payoff_ratio": "...", "expectancy": "...", "max_consec_wins": 0,
               "max_consec_losses": 0, "largest_win": "...", "largest_loss": "...",
               "avg_holding_secs": 0, "trade_count": 0,
               "alpha": null, "beta": null, "information_ratio": null,
               "units": { "net_pnl": "USD", "twr": "ratio", "volatility": "annualized_ratio",
                          "avg_holding_secs": "seconds", "...": "..." } },
  "equity_curve":    [ { "ts": "...", "realized_pnl": "...", "indexed_return": "..." } ],
  "drawdown_series": [ { "ts": "...", "drawdown": "...", "drawdown_pct": "..." } ]
}
```
- Numeric values serialized as **strings** (Decimal) to avoid float drift; `units` map names
  the unit of each field. Symbol level omits return-based fields (null).

### Comparison (JWT, stateless)
```
POST /v1/comparisons
  body: { series_ids:[...], baseline_series_id?, date_from?, date_to?,
          trade_view?: "lot"|"position",
          per_trade_page?: int, per_trade_page_size?: int }
  → full results (see below)
```

### Comparison response shape
```jsonc
{
  "meta": { "base_currency": "USD", "baseline_series_id": 1,
            "date_range": {"from": "...", "to": "..."},
            "currency_mismatch_series": [] },
  "account": { "series": [ {series_id, meta:{...}, metrics:{...}} ] },
  "strategy": {
    "<name_key>": { "matched": true, "series": [ {series_id, metrics:{...}} ] }
  },
  "symbol": {
    "<name_key>/<symbol>": { "series": [ {series_id, pnl_metrics:{...}} ] }
  },
  "per_trade": {
    "page": 1, "page_size": 500, "total": 1234,
    "rows": [
      { "ts": "...", "symbol": "...", "side": "buy",
        "values": { "<series_a>": {price, qty, total_fee, ts}, "<series_b>": {...} },
        "diff":   { "price_slippage": "0.0", "price_slippage_pct": "0.0",
                    "timing_sec": 0, "qty_diff": "0", "fee_diff": "0.0" } }
    ],
    "unmatched": { "<series_id>": [ {client_fill_id, symbol, side, ts}, ... ] }
  }
}
```
- `per_trade` is **paginated** (bounded response size); `unmatched` fills are surfaced, not
  dropped.

## 9. Backend Layout (logic in service layer)

```
app/
  main.py              # FastAPI app, startup (admin seed), router registration
  db.py                # engine, session, base
  core/
    config.py          # settings from env (DB URL, JWT secret, admin creds, RISK_FREE_RATE,
                       #   ANNUALIZATION_DAYS, SHARPE_* thresholds, PER_TRADE_MATCH_TOLERANCE)
    security.py        # password hashing, JWT encode/decode, API-key generate/verify
    deps.py            # get_current_user (JWT), get_api_user (X-API-Key), require_admin
  models/              # SQLAlchemy ORM: user, api_key, series, account, strategy, instrument,
                       #   fx_rate, benchmark_return, fund_movement, fill, ingestion_batch
  schemas/             # Pydantic request/response models (self-describing envelopes)
  routers/             # thin HTTP endpoints: auth, api_keys, admin, series,
                       #   ingestion, instruments, fx, benchmark, metrics, comparisons
  services/            # ALL business logic:
    capital.py         #   time-varying capital base from fund movements (double-entry, base ccy)
    fx.py              #   currency conversion via as-of FxRate lookup
    pairing.py         #   FIFO round-trip construction (multiplier, tiebreak, fee split, lot/position)
    metrics.py         #   equity/indexed curve, TWR, Sharpe/Sortino/Calmar/CAGR/vol, drawdown, trade stats
    benchmark.py       #   alpha/beta/information ratio vs uploaded benchmark
    ingestion.py       #   batch fill upsert (client_fill_id), validation, void, audit batch
    comparison.py      #   multi-series alignment + deterministic per-trade matcher + pagination
  alembic/             # migrations
tests/
  unit/                # services tested with fixtures (no HTTP)
  api/                 # FastAPI TestClient against a test Postgres
```

## 10. Frontend

- **Auth pages:** Login, Register (with "awaiting approval" state).
- **API Keys settings:** create key (copy-once modal), list keys, revoke.
- **Admin page** (admin only): list pending users, approve / reject.
- **Series manager:** list/create series (base currency, session tz), view ingestion
  status & counts, review/correct inferred instruments.
- **Dashboard:** pick a series + level (account/strategy/symbol) + date range + trade view
  (lot/position) → metric cards + realized equity curve + drawdown charts (all backend-
  computed).
- **Comparison view:** pick 2+ series + baseline + date range → side-by-side metric cards,
  overlaid equity curves, and a paginated per-trade diff table (+ unmatched fills).

## 11. Testing Strategy

- **Unit tests** on `app/services/` (pairing, capital, fx, metrics, benchmark, ingestion,
  comparison) using known fixtures — pure functions, no HTTP. These cover financial
  correctness: FIFO long/short/partial **with multiplier**, same-ts tiebreak, fee pro-rata
  split + open-leg fee reconciliation, double-entry capital base (external-only, inter-
  strategy net-zero), FX conversion + missing-rate flagging, TWR vs cashflows,
  Sharpe/Sortino conventions (rf, annualization, zero-day, low-sample suppression), Calmar/
  CAGR/expectancy/consec-loss, both lot & position trade views, deterministic per-trade
  matcher + unmatched surfacing, and ingestion idempotency/validation/void.
- **API tests** via FastAPI `TestClient` against a test PostgreSQL database, covering
  auth flows (register → pending → approve → login), API-key auth, batch ingestion
  (dedup, partial success, size cap, void, audit), instrument/fx/benchmark posting,
  metrics (level + date range + trade view + isolation + envelope shape), and comparison
  end-to-end (currency guard, baseline, pagination).

## 12. Out of Scope (YAGNI)

- Real-time / streaming dashboards.
- Marking open positions to market (no price-data ingestion) — equity/drawdown are
  realized-only by design.
- Symbol-level capital allocation and return%.
- Persisted comparison history.
- Shared workspaces / team data visibility.
- Broker API integrations and file upload (programmatic API only).
- **Compounded capital base** (returns use external-invested capital only).
- **Corporate actions** (splits/dividends/symbol changes) — symbol is opaque; documented
  limitation, FIFO across a split would mis-pair (acceptable for crypto/futures-first use).
- **Configurable lot method** (LIFO/average/specific-lot) — FIFO only.
- **MAE/MFE and exposure/turnover** — require mark-to-market.
- **Raw bulk data export** beyond the per-trade diff CSV.
