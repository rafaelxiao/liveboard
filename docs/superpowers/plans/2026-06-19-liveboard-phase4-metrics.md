# LiveBoard Phase 4 — Metrics Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `services/metrics.py` + `services/benchmark.py` + the `GET /series/{id}/metrics` router so LiveBoard returns the full self-describing multi-level metrics envelope (realized equity + indexed curve, drawdown, TWR, Sharpe/Sortino/volatility/CAGR/Calmar, per-lot & per-position trade stats, symbol-level PnL+contribution, benchmark alpha/beta/IR, flags + units), all computed on the backend.

**Architecture:** `metrics.py` is a pure-ish orchestration service over a SQLAlchemy `Session` + typed args. It consumes Phase 3 services (`pairing.pair_fills` / `fees_on_open_positions` / `to_positions`, `capital.account_base` / `strategy_base` / `base_series`, `fx.to_base`) and assembles a `MetricsEnvelope` Pydantic model that Phase 5 (comparison) and the frontend consume unchanged. Routers stay thin: parse query → call `compute_metrics(...)` → serialize. All money is `Decimal`, serialized as strings; risk math (Sharpe/Sortino/vol) uses `float` internally with documented tolerance.

**Tech Stack:** Python ≥3.12, FastAPI, SQLAlchemy 2.x (`Mapped[]`), Pydantic v2, `decimal.Decimal`, `zoneinfo`, pytest + pytest-cov + httpx, uv.

## Global Constraints

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates/ratios `NUMERIC(28,12)`; **JSON numbers serialized as strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (aware datetimes; reject naive/non-UTC); **trade date derived in series `session_tz`** (IANA, via `zoneinfo`), not UTC.
- **No financial computation in the frontend.** If a number is shown, the backend produced it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest` green before the phase gate. Coverage gate ≥90% on `app/services`.
- Per-user data isolation everywhere; **voided rows (`voided_at` not null) excluded from all computation**.
- Risk conventions pinned (config-driven, defaults): `RISK_FREE_RATE=0` (annual), `ANNUALIZATION_DAYS=365` (√365 / ×365), Sortino target `0`, zero-return-day fill, `SHARPE_MIN_SAMPLE_TRADES=20`, `SHARPE_MIN_ACTIVE_DAYS=30`, `SHARPE_SUPPRESS_BELOW=5`.
- Symbol level has **no capital base** → return-based fields (`twr`, `cagr`, `volatility`, `sharpe`, `sortino`, `calmar`, `max_drawdown`, `alpha`, `beta`, `information_ratio`, `indexed_return`) are `null`; symbol adds `contribution_pct`.
- Date-range filter is **inclusive-start / inclusive-end** on the round-trip **close** trade-date in `session_tz`.

---

## Assumed prior state (Phases 0–3 complete)

This plan **consumes** the following exact signatures and does not reimplement them. Read them before starting.

```python
# services/pairing.py
@dataclass
class RoundTrip:
    strategy_id: int; symbol: str
    open_ts: datetime; close_ts: datetime           # aware UTC
    qty: Decimal; direction: str                    # "long" | "short"
    multiplier: Decimal
    currency: str                                   # instrument ccy (pre-conversion)
    entry_price: Decimal; exit_price: Decimal
    gross_pnl: Decimal                              # instrument ccy
    entry_fees: Decimal; exit_fees: Decimal; total_fees: Decimal   # instrument ccy
    net_pnl: Decimal                                # gross_pnl - total_fees, instrument ccy
    fx_missing: bool

def pair_fills(fills: list[Fill], instruments: dict[str, Instrument]) -> list[RoundTrip]
def fees_on_open_positions(fills, instruments) -> Decimal
def to_positions(round_trips: list[RoundTrip]) -> list[RoundTrip]   # group flat-to-flat

# services/capital.py  (all return base-ccy Decimals)
def account_base(session, series_id, at: datetime | None) -> Decimal
def strategy_base(session, series_id, strategy_id, at: datetime | None) -> Decimal
def free_cash(session, series_id, at: datetime | None) -> Decimal
def base_series(session, series_id, level: str, ref_id, days: list[date]) -> dict[date, Decimal]

# services/fx.py
def as_of_rate(session, series_id, ccy_from, ccy_to, ts) -> Decimal | None
def to_base(session, series_id, amount: Decimal, ccy: str, ts) -> Decimal | None
```

> **NOTE on `RoundTrip` PnL currency:** `pair_fills(fills, instruments)` is a pure, session-less function. It cannot look up FX rates. RoundTrip `gross_pnl` / `net_pnl` / `*_fees` are in **instrument currency** (the instrument's `currency` field). Currency conversion to base is the **metrics layer's** responsibility: `metrics.py` calls `fx.to_base(session, series_id, amount, rt.currency, rt.close_ts)` for each round-trip after loading. When `to_base` returns `None`, mark that round-trip `fx_missing=True` and set the response-level `flags.fx_missing=True` (exclude from base-ccy aggregates per the design spec — do not assume 1.0). Capital functions (`account_base`, `strategy_base`, `base_series`) already return base-ccy values and need no conversion.

Also assumed present:
- `app/core/config.py` `Settings` exposing `RISK_FREE_RATE`, `ANNUALIZATION_DAYS`, `SHARPE_MIN_SAMPLE_TRADES`, `SHARPE_MIN_ACTIVE_DAYS`, `SHARPE_SUPPRESS_BELOW`, importable as `from app.core.config import settings`.
- Models: `Series` (`base_currency`, `session_tz`), `Strategy` (`id`, `name`, `name_key`), `Instrument` (`symbol` keyed), `Fill` (`voided_at`, `strategy_id`, `symbol`, `ts`, `client_fill_id`), `FundMovement`, `BenchmarkReturn` (`ts`, `return_pct`).
- `app/core/deps.py` `get_current_user` (JWT) and `get_db`.
- `tests/conftest.py` provides `db_session`, `client` (TestClient), and factory helpers `make_user`, `make_series`, `auth_headers(user)`. Where a Phase-4 unit test needs a `Fill`/`Instrument`/`Strategy`/`FundMovement`, build it with the existing factories or construct the ORM object directly and `session.add` it.

---

## File Structure

- **Create `app/services/metrics.py`** — the metrics engine. Pure helper functions (date filter, equity curve, drawdown, daily returns, Sharpe/Sortino/vol/CAGR/Calmar, TWR, trade stats, contribution, flags, units) + the `compute_metrics(...)` orchestrator returning `MetricsEnvelope`. One responsibility: turn round-trips + capital base into the envelope.
- **Create `app/services/benchmark.py`** — `benchmark_metrics(return_series, benchmark) -> dict` (alpha/beta/information_ratio); pure stats, no DB. `compute_metrics` loads the `BenchmarkReturn` rows and calls it.
- **Create `app/schemas/metrics.py`** — Pydantic v2 DTOs: `MetricsQuery`, `MetaBlock`, `FlagsBlock`, `SampleBlock`, `DateRange`, `MetricsBlock`, `EquityPoint`, `DrawdownPoint`, `MetricsEnvelope`. All numeric metric fields typed `str | None` (Decimal serialized as string); counts are `int`.
- **Create `app/routers/metrics.py`** — `GET /series/{id}/metrics` thin router: ownership check (404 if not owner), parse query, call `compute_metrics`, return envelope.
- **Modify `app/routers/__init__.py`** — register the metrics router in the aggregator.
- **Create `tests/unit/test_metrics.py`** — unit tests for every helper + orchestrator (fixtures, no HTTP).
- **Create `tests/unit/test_benchmark.py`** — alpha/beta/IR + null-when-absent.
- **Create `tests/api/test_metrics_api.py`** — TestClient: level/date/trade_view/active_days, isolation, envelope shape.

Suggested internal layout of `metrics.py` (small focused functions, composed by `compute_metrics`):

```python
# helpers (pure, unit-tested individually)
def trade_date(ts: datetime, session_tz: str) -> date
def filter_round_trips(rts, session_tz, date_from, date_to) -> list[RoundTrip]
def realized_equity_curve(rts) -> list[tuple[datetime, Decimal]]      # (close_ts, cum_net_pnl)
def indexed_curve(curve, capital_base) -> list[Decimal | None]        # cum_pnl / base
def drawdown_series(curve) -> list[tuple[datetime, Decimal, Decimal]] # (ts, dd, dd_pct)
def max_drawdown(dd_series) -> Decimal
def daily_returns(rts, base_by_day, session_tz, all_days) -> dict[date, float]
def sharpe(daily_rets: dict[date, float]) -> float | None
def sortino(daily_rets: dict[date, float]) -> float | None
def volatility(daily_rets: dict[date, float]) -> float | None
def cagr(curve, capital_base, n_days) -> float | None
def calmar(cagr_val, max_dd, capital_base) -> float | None
def twr(session, series_id, level, ref_id, rts, session_tz) -> Decimal | None
def trade_stats(rts) -> dict                                          # net-based, gross variants too
def symbol_contribution(symbol_net, strategy_net) -> Decimal | None
def build_flags(...) -> FlagsBlock
def units_map(level) -> dict[str, str]
def compute_metrics(session, series_id, level, *, strategy=None, symbol=None,
                    date_from=None, date_to=None, trade_view="lot",
                    active_days_only=False) -> MetricsEnvelope
```

---

## Tasks

### Task 1: Date-range filter + trade-date-in-session_tz helper

**Files:**
- Create: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: `RoundTrip` (from `services/pairing.py`) — uses `.close_ts` (aware UTC datetime).
- Produces:
  - `trade_date(ts: datetime, session_tz: str) -> date` — calendar date of `ts` in `session_tz`.
  - `filter_round_trips(rts: list[RoundTrip], session_tz: str, date_from: date | None, date_to: date | None) -> list[RoundTrip]` — keeps round-trips whose **close** trade-date ∈ [date_from, date_to] inclusive/inclusive; `None` bounds are open.

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_metrics.py
from datetime import datetime, date, timezone
from decimal import Decimal
from dataclasses import dataclass

# Local lightweight stand-in matching pairing.RoundTrip's fields the metrics layer reads.
# In real tests import the actual dataclass: from app.services.pairing import RoundTrip
from app.services.pairing import RoundTrip
from app.services import metrics


def _rt(close_iso, net="0", *, strategy_id=1, symbol="AAPL", gross=None,
        open_iso=None, qty="1", direction="long", entry="0", exit="0",
        entry_fees="0", exit_fees="0", fx_missing=False, currency="USD"):
    """Build a RoundTrip for unit tests.  PnL/fees are in *instrument* currency
    (defaults to ``"USD"`` — matching the series base_currency in existing tests,
    so ``to_base`` is the identity and no explicit FX seeding is needed)."""
    net = Decimal(net)
    gross = Decimal(gross) if gross is not None else net
    total_fees = gross - net
    return RoundTrip(
        strategy_id=strategy_id, symbol=symbol,
        open_ts=datetime.fromisoformat(open_iso or close_iso),
        close_ts=datetime.fromisoformat(close_iso),
        qty=Decimal(qty), direction=direction, multiplier=Decimal("1"),
        currency=currency, entry_price=Decimal(entry), exit_price=Decimal(exit),
        gross_pnl=gross, entry_fees=Decimal(entry_fees), exit_fees=Decimal(exit_fees),
        total_fees=total_fees, net_pnl=net, fx_missing=fx_missing,
    )


def test_trade_date_uses_session_tz_not_utc():
    # 2026-06-19T01:31:00Z is 2026-06-18 21:31 in America/New_York -> local trade day 06-18
    ts = datetime(2026, 6, 19, 1, 31, tzinfo=timezone.utc)
    assert metrics.trade_date(ts, "America/New_York") == date(2026, 6, 18)
    assert metrics.trade_date(ts, "UTC") == date(2026, 6, 19)


def test_filter_round_trips_inclusive_both_ends():
    rts = [
        _rt("2026-06-17T15:00:00+00:00", "10"),
        _rt("2026-06-18T15:00:00+00:00", "20"),
        _rt("2026-06-19T15:00:00+00:00", "30"),
        _rt("2026-06-20T15:00:00+00:00", "40"),
    ]
    kept = metrics.filter_round_trips(rts, "UTC", date(2026, 6, 18), date(2026, 6, 19))
    assert [rt.net_pnl for rt in kept] == [Decimal("20"), Decimal("30")]


def test_filter_round_trips_open_bounds():
    rts = [_rt("2026-06-18T15:00:00+00:00", "20"), _rt("2026-06-20T15:00:00+00:00", "40")]
    assert len(metrics.filter_round_trips(rts, "UTC", None, None)) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py::test_trade_date_uses_session_tz_not_utc tests/unit/test_metrics.py::test_filter_round_trips_inclusive_both_ends -v`
Expected: FAIL with `AttributeError: module 'app.services.metrics' has no attribute 'trade_date'`

- [ ] **Step 3: Write minimal implementation**

```python
# app/services/metrics.py
from __future__ import annotations
from datetime import datetime, date
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.services.pairing import RoundTrip


def trade_date(ts: datetime, session_tz: str) -> date:
    """Calendar date of an aware UTC ts in the series session_tz (IANA)."""
    return ts.astimezone(ZoneInfo(session_tz)).date()


def filter_round_trips(
    rts: list[RoundTrip],
    session_tz: str,
    date_from: date | None,
    date_to: date | None,
) -> list[RoundTrip]:
    """Keep round-trips whose CLOSE trade-date is within [date_from, date_to] inclusive."""
    out = []
    for rt in rts:
        d = trade_date(rt.close_ts, session_tz)
        if date_from is not None and d < date_from:
            continue
        if date_to is not None and d > date_to:
            continue
        out.append(rt)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k "trade_date or filter_round_trips" -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): trade-date in session_tz + inclusive date-range filter"
```

---

### Task 2: Realized equity curve (stepped, cumulative net PnL)

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: `RoundTrip.close_ts`, `RoundTrip.net_pnl`.
- Produces: `realized_equity_curve(rts: list[RoundTrip]) -> list[tuple[datetime, Decimal]]` — round-trips sorted by `(close_ts, open_ts)`, one point per close, value = cumulative sum of `net_pnl`. Empty input → `[]`.

- [ ] **Step 1: Write the failing test**

```python
def test_realized_equity_curve_is_stepped_cumulative_net():
    rts = [
        _rt("2026-06-18T15:00:00+00:00", "100"),
        _rt("2026-06-19T15:00:00+00:00", "-40"),
        _rt("2026-06-20T15:00:00+00:00", "25"),
    ]
    curve = metrics.realized_equity_curve(rts)
    assert [v for _, v in curve] == [Decimal("100"), Decimal("60"), Decimal("85")]
    assert [ts.isoformat() for ts, _ in curve] == [
        "2026-06-18T15:00:00+00:00",
        "2026-06-19T15:00:00+00:00",
        "2026-06-20T15:00:00+00:00",
    ]


def test_realized_equity_curve_sorts_by_close_ts():
    rts = [_rt("2026-06-20T15:00:00+00:00", "25"), _rt("2026-06-18T15:00:00+00:00", "100")]
    curve = metrics.realized_equity_curve(rts)
    assert [v for _, v in curve] == [Decimal("100"), Decimal("125")]


def test_realized_equity_curve_empty():
    assert metrics.realized_equity_curve([]) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k realized_equity_curve -v`
Expected: FAIL with `AttributeError: ... 'realized_equity_curve'`

- [ ] **Step 3: Write minimal implementation**

```python
def realized_equity_curve(rts: list[RoundTrip]) -> list[tuple[datetime, Decimal]]:
    """Stepped cumulative NET realized PnL, one point per round-trip close."""
    ordered = sorted(rts, key=lambda rt: (rt.close_ts, rt.open_ts))
    curve: list[tuple[datetime, Decimal]] = []
    running = Decimal("0")
    for rt in ordered:
        running += rt.net_pnl
        curve.append((rt.close_ts, running))
    return curve
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k realized_equity_curve -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): stepped realized equity curve"
```

---

### Task 3: Indexed / normalized curve (PnL ÷ capital base)

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: equity curve from Task 2 + a single `capital_base: Decimal` (from `capital.account_base` / `strategy_base`; for the headline indexed curve the implementer uses the base as-of the last close).
- Produces: `indexed_curve(curve: list[tuple[datetime, Decimal]], capital_base: Decimal | None) -> list[Decimal | None]` — each point = `cum_pnl / capital_base` as a `Decimal` (ratio), or `None` for every point when `capital_base` is `None` or `0` (symbol level / undefined base). Quantize to 12 dp.

- [ ] **Step 1: Write the failing test**

```python
def test_indexed_curve_divides_by_capital_base():
    curve = [
        (datetime.fromisoformat("2026-06-18T15:00:00+00:00"), Decimal("100")),
        (datetime.fromisoformat("2026-06-19T15:00:00+00:00"), Decimal("250")),
    ]
    idx = metrics.indexed_curve(curve, Decimal("1000"))
    assert idx == [Decimal("0.100000000000"), Decimal("0.250000000000")]


def test_indexed_curve_none_base_yields_nulls():
    curve = [(datetime.fromisoformat("2026-06-18T15:00:00+00:00"), Decimal("100"))]
    assert metrics.indexed_curve(curve, None) == [None]
    assert metrics.indexed_curve(curve, Decimal("0")) == [None]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k indexed_curve -v`
Expected: FAIL with `AttributeError: ... 'indexed_curve'`

- [ ] **Step 3: Write minimal implementation**

```python
_RATIO_Q = Decimal("0.000000000001")  # 12 dp


def indexed_curve(
    curve: list[tuple[datetime, Decimal]], capital_base: Decimal | None
) -> list[Decimal | None]:
    """Normalize the cumulative-PnL curve by the capital base (PnL / base)."""
    if capital_base is None or capital_base == 0:
        return [None for _ in curve]
    return [(v / capital_base).quantize(_RATIO_Q) for _, v in curve]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k indexed_curve -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): indexed/normalized equity curve via capital base"
```

---

### Task 4: Drawdown series + max drawdown

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: equity curve from Task 2 (`list[tuple[datetime, Decimal]]`).
- Produces:
  - `drawdown_series(curve) -> list[tuple[datetime, Decimal, Decimal]]` — `(ts, drawdown, drawdown_pct)` where `drawdown = cum_pnl - running_peak` (≤ 0), `drawdown_pct = drawdown / running_peak` (0 when peak ≤ 0, quantized 12 dp).
  - `max_drawdown(dd_series) -> Decimal` — most-negative `drawdown` value (returns `Decimal("0")` if empty or never negative).

- [ ] **Step 1: Write the failing test**

```python
def test_drawdown_series_peak_to_trough():
    curve = [
        (datetime.fromisoformat("2026-06-18T15:00:00+00:00"), Decimal("100")),
        (datetime.fromisoformat("2026-06-19T15:00:00+00:00"), Decimal("60")),   # peak 100 -> dd -40
        (datetime.fromisoformat("2026-06-20T15:00:00+00:00"), Decimal("150")),  # new peak -> dd 0
        (datetime.fromisoformat("2026-06-21T15:00:00+00:00"), Decimal("120")),  # peak 150 -> dd -30
    ]
    dd = metrics.drawdown_series(curve)
    assert [d for _, d, _ in dd] == [Decimal("0"), Decimal("-40"), Decimal("0"), Decimal("-30")]
    # dd_pct at the -40 trough = -40/100 = -0.4
    assert dd[1][2] == Decimal("-0.400000000000")
    assert metrics.max_drawdown(dd) == Decimal("-40")


def test_max_drawdown_empty_is_zero():
    assert metrics.max_drawdown([]) == Decimal("0")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k "drawdown" -v`
Expected: FAIL with `AttributeError: ... 'drawdown_series'`

- [ ] **Step 3: Write minimal implementation**

```python
def drawdown_series(
    curve: list[tuple[datetime, Decimal]]
) -> list[tuple[datetime, Decimal, Decimal]]:
    """Peak-to-trough drawdown on the realized cumulative-PnL curve."""
    out: list[tuple[datetime, Decimal, Decimal]] = []
    peak = Decimal("0")
    for ts, v in curve:
        if v > peak:
            peak = v
        dd = v - peak
        dd_pct = (dd / peak).quantize(_RATIO_Q) if peak > 0 else Decimal("0")
        out.append((ts, dd, dd_pct))
    return out


def max_drawdown(dd_series: list[tuple[datetime, Decimal, Decimal]]) -> Decimal:
    if not dd_series:
        return Decimal("0")
    return min((dd for _, dd, _ in dd_series), default=Decimal("0"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k "drawdown" -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): drawdown series + max drawdown"
```

---

### Task 5: Daily return series (calendar resample + zero-return fill)

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: `RoundTrip.close_ts`/`net_pnl`; a `base_by_day: dict[date, Decimal]` denominator (from `capital.base_series`); `session_tz`.
- Produces: `daily_returns(rts, base_by_day, session_tz, *, active_days_only=False) -> dict[date, float]`.
  - **Calendar resample:** sum `net_pnl` of all closes per **trade-date** (in `session_tz`).
  - **Return per day** = `float(daily_net_pnl / base_by_day[day])`; if base for that day is `0`/missing → treat return as `0.0`.
  - **Zero-return fill:** when `active_days_only=False`, every calendar day from the first to the last active day (inclusive) with no close is added as `0.0`. When `active_days_only=True`, only days with at least one close are returned.

> **Why explicit:** the zero-day fill is what makes ×365/√365 annualization correct (it damps vol and can inflate Sharpe — documented). The `active_days_only` variant skips the fill so the implementer must branch on the flag, not guess.

- [ ] **Step 1: Write the failing test**

```python
def test_daily_returns_resample_and_zero_fill():
    # closes on 06-18 (+100) and 06-20 (-50); 06-19 has no close -> 0% return.
    rts = [
        _rt("2026-06-18T15:00:00+00:00", "100"),
        _rt("2026-06-20T15:00:00+00:00", "-50"),
    ]
    base = {date(2026, 6, 18): Decimal("1000"),
            date(2026, 6, 19): Decimal("1000"),
            date(2026, 6, 20): Decimal("1000")}
    rets = metrics.daily_returns(rts, base, "UTC")
    assert set(rets) == {date(2026, 6, 18), date(2026, 6, 19), date(2026, 6, 20)}
    assert rets[date(2026, 6, 18)] == 0.10
    assert rets[date(2026, 6, 19)] == 0.0          # zero-return fill
    assert rets[date(2026, 6, 20)] == -0.05


def test_daily_returns_active_days_only_skips_zero_fill():
    rts = [
        _rt("2026-06-18T15:00:00+00:00", "100"),
        _rt("2026-06-20T15:00:00+00:00", "-50"),
    ]
    base = {date(2026, 6, 18): Decimal("1000"), date(2026, 6, 20): Decimal("1000")}
    rets = metrics.daily_returns(rts, base, "UTC", active_days_only=True)
    assert set(rets) == {date(2026, 6, 18), date(2026, 6, 20)}


def test_daily_returns_zero_base_day_is_zero_return():
    rts = [_rt("2026-06-18T15:00:00+00:00", "100")]
    base = {date(2026, 6, 18): Decimal("0")}
    rets = metrics.daily_returns(rts, base, "UTC")
    assert rets[date(2026, 6, 18)] == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k daily_returns -v`
Expected: FAIL with `AttributeError: ... 'daily_returns'`

- [ ] **Step 3: Write minimal implementation**

```python
from datetime import timedelta


def daily_returns(
    rts: list[RoundTrip],
    base_by_day: dict[date, Decimal],
    session_tz: str,
    *,
    active_days_only: bool = False,
) -> dict[date, float]:
    """Realized PnL / time-varying base, resampled to calendar trade-days."""
    pnl_by_day: dict[date, Decimal] = {}
    for rt in rts:
        d = trade_date(rt.close_ts, session_tz)
        pnl_by_day[d] = pnl_by_day.get(d, Decimal("0")) + rt.net_pnl

    def day_return(d: date) -> float:
        base = base_by_day.get(d) or Decimal("0")
        pnl = pnl_by_day.get(d, Decimal("0"))
        if base == 0:
            return 0.0
        return float(pnl / base)

    if not pnl_by_day:
        return {}

    if active_days_only:
        return {d: day_return(d) for d in sorted(pnl_by_day)}

    start, end = min(pnl_by_day), max(pnl_by_day)
    out: dict[date, float] = {}
    d = start
    while d <= end:
        out[d] = day_return(d)  # zero-return fill for days with no close
        d += timedelta(days=1)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k daily_returns -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): daily return series with calendar resample + zero-day fill"
```

---

### Task 6: Sharpe ratio (rf + √365 + zero-day)

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: `daily_returns` dict from Task 5; `settings.RISK_FREE_RATE`, `settings.ANNUALIZATION_DAYS`.
- Produces: `sharpe(daily_rets: dict[date, float]) -> float | None`.

**Annualization math (pin exactly):**
- Daily risk-free = `RISK_FREE_RATE / ANNUALIZATION_DAYS`.
- Excess daily returns `e_i = r_i − rf_daily`.
- `mean_excess = mean(e_i)`, `std = sample stdev of e_i` (ddof=1).
- **Annualized Sharpe = `(mean_excess × ANNUALIZATION_DAYS) / (std × sqrt(ANNUALIZATION_DAYS))`** = `mean_excess / std × sqrt(ANNUALIZATION_DAYS)`.
- Return `None` if `< 2` data points or `std == 0`.

- [ ] **Step 1: Write the failing test**

```python
import math


def test_sharpe_rf_zero_annualized_365():
    # Construct returns with a known mean/std. rf=0 (default).
    # daily returns: +0.01 on active days, 0.0 on zero-days.
    rets = {}
    base = date(2026, 1, 1)
    # 5 active +1% days interleaved with 5 zero days => 10 days total
    vals = [0.01, 0.0, 0.01, 0.0, 0.01, 0.0, 0.01, 0.0, 0.01, 0.0]
    for i, v in enumerate(vals):
        rets[base + timedelta(days=i)] = v
    s = metrics.sharpe(rets)
    # mean = 0.005; sample std (ddof=1) of the 10 values:
    import statistics
    mean = statistics.fmean(vals)
    std = statistics.stdev(vals)
    expected = mean / std * math.sqrt(365)
    assert s is not None
    assert math.isclose(s, expected, rel_tol=1e-9)


def test_sharpe_none_when_zero_variance():
    rets = {date(2026, 1, 1): 0.0, date(2026, 1, 2): 0.0, date(2026, 1, 3): 0.0}
    assert metrics.sharpe(rets) is None


def test_sharpe_none_when_under_two_points():
    assert metrics.sharpe({date(2026, 1, 1): 0.01}) is None
    assert metrics.sharpe({}) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k sharpe -v`
Expected: FAIL with `AttributeError: ... 'sharpe'`

- [ ] **Step 3: Write minimal implementation**

```python
import math
import statistics
from app.core.config import settings


def _excess_returns(daily_rets: dict[date, float]) -> list[float]:
    ann = settings.ANNUALIZATION_DAYS
    rf_daily = float(settings.RISK_FREE_RATE) / ann
    return [r - rf_daily for r in daily_rets.values()]


def sharpe(daily_rets: dict[date, float]) -> float | None:
    if len(daily_rets) < 2:
        return None
    ann = settings.ANNUALIZATION_DAYS
    excess = _excess_returns(daily_rets)
    std = statistics.stdev(excess)  # ddof=1
    if std == 0:
        return None
    mean = statistics.fmean(excess)
    return mean / std * math.sqrt(ann)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k sharpe -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): annualized Sharpe (rf, sqrt(365), zero-day) "
```

---

### Task 7: Sortino ratio (downside deviation, target 0)

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: `daily_returns` dict; `settings.RISK_FREE_RATE`, `settings.ANNUALIZATION_DAYS`.
- Produces: `sortino(daily_rets) -> float | None`.

**Math (pin exactly):** target = `0`. Downside deviation uses excess returns below target:
- `downside_i = min(e_i − 0, 0)` (i.e. negative excess returns; non-negative → 0).
- `dd = sqrt( mean(downside_i²) )` over **all** days (population-style mean over n, not just negatives) — matches the daily-return-series convention.
- Annualized Sortino = `mean(e_i) / dd × sqrt(ANNUALIZATION_DAYS)`.
- Return `None` if `< 2` points or `dd == 0`.

- [ ] **Step 1: Write the failing test**

```python
def test_sortino_downside_only_target_zero():
    rets = {
        date(2026, 1, 1): 0.02,
        date(2026, 1, 2): -0.01,
        date(2026, 1, 3): 0.03,
        date(2026, 1, 4): -0.02,
    }
    s = metrics.sortino(rets)
    vals = [0.02, -0.01, 0.03, -0.02]
    mean = sum(vals) / len(vals)                 # rf=0 -> excess == raw
    downside_sq = [min(v, 0.0) ** 2 for v in vals]
    dd = math.sqrt(sum(downside_sq) / len(vals))
    expected = mean / dd * math.sqrt(365)
    assert s is not None
    assert math.isclose(s, expected, rel_tol=1e-9)


def test_sortino_none_when_no_downside():
    rets = {date(2026, 1, 1): 0.01, date(2026, 1, 2): 0.02}
    assert metrics.sortino(rets) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k sortino -v`
Expected: FAIL with `AttributeError: ... 'sortino'`

- [ ] **Step 3: Write minimal implementation**

```python
def sortino(daily_rets: dict[date, float]) -> float | None:
    if len(daily_rets) < 2:
        return None
    ann = settings.ANNUALIZATION_DAYS
    excess = _excess_returns(daily_rets)
    n = len(excess)
    downside_sq = sum(min(e, 0.0) ** 2 for e in excess) / n
    dd = math.sqrt(downside_sq)
    if dd == 0:
        return None
    mean = statistics.fmean(excess)
    return mean / dd * math.sqrt(ann)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k sortino -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): Sortino (downside deviation, target 0)"
```

---

### Task 8: Volatility + CAGR + Calmar

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Produces:
  - `volatility(daily_rets) -> float | None` — annualized stdev of daily returns: `stdev(returns, ddof=1) × sqrt(ANNUALIZATION_DAYS)`; `None` if `<2` points.
  - `cagr(curve, capital_base, n_days) -> float | None` — total return = `final_cum_pnl / capital_base`; `CAGR = (1 + total_return) ** (ANNUALIZATION_DAYS / n_days) − 1`. `None` when `capital_base` is `None`/`0`, `n_days <= 0`, or `(1+total_return) <= 0`.
  - `calmar(cagr_val, max_dd, capital_base) -> float | None` — `CAGR / |max_dd / capital_base|`. Uses max drawdown expressed as a **return fraction** (max_dd is a money value; divide by capital_base). `None` when `cagr_val is None`, `max_dd == 0`, or base `None`/`0`.

> **Calmar definition pinned:** Calmar = CAGR / |max-drawdown-as-fraction-of-capital-base|. Both numerator and denominator are returns, so the ratio is unitless.

- [ ] **Step 1: Write the failing test**

```python
def test_volatility_annualized():
    rets = {date(2026, 1, 1): 0.01, date(2026, 1, 2): -0.01,
            date(2026, 1, 3): 0.02, date(2026, 1, 4): -0.02}
    v = metrics.volatility(rets)
    expected = statistics.stdev(list(rets.values())) * math.sqrt(365)
    assert math.isclose(v, expected, rel_tol=1e-9)


def test_cagr_known_value():
    # capital 1000, final cum pnl 200 -> total return 0.2; over 365 days -> CAGR == 0.2
    curve = [(datetime.fromisoformat("2026-01-01T00:00:00+00:00"), Decimal("200"))]
    c = metrics.cagr(curve, Decimal("1000"), 365)
    assert math.isclose(c, 0.2, rel_tol=1e-9)


def test_cagr_half_year_annualizes_up():
    # total return 0.2 over ~182.5 days -> (1.2)**(365/182.5)-1 == 1.2**2 - 1 = 0.44
    curve = [(datetime.fromisoformat("2026-01-01T00:00:00+00:00"), Decimal("200"))]
    c = metrics.cagr(curve, Decimal("1000"), 182.5)
    assert math.isclose(c, 0.44, rel_tol=1e-9)


def test_cagr_none_without_base():
    curve = [(datetime.fromisoformat("2026-01-01T00:00:00+00:00"), Decimal("200"))]
    assert metrics.cagr(curve, None, 365) is None


def test_calmar_cagr_over_maxdd_fraction():
    # CAGR 0.2, max_dd -100 on base 1000 -> dd fraction 0.1 -> Calmar 2.0
    assert math.isclose(metrics.calmar(0.2, Decimal("-100"), Decimal("1000")), 2.0, rel_tol=1e-9)


def test_calmar_none_when_no_drawdown():
    assert metrics.calmar(0.2, Decimal("0"), Decimal("1000")) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k "volatility or cagr or calmar" -v`
Expected: FAIL with `AttributeError: ... 'volatility'`

- [ ] **Step 3: Write minimal implementation**

```python
def volatility(daily_rets: dict[date, float]) -> float | None:
    if len(daily_rets) < 2:
        return None
    return statistics.stdev(list(daily_rets.values())) * math.sqrt(settings.ANNUALIZATION_DAYS)


def cagr(
    curve: list[tuple[datetime, Decimal]],
    capital_base: Decimal | None,
    n_days: float,
) -> float | None:
    if not curve or capital_base is None or capital_base == 0 or n_days <= 0:
        return None
    total_return = float(curve[-1][1] / capital_base)
    growth = 1.0 + total_return
    if growth <= 0:
        return None
    return growth ** (settings.ANNUALIZATION_DAYS / n_days) - 1.0


def calmar(
    cagr_val: float | None, max_dd: Decimal, capital_base: Decimal | None
) -> float | None:
    if cagr_val is None or max_dd == 0 or capital_base is None or capital_base == 0:
        return None
    dd_fraction = abs(float(max_dd / capital_base))
    if dd_fraction == 0:
        return None
    return cagr_val / dd_fraction
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k "volatility or cagr or calmar" -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): volatility + CAGR + Calmar"
```

---

### Task 9: TWR (split at external cashflows, chained sub-periods)

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: filtered `round_trips`; an **external-cashflow schedule** `cashflows: list[tuple[datetime, Decimal]]` (each EXTERNAL FundMovement: signed amount added to/removed from account base, base ccy) and the **starting base** before the first round-trip. The orchestrator builds these from `capital` (Task 16); for unit-testing, `twr` takes a pure-data signature:
  - `twr_from_periods(starting_base: Decimal, events: list[tuple[datetime, str, Decimal]]) -> Decimal | None`
  - `events` is a time-ordered merge of trade closes (`("pnl", net_pnl)`) and external cashflows (`("flow", signed_amount)`).
- Produces: `twr_from_periods(...)` — chained sub-period return.

**Algorithm (pin exactly):**
- Walk events in time order, maintaining `base` (denominator capital).
- A sub-period **ends** immediately *before* each external cashflow. Sub-period return = `period_pnl / base_at_period_start`.
- TWR = `Π(1 + sub_period_return) − 1`.
- On a `flow` event: close the current sub-period, then adjust `base += flow` and start a new sub-period with the new base (PnL during a sub-period accumulates in the numerator only; deposits change the denominator for the *next* sub-period — this is what neutralizes deposit timing).
- Return `None` if `starting_base <= 0` and no positive base ever establishes.

> **Why this neutralizes timing (F7):** Two series with identical trades but different deposit schedules split into different sub-periods, yet each sub-period's *return* depends only on PnL relative to the capital actually present during that sub-period. Chaining the returns removes the effect of *when* money was added. The test below builds exactly this scenario.

- [ ] **Step 1: Write the failing test**

```python
def test_twr_neutralizes_cashflow_timing():
    # Same trades (+100 then +100), two different deposit schedules.
    # Schedule A: start 1000, deposit +1000 AFTER both trades.
    eventsA = [
        ("pnl", Decimal("100")),   # base 1000 -> sub-return 0.10
        ("pnl", Decimal("100")),   # base 1000 -> sub-return 0.10 (same sub-period, cumulative 200/1000)
        ("flow", Decimal("1000")), # deposit after trading
    ]
    # Schedule B: start 1000, deposit +1000 BETWEEN the two trades.
    eventsB = [
        ("pnl", Decimal("100")),   # base 1000 -> first sub-period pnl 100 / 1000 = 0.10
        ("flow", Decimal("1000")), # deposit -> base now 2000, close sub-period 1
        ("pnl", Decimal("100")),   # base 2000 -> second sub-period 100 / 2000 = 0.05
    ]
    twrA = metrics.twr_from_periods(Decimal("1000"), eventsA)
    twrB = metrics.twr_from_periods(Decimal("1000"), eventsB)
    # A: single sub-period (200/1000)=0.20 then a trailing deposit (no pnl after) -> (1.20)-1 = 0.20
    # B: (1+0.10)*(1+0.05)-1 = 0.155
    # The KEY acceptance is that simple return would differ wildly, but here we assert each
    # is computed by chaining; A and B differ ONLY because B actually earned the 2nd 100 on a
    # larger base. To prove timing-neutrality with IDENTICAL economics we use the mirror case:
    assert twrA == Decimal("0.200000000000")
    assert twrB == Decimal("0.155000000000")


def test_twr_identical_when_same_base_during_trades():
    # The canonical F7 case: trades happen, THEN deposits differ. Both schedules have the
    # deposit AFTER all trading, so TWR must be identical regardless of deposit size/timing.
    eventsA = [("pnl", Decimal("100")), ("pnl", Decimal("100")), ("flow", Decimal("1000"))]
    eventsB = [("pnl", Decimal("100")), ("pnl", Decimal("100")), ("flow", Decimal("5000"))]
    assert metrics.twr_from_periods(Decimal("1000"), eventsA) == \
           metrics.twr_from_periods(Decimal("1000"), eventsB)


def test_twr_none_when_no_capital():
    assert metrics.twr_from_periods(Decimal("0"), [("pnl", Decimal("100"))]) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k twr -v`
Expected: FAIL with `AttributeError: ... 'twr_from_periods'`

- [ ] **Step 3: Write minimal implementation**

```python
def twr_from_periods(
    starting_base: Decimal,
    events: list[tuple[str, Decimal]],
) -> Decimal | None:
    """Chain sub-period returns split at external cashflows ('flow' events).

    events: time-ordered ("pnl", net_pnl) | ("flow", signed_amount).
    """
    base = starting_base
    period_pnl = Decimal("0")
    factor = Decimal("1")
    established = base > 0

    def close_period(b: Decimal, p: Decimal, f: Decimal) -> Decimal:
        if b > 0:
            return f * (Decimal("1") + p / b)
        return f

    for kind, amount in events:
        if kind == "pnl":
            period_pnl += amount
        elif kind == "flow":
            factor = close_period(base, period_pnl, factor)
            base += amount
            period_pnl = Decimal("0")
            if base > 0:
                established = True
    # close the final open sub-period
    factor = close_period(base, period_pnl, factor)

    if not established:
        return None
    return (factor - Decimal("1")).quantize(_RATIO_Q)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k twr -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): TWR via chained sub-periods split at external cashflows"
```

---

### Task 10: Trade stats — per-lot (core)

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: `list[RoundTrip]` (per-lot view = the raw output of `pair_fills`).
- Produces: `trade_stats(rts: list[RoundTrip]) -> dict` with keys (all money as `Decimal`, counts `int`, holding `int` seconds):
  `gross_pnl, net_pnl, total_fees, win_rate, avg_win, avg_loss, profit_factor, payoff_ratio, expectancy, max_consec_wins, max_consec_losses, largest_win, largest_loss, avg_holding_secs, trade_count`.
- Win/loss classification on **net_pnl** (`> 0` win, `< 0` loss, `== 0` neither). All stats computed on net; gross totals also exposed.

**Definitions (pin exactly):**
- `win_rate = wins / trade_count` (ratio, 0 when no trades).
- `avg_win = mean(net_pnl of wins)`; `avg_loss = mean(net_pnl of losses)` (negative or zero).
- `profit_factor = sum(winning net) / |sum(losing net)|`; `None` when no losses (denominator 0).
- `payoff_ratio = avg_win / |avg_loss|`; `None` when no losses.
- `expectancy = win_rate × avg_win − loss_rate × |avg_loss|` where `loss_rate = losses / trade_count`.
- `avg_holding_secs = mean((close_ts − open_ts).total_seconds())` as int.

This task implements `trade_stats` for win_rate/avg/profit_factor/payoff/expectancy/holding/count/totals. Consecutive + largest are Task 12 (kept in same function, added there).

- [ ] **Step 1: Write the failing test**

```python
def test_trade_stats_three_known_round_trips():
    # net: +100, +50, -30  (gross == net here, fees 0)
    rts = [
        _rt("2026-06-18T15:00:00+00:00", "100", open_iso="2026-06-18T13:00:00+00:00"),  # 2h hold
        _rt("2026-06-19T15:00:00+00:00", "50",  open_iso="2026-06-19T14:00:00+00:00"),  # 1h hold
        _rt("2026-06-20T15:00:00+00:00", "-30", open_iso="2026-06-20T12:00:00+00:00"),  # 3h hold
    ]
    s = metrics.trade_stats(rts)
    assert s["trade_count"] == 3
    assert s["net_pnl"] == Decimal("120")
    assert s["win_rate"] == Decimal("0.666666666667")        # 2/3, 12 dp
    assert s["avg_win"] == Decimal("75")                     # (100+50)/2
    assert s["avg_loss"] == Decimal("-30")
    # profit_factor = (100+50)/|−30| = 5
    assert s["profit_factor"] == Decimal("5")
    # payoff = 75 / 30 = 2.5
    assert s["payoff_ratio"] == Decimal("2.5")
    # expectancy = 2/3*75 - 1/3*30 = 50 - 10 = 40
    assert s["expectancy"] == Decimal("40")
    # avg holding = (7200 + 3600 + 10800)/3 = 7200 s
    assert s["avg_holding_secs"] == 7200


def test_trade_stats_profit_factor_none_without_losses():
    rts = [_rt("2026-06-18T15:00:00+00:00", "100"), _rt("2026-06-19T15:00:00+00:00", "50")]
    s = metrics.trade_stats(rts)
    assert s["profit_factor"] is None
    assert s["payoff_ratio"] is None


def test_trade_stats_empty():
    s = metrics.trade_stats([])
    assert s["trade_count"] == 0
    assert s["win_rate"] == Decimal("0")
    assert s["net_pnl"] == Decimal("0")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k trade_stats -v`
Expected: FAIL with `AttributeError: ... 'trade_stats'`

- [ ] **Step 3: Write minimal implementation**

```python
def trade_stats(rts: list[RoundTrip]) -> dict:
    n = len(rts)
    gross = sum((rt.gross_pnl for rt in rts), Decimal("0"))
    net = sum((rt.net_pnl for rt in rts), Decimal("0"))
    fees = sum((rt.total_fees for rt in rts), Decimal("0"))

    wins = [rt.net_pnl for rt in rts if rt.net_pnl > 0]
    losses = [rt.net_pnl for rt in rts if rt.net_pnl < 0]

    win_rate = (Decimal(len(wins)) / n).quantize(_RATIO_Q) if n else Decimal("0")
    loss_rate = (Decimal(len(losses)) / n) if n else Decimal("0")
    avg_win = (sum(wins, Decimal("0")) / len(wins)) if wins else Decimal("0")
    avg_loss = (sum(losses, Decimal("0")) / len(losses)) if losses else Decimal("0")

    gross_win = sum(wins, Decimal("0"))
    gross_loss = sum(losses, Decimal("0"))
    profit_factor = (gross_win / abs(gross_loss)) if gross_loss != 0 else None
    payoff_ratio = (avg_win / abs(avg_loss)) if avg_loss != 0 else None
    expectancy = win_rate * avg_win - loss_rate * abs(avg_loss) if n else Decimal("0")

    if rts:
        avg_hold = int(
            sum((rt.close_ts - rt.open_ts).total_seconds() for rt in rts) / n
        )
    else:
        avg_hold = 0

    return {
        "gross_pnl": gross,
        "net_pnl": net,
        "total_fees": fees,
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "payoff_ratio": payoff_ratio,
        "expectancy": expectancy,
        "avg_holding_secs": avg_hold,
        "trade_count": n,
        # consec + largest filled in Task 12:
        "max_consec_wins": 0,
        "max_consec_losses": 0,
        "largest_win": max((rt.net_pnl for rt in rts), default=Decimal("0")),
        "largest_loss": min((rt.net_pnl for rt in rts), default=Decimal("0")),
    }
```

> Note: `largest_win/largest_loss` are trivially derivable so they're set here; Task 12 adds the consec logic and a dedicated test for largest values with a mixed series.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k trade_stats -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): per-lot trade stats (win rate/PF/payoff/expectancy/hold)"
```

---

### Task 11: Trade stats — per-position view

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes: `to_positions(round_trips) -> list[RoundTrip]` (Phase 3) — groups flat-to-flat lots into per-position trades.
- Produces: `stats_for_view(rts: list[RoundTrip], trade_view: str) -> dict` — returns `trade_stats(rts)` for `"lot"`, and `trade_stats(to_positions(rts))` for `"position"`.

> The orchestrator (Task 16) calls `stats_for_view(filtered_rts, trade_view)`. The two views are derived from the same round-trips; the response `meta.trade_view` records which.

- [ ] **Step 1: Write the failing test**

```python
def test_stats_for_view_position_groups_lots(monkeypatch):
    # Two lots closing the same flat-to-flat position: net +30 and +20.
    # Per-lot: 2 trades. Per-position: to_positions merges into 1 trade net +50.
    lots = [
        _rt("2026-06-18T15:00:00+00:00", "30", open_iso="2026-06-18T10:00:00+00:00"),
        _rt("2026-06-18T16:00:00+00:00", "20", open_iso="2026-06-18T10:00:00+00:00"),
    ]
    merged = [_rt("2026-06-18T16:00:00+00:00", "50", open_iso="2026-06-18T10:00:00+00:00")]
    monkeypatch.setattr(metrics, "to_positions", lambda rts: merged)

    lot_stats = metrics.stats_for_view(lots, "lot")
    pos_stats = metrics.stats_for_view(lots, "position")
    assert lot_stats["trade_count"] == 2
    assert pos_stats["trade_count"] == 1
    assert pos_stats["net_pnl"] == Decimal("50")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k stats_for_view -v`
Expected: FAIL with `AttributeError: ... 'stats_for_view'`

- [ ] **Step 3: Write minimal implementation**

```python
from app.services.pairing import to_positions  # re-exported for monkeypatch target


def stats_for_view(rts: list[RoundTrip], trade_view: str) -> dict:
    if trade_view == "position":
        return trade_stats(to_positions(rts))
    return trade_stats(rts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k stats_for_view -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): per-position trade-stats view via to_positions"
```

---

### Task 12: Expanded stats — max consecutive wins/losses + largest win/loss

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Modifies `trade_stats` to compute real `max_consec_wins`, `max_consec_losses` from the time-ordered (by `close_ts`) net_pnl sign sequence, and verifies `largest_win`/`largest_loss`.
- Produces: same `trade_stats` dict; `max_consec_wins`/`max_consec_losses` now correct.

**Definition:** order round-trips by `(close_ts, open_ts)`; walk the sign of `net_pnl`. A win (`>0`) extends the win streak and resets the loss streak; a loss (`<0`) the reverse; a flat (`==0`) resets both. Track the max of each streak.

- [ ] **Step 1: Write the failing test**

```python
def test_consecutive_and_largest():
    # net sequence by close time: +10, +20, -5, -3, -1, +40
    rts = [
        _rt("2026-06-18T10:00:00+00:00", "10"),
        _rt("2026-06-18T11:00:00+00:00", "20"),
        _rt("2026-06-18T12:00:00+00:00", "-5"),
        _rt("2026-06-18T13:00:00+00:00", "-3"),
        _rt("2026-06-18T14:00:00+00:00", "-1"),
        _rt("2026-06-18T15:00:00+00:00", "40"),
    ]
    s = metrics.trade_stats(rts)
    assert s["max_consec_wins"] == 2     # +10,+20
    assert s["max_consec_losses"] == 3   # -5,-3,-1
    assert s["largest_win"] == Decimal("40")
    assert s["largest_loss"] == Decimal("-5")


def test_consecutive_flat_resets_streaks():
    rts = [
        _rt("2026-06-18T10:00:00+00:00", "10"),
        _rt("2026-06-18T11:00:00+00:00", "0"),    # flat resets
        _rt("2026-06-18T12:00:00+00:00", "10"),
    ]
    s = metrics.trade_stats(rts)
    assert s["max_consec_wins"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k "consecutive" -v`
Expected: FAIL (`max_consec_wins == 0` from the Task-10 stub, expected 2)

- [ ] **Step 3: Write minimal implementation**

Replace the `max_consec_wins`/`max_consec_losses` stub in `trade_stats` with a real computation. Insert before the `return` dict:

```python
    ordered = sorted(rts, key=lambda rt: (rt.close_ts, rt.open_ts))
    max_w = max_l = cur_w = cur_l = 0
    for rt in ordered:
        if rt.net_pnl > 0:
            cur_w += 1
            cur_l = 0
        elif rt.net_pnl < 0:
            cur_l += 1
            cur_w = 0
        else:
            cur_w = cur_l = 0
        max_w = max(max_w, cur_w)
        max_l = max(max_l, cur_l)
```

And change the dict entries:

```python
        "max_consec_wins": max_w,
        "max_consec_losses": max_l,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k "consecutive or trade_stats or stats_for_view" -v`
Expected: PASS (all trade-stat tests still green + 2 new)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): max consecutive wins/losses + largest win/loss"
```

---

### Task 13: Symbol-level PnL-only + contribution-to-strategy

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Produces: `symbol_contribution(symbol_net: Decimal, strategy_net: Decimal) -> Decimal | None` — `symbol_net / strategy_net` (ratio, 12 dp); `None` when `strategy_net == 0`.
- The orchestrator (Task 16) at `level="symbol"`: computes `trade_stats` for the symbol's round-trips, sets all return-based fields to `None`, and adds `contribution_pct = symbol_contribution(symbol_net, strategy_net)` where `strategy_net` is the net PnL of the parent strategy over the same date range.

- [ ] **Step 1: Write the failing test**

```python
def test_symbol_contribution_ratio():
    assert metrics.symbol_contribution(Decimal("30"), Decimal("120")) == Decimal("0.250000000000")


def test_symbol_contribution_none_when_strategy_flat():
    assert metrics.symbol_contribution(Decimal("30"), Decimal("0")) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k symbol_contribution -v`
Expected: FAIL with `AttributeError: ... 'symbol_contribution'`

- [ ] **Step 3: Write minimal implementation**

```python
def symbol_contribution(symbol_net: Decimal, strategy_net: Decimal) -> Decimal | None:
    if strategy_net == 0:
        return None
    return (symbol_net / strategy_net).quantize(_RATIO_Q)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k symbol_contribution -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): symbol-level contribution-to-strategy ratio"
```

---

### Task 14: Flags + sample counts + Sharpe/Sortino suppression

**Files:**
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Produces:
  - `build_flags(*, round_trip_count: int, active_days: int, fx_missing: bool, open_positions_exist: bool) -> dict` — returns
    `{"realized_only": True, "low_sample": bool, "sharpe_suppressed": bool, "fx_missing": bool, "open_positions_exist": bool}`.
    - `low_sample = round_trip_count < SHARPE_MIN_SAMPLE_TRADES or active_days < SHARPE_MIN_ACTIVE_DAYS`.
    - `sharpe_suppressed = round_trip_count < SHARPE_SUPPRESS_BELOW`.
    - `realized_only` is always `True` (trades-only design).
  - `apply_suppression(value: float | None, suppressed: bool) -> float | None` — returns `None` when `suppressed`, else `value`. The orchestrator routes Sharpe/Sortino through this so a suppressed series returns `null`.

**Why pinned:** thresholds come straight from config — `SHARPE_MIN_SAMPLE_TRADES=20`, `SHARPE_MIN_ACTIVE_DAYS=30`, `SHARPE_SUPPRESS_BELOW=5`. The test asserts the exact boundary behavior.

- [ ] **Step 1: Write the failing test**

```python
def test_flags_low_sample_at_thresholds():
    # 19 round-trips (<20) but 40 active days -> low_sample True via trade count
    f = metrics.build_flags(round_trip_count=19, active_days=40,
                            fx_missing=False, open_positions_exist=False)
    assert f["low_sample"] is True
    assert f["sharpe_suppressed"] is False
    assert f["realized_only"] is True

    # exactly 20 trades and 30 active days -> NOT low_sample
    f2 = metrics.build_flags(round_trip_count=20, active_days=30,
                             fx_missing=False, open_positions_exist=False)
    assert f2["low_sample"] is False

    # 25 trades but only 29 active days -> low_sample via active-days threshold
    f3 = metrics.build_flags(round_trip_count=25, active_days=29,
                             fx_missing=False, open_positions_exist=False)
    assert f3["low_sample"] is True


def test_flags_suppression_below_five():
    f = metrics.build_flags(round_trip_count=4, active_days=10,
                            fx_missing=True, open_positions_exist=True)
    assert f["sharpe_suppressed"] is True
    assert f["fx_missing"] is True
    assert f["open_positions_exist"] is True


def test_apply_suppression_nulls_value():
    assert metrics.apply_suppression(1.23, True) is None
    assert metrics.apply_suppression(1.23, False) == 1.23
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k "flags or suppression" -v`
Expected: FAIL with `AttributeError: ... 'build_flags'`

- [ ] **Step 3: Write minimal implementation**

```python
def build_flags(
    *,
    round_trip_count: int,
    active_days: int,
    fx_missing: bool,
    open_positions_exist: bool,
) -> dict:
    low_sample = (
        round_trip_count < settings.SHARPE_MIN_SAMPLE_TRADES
        or active_days < settings.SHARPE_MIN_ACTIVE_DAYS
    )
    suppressed = round_trip_count < settings.SHARPE_SUPPRESS_BELOW
    return {
        "realized_only": True,
        "low_sample": low_sample,
        "sharpe_suppressed": suppressed,
        "fx_missing": fx_missing,
        "open_positions_exist": open_positions_exist,
    }


def apply_suppression(value: float | None, suppressed: bool) -> float | None:
    return None if suppressed else value
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k "flags or suppression" -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): flags, sample counts, Sharpe/Sortino suppression"
```

---

### Task 15: Benchmark alpha / beta / information ratio

**Files:**
- Create: `app/services/benchmark.py`
- Test: `tests/unit/test_benchmark.py`

**Interfaces:**
- Produces: `benchmark_metrics(return_series: dict[date, float], benchmark: dict[date, float]) -> dict` → `{"alpha": float|None, "beta": float|None, "information_ratio": float|None}`.
- Consumed by `metrics.compute_metrics` (Task 16): it builds the strategy/account daily return series and loads `BenchmarkReturn` rows into `{date: float(return_pct)}`. When no benchmark rows exist, the orchestrator skips this call and leaves all three `None`.

**Math (pin exactly):** align on the **intersection of dates** present in both series.
- `beta = cov(portfolio, benchmark) / var(benchmark)` (population cov/var over the aligned series).
- `alpha = mean(portfolio) − beta × mean(benchmark)`, then **annualized**: `alpha_annual = alpha × ANNUALIZATION_DAYS`.
- `information_ratio = mean(active) / stdev(active) × sqrt(ANNUALIZATION_DAYS)` where `active_i = portfolio_i − benchmark_i` (sample stdev, ddof=1).
- Return all `None` when fewer than 2 aligned points or `var(benchmark) == 0` (beta/alpha) / `stdev(active) == 0` (IR).

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_benchmark.py
import math
import statistics
from datetime import date
from app.services import benchmark


def test_beta_one_alpha_zero_when_portfolio_equals_benchmark():
    series = {date(2026, 1, d): r for d, r in [(1, 0.01), (2, -0.02), (3, 0.03), (4, 0.00)]}
    out = benchmark.benchmark_metrics(series, series)
    assert math.isclose(out["beta"], 1.0, rel_tol=1e-9)
    assert math.isclose(out["alpha"], 0.0, abs_tol=1e-9)
    # active returns all zero -> IR undefined -> None
    assert out["information_ratio"] is None


def test_beta_two_when_portfolio_is_double_benchmark():
    bench = {date(2026, 1, d): r for d, r in [(1, 0.01), (2, -0.02), (3, 0.03), (4, -0.01)]}
    port = {d: 2 * r for d, r in bench.items()}
    out = benchmark.benchmark_metrics(port, bench)
    assert math.isclose(out["beta"], 2.0, rel_tol=1e-9)
    # alpha = mean(port) - beta*mean(bench) = 2*mean(bench) - 2*mean(bench) = 0, annualized 0
    assert math.isclose(out["alpha"], 0.0, abs_tol=1e-9)


def test_information_ratio_value():
    bench = {date(2026, 1, d): r for d, r in [(1, 0.01), (2, 0.01), (3, 0.01), (4, 0.01)]}
    port = {date(2026, 1, d): r for d, r in [(1, 0.02), (2, 0.00), (3, 0.03), (4, 0.02)]}
    out = benchmark.benchmark_metrics(port, bench)
    active = [0.01, -0.01, 0.02, 0.01]
    expected_ir = statistics.fmean(active) / statistics.stdev(active) * math.sqrt(365)
    assert math.isclose(out["information_ratio"], expected_ir, rel_tol=1e-9)


def test_all_none_when_no_overlap():
    out = benchmark.benchmark_metrics({date(2026, 1, 1): 0.01}, {date(2026, 2, 1): 0.02})
    assert out == {"alpha": None, "beta": None, "information_ratio": None}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_benchmark.py -v`
Expected: FAIL with `ModuleNotFoundError`/`AttributeError: ... 'benchmark_metrics'`

- [ ] **Step 3: Write minimal implementation**

```python
# app/services/benchmark.py
from __future__ import annotations
import math
import statistics
from datetime import date

from app.core.config import settings


def benchmark_metrics(
    return_series: dict[date, float], benchmark: dict[date, float]
) -> dict:
    none = {"alpha": None, "beta": None, "information_ratio": None}
    common = sorted(set(return_series) & set(benchmark))
    if len(common) < 2:
        return none

    port = [return_series[d] for d in common]
    bench = [benchmark[d] for d in common]
    ann = settings.ANNUALIZATION_DAYS

    mean_p = statistics.fmean(port)
    mean_b = statistics.fmean(bench)
    var_b = statistics.pvariance(bench, mu=mean_b)

    out = dict(none)
    if var_b != 0:
        cov = sum((p - mean_p) * (b - mean_b) for p, b in zip(port, bench)) / len(common)
        beta = cov / var_b
        out["beta"] = beta
        out["alpha"] = (mean_p - beta * mean_b) * ann

    active = [p - b for p, b in zip(port, bench)]
    if len(active) >= 2:
        std_active = statistics.stdev(active)
        if std_active != 0:
            out["information_ratio"] = statistics.fmean(active) / std_active * math.sqrt(ann)
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_benchmark.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add app/services/benchmark.py tests/unit/test_benchmark.py
git commit -m "feat(benchmark): alpha/beta/information ratio vs uploaded benchmark"
```

---

### Task 16: Assemble the envelope — schemas + `compute_metrics` orchestrator + units map

**Files:**
- Create: `app/schemas/metrics.py`
- Modify: `app/services/metrics.py`
- Test: `tests/unit/test_metrics.py`

**Interfaces:**
- Consumes (Phase 3, exact): `pair_fills(fills, instruments)`, `fees_on_open_positions(fills, instruments)`, `to_positions(rts)`, `account_base(session, series_id, at)`, `strategy_base(session, series_id, strategy_id, at)`, `base_series(session, series_id, level, ref_id, days)`, plus all Task 1–15 helpers.
- Produces: `compute_metrics(session, series_id, level, *, strategy=None, symbol=None, date_from=None, date_to=None, trade_view="lot", active_days_only=False) -> MetricsEnvelope`. This is the contract Phase 5 + the frontend consume unchanged.

**Schema (`app/schemas/metrics.py`):** Pydantic v2 models. **All monetary/ratio metric fields are `str | None`** (Decimal serialized via a field serializer that calls `str()`); counts are `int`. The envelope mirrors design §8 exactly.

```python
# app/schemas/metrics.py
from __future__ import annotations
from datetime import date
from pydantic import BaseModel


class DateRange(BaseModel):
    from_: str | None = None  # serialization alias "from"
    to: str | None = None
    model_config = {"populate_by_name": True}


class SampleBlock(BaseModel):
    round_trips: int
    active_days: int


class FlagsBlock(BaseModel):
    realized_only: bool
    low_sample: bool
    sharpe_suppressed: bool
    fx_missing: bool
    open_positions_exist: bool


class MetaBlock(BaseModel):
    level: str
    base_currency: str
    session_tz: str
    date_range: DateRange
    trade_view: str
    capital_base: str | None
    sample: SampleBlock
    flags: FlagsBlock


class MetricsBlock(BaseModel):
    net_pnl: str
    gross_pnl: str
    total_fees: str
    fees_on_open_positions: str
    twr: str | None
    cagr: str | None
    volatility: str | None
    sharpe: str | None
    sortino: str | None
    calmar: str | None
    max_drawdown: str | None
    win_rate: str
    profit_factor: str | None
    payoff_ratio: str | None
    expectancy: str
    max_consec_wins: int
    max_consec_losses: int
    largest_win: str
    largest_loss: str
    avg_holding_secs: int
    trade_count: int
    avg_win: str
    avg_loss: str
    contribution_pct: str | None = None
    alpha: str | None = None
    beta: str | None = None
    information_ratio: str | None = None
    units: dict[str, str]


class EquityPoint(BaseModel):
    ts: str
    realized_pnl: str
    indexed_return: str | None


class DrawdownPoint(BaseModel):
    ts: str
    drawdown: str
    drawdown_pct: str


class MetricsEnvelope(BaseModel):
    meta: MetaBlock
    metrics: MetricsBlock
    equity_curve: list[EquityPoint]
    drawdown_series: list[DrawdownPoint]


class MetricsQuery(BaseModel):
    level: str = "account"
    strategy: str | None = None
    symbol: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    trade_view: str = "lot"
    active_days_only: bool = False
```

**`units_map(level)`** returns the per-field unit dict. Pin exact unit strings:

```python
def units_map(level: str, base_currency: str) -> dict[str, str]:
    units = {
        "net_pnl": base_currency, "gross_pnl": base_currency, "total_fees": base_currency,
        "fees_on_open_positions": base_currency, "largest_win": base_currency,
        "largest_loss": base_currency, "avg_win": base_currency, "avg_loss": base_currency,
        "expectancy": base_currency,
        "win_rate": "ratio", "profit_factor": "ratio", "payoff_ratio": "ratio",
        "max_consec_wins": "count", "max_consec_losses": "count", "trade_count": "count",
        "avg_holding_secs": "seconds",
        "twr": "ratio", "cagr": "annualized_ratio", "calmar": "ratio",
        "max_drawdown": base_currency,
        "volatility": "annualized_ratio", "sharpe": "annualized_ratio",
        "sortino": "annualized_ratio",
        "alpha": "annualized_ratio", "beta": "ratio", "information_ratio": "annualized_ratio",
    }
    if level == "symbol":
        units["contribution_pct"] = "ratio"
    return units
```

**Orchestration logic (`compute_metrics`):**

```python
def _fmt(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, Decimal):
        return str(v)
    return str(v)


def _load_fills(session, series_id, strategy=None, symbol=None):
    """Non-voided fills for the series, optionally scoped to strategy name / symbol.
    Returns (fills, instruments dict). Resolves `strategy` name -> strategy_id."""
    from app.models.fill import Fill
    from app.models.instrument import Instrument
    from app.models.strategy import Strategy
    q = session.query(Fill).filter(Fill.series_id == series_id, Fill.voided_at.is_(None))
    if strategy is not None:
        strat = (
            session.query(Strategy)
            .filter(Strategy.series_id == series_id,
                    Strategy.name_key == strategy.strip().lower())
            .one_or_none()
        )
        if strat is None:
            return [], {}, None
        q = q.filter(Fill.strategy_id == strat.id)
        strat_id = strat.id
    else:
        strat_id = None
    if symbol is not None:
        q = q.filter(Fill.symbol == symbol.strip().upper())
    fills = q.all()
    instruments = {
        i.symbol: i
        for i in session.query(Instrument).filter(Instrument.series_id == series_id).all()
    }
    return fills, instruments, strat_id


def compute_metrics(session, series_id, level, *, strategy=None, symbol=None,
                    date_from=None, date_to=None, trade_view="lot",
                    active_days_only=False):
    from app.models.series import Series
    from app.models.benchmark_return import BenchmarkReturn
    from app.schemas.metrics import (
        MetricsEnvelope, MetaBlock, MetricsBlock, FlagsBlock, SampleBlock,
        DateRange, EquityPoint, DrawdownPoint,
    )

    series = session.get(Series, series_id)
    tz = series.session_tz
    base_ccy = series.base_currency

    # 1. fills -> round-trips (instrument ccy)
    fills, instruments, strat_id = _load_fills(session, series_id, strategy, symbol)
    all_rts = pair_fills(fills, instruments)
    rts = filter_round_trips(all_rts, tz, date_from, date_to)
    fees_open = fees_on_open_positions(fills, instruments)

    # 2. convert round-trips to base currency (metrics-layer responsibility)
    rts = _convert_to_base_ccy(rts, session, series_id, base_ccy)
    fx_missing = any(rt.fx_missing for rt in rts)
    open_positions_exist = fees_open != Decimal("0") or _has_open_positions(fills, instruments)

    # 3. capital base (None for symbol level)
    if level == "symbol":
        capital_base = None
    elif level == "strategy":
        last_ts = max((rt.close_ts for rt in rts), default=None)
        capital_base = strategy_base(session, series_id, strat_id, last_ts)
    else:  # account
        last_ts = max((rt.close_ts for rt in rts), default=None)
        capital_base = account_base(session, series_id, last_ts)

    # 4. equity + indexed + drawdown
    curve = realized_equity_curve(rts)
    idx = indexed_curve(curve, capital_base)
    dd = drawdown_series(curve)
    max_dd = max_drawdown(dd)

    # 5. daily returns + risk metrics (only for account/strategy)
    if level == "symbol" or not curve:
        twr_val = cagr_val = vol_val = sharpe_val = sortino_val = calmar_val = None
        active_days = 0
        max_dd_out = None if level == "symbol" else max_dd
    else:
        days = _calendar_days(rts, tz)
        base_by_day = base_series(session, series_id, level, strat_id, days)
        rets = daily_returns(rts, base_by_day, tz, active_days_only=active_days_only)
        active_days = sum(1 for d in days if _has_close_on(rts, tz, d))
        vol_val = volatility(rets)
        sharpe_val = sharpe(rets)
        sortino_val = sortino(rets)
        n_days = max((days[-1] - days[0]).days + 1, 1) if days else 1
        cagr_val = cagr(curve, capital_base, n_days)
        calmar_val = calmar(cagr_val, max_dd, capital_base)
        twr_val = _twr_for(session, series_id, level, strat_id, rts, tz, capital_base)
        max_dd_out = max_dd

    # 6. suppression
    flags = build_flags(round_trip_count=len(rts), active_days=active_days,
                        fx_missing=fx_missing, open_positions_exist=open_positions_exist)
    if level != "symbol":
        sharpe_val = apply_suppression(sharpe_val, flags["sharpe_suppressed"])
        sortino_val = apply_suppression(sortino_val, flags["sharpe_suppressed"])

    # 7. trade stats (view-aware)
    stats = stats_for_view(rts, trade_view)

    # 8. symbol contribution
    contribution = None
    if level == "symbol":
        strat_fills, strat_instr, _ = _load_fills(session, series_id, strategy, None)
        strat_rts = _convert_to_base_ccy(
            filter_round_trips(pair_fills(strat_fills, strat_instr), tz, date_from, date_to),
            session, series_id, base_ccy,
        )
        strat_net = sum((rt.net_pnl for rt in strat_rts), Decimal("0"))
        contribution = symbol_contribution(stats["net_pnl"], strat_net)

    # 9. benchmark (account/strategy only, when uploaded)
    alpha = beta = ir = None
    if level != "symbol" and curve:
        bench_rows = (
            session.query(BenchmarkReturn)
            .filter(BenchmarkReturn.series_id == series_id).all()
        )
        if bench_rows:
            bench_by_day = {trade_date(b.ts, tz): float(b.return_pct) for b in bench_rows}
            bm = benchmark_metrics(rets, bench_by_day)
            alpha, beta, ir = bm["alpha"], bm["beta"], bm["information_ratio"]

    # 10. assemble
    meta = MetaBlock(
        level=level, base_currency=base_ccy, session_tz=tz,
        date_range=DateRange(from_=date_from.isoformat() if date_from else None,
                             to=date_to.isoformat() if date_to else None),
        trade_view=trade_view,
        capital_base=_fmt(capital_base),
        sample=SampleBlock(round_trips=len(rts), active_days=active_days),
        flags=FlagsBlock(**flags),
    )
    metrics_block = MetricsBlock(
        net_pnl=_fmt(stats["net_pnl"]), gross_pnl=_fmt(stats["gross_pnl"]),
        total_fees=_fmt(stats["total_fees"]), fees_on_open_positions=_fmt(fees_open),
        twr=_fmt(twr_val), cagr=_fmt(cagr_val), volatility=_fmt(vol_val),
        sharpe=_fmt(sharpe_val), sortino=_fmt(sortino_val), calmar=_fmt(calmar_val),
        max_drawdown=_fmt(max_dd_out),
        win_rate=_fmt(stats["win_rate"]), profit_factor=_fmt(stats["profit_factor"]),
        payoff_ratio=_fmt(stats["payoff_ratio"]), expectancy=_fmt(stats["expectancy"]),
        max_consec_wins=stats["max_consec_wins"], max_consec_losses=stats["max_consec_losses"],
        largest_win=_fmt(stats["largest_win"]), largest_loss=_fmt(stats["largest_loss"]),
        avg_holding_secs=stats["avg_holding_secs"], trade_count=stats["trade_count"],
        avg_win=_fmt(stats["avg_win"]), avg_loss=_fmt(stats["avg_loss"]),
        contribution_pct=_fmt(contribution),
        alpha=_fmt(alpha), beta=_fmt(beta), information_ratio=_fmt(ir),
        units=units_map(level, base_ccy),
    )
    equity = [
        EquityPoint(ts=ts.isoformat(), realized_pnl=_fmt(v),
                    indexed_return=_fmt(idx[i]))
        for i, (ts, v) in enumerate(curve)
    ]
    drawdown = [
        DrawdownPoint(ts=ts.isoformat(), drawdown=_fmt(d), drawdown_pct=_fmt(p))
        for ts, d, p in dd
    ]
    return MetricsEnvelope(meta=meta, metrics=metrics_block,
                           equity_curve=equity, drawdown_series=drawdown)
```

Add the small helper utilities used above:

```python
def _calendar_days(rts, tz):
    if not rts:
        return []
    dates = sorted({trade_date(rt.close_ts, tz) for rt in rts})
    start, end = dates[0], dates[-1]
    out, d = [], start
    while d <= end:
        out.append(d)
        d += timedelta(days=1)
    return out


def _has_close_on(rts, tz, d) -> bool:
    return any(trade_date(rt.close_ts, tz) == d for rt in rts)


def _has_open_positions(fills, instruments) -> bool:
    # An open position exists if pairing leaves any non-voided open lot.
    # Cheap proxy: net signed qty per (strategy, symbol) != 0.
    from collections import defaultdict
    net = defaultdict(Decimal)
    for f in fills:
        if f.voided_at is not None:
            continue
        sign = Decimal("1") if f.side == "buy" else Decimal("-1")
        net[(f.strategy_id, f.symbol)] += sign * f.qty
    return any(v != 0 for v in net.values())


def _convert_to_base_ccy(rts, session, series_id, base_ccy):
    """Convert each RoundTrip's instrument-ccy PnL/fees to base currency.

    Uses ``fx.to_base(session, series_id, amount, rt.currency, rt.close_ts)``.
    When a rate is missing (``to_base`` returns None), marks the round-trip
    ``fx_missing=True`` — exclude it from base-ccy aggregates; the response
    ``flags.fx_missing`` will be set downstream from ``any(rt.fx_missing …)``.
    If ``rt.currency == base_ccy``, ``to_base`` is the identity — no DB call needed
    (the fx module handles this internally).
    """
    converted = []
    for rt in rts:
        gross = fx.to_base(session, series_id, rt.gross_pnl, rt.currency, rt.close_ts)
        fees = fx.to_base(session, series_id, rt.total_fees, rt.currency, rt.close_ts)
        if gross is None or fees is None:
            rt.fx_missing = True
        else:
            rt.gross_pnl = gross
            rt.total_fees = fees
            rt.net_pnl = gross - fees
            rt.entry_fees = fx.to_base(session, series_id, rt.entry_fees, rt.currency, rt.close_ts)
            rt.exit_fees = fx.to_base(session, series_id, rt.exit_fees, rt.currency, rt.close_ts)
            # entry_fees / exit_fees should never be None if total_fees is available,
            # but guard with a fallback to retain the original value:
            if rt.entry_fees is None:
                rt.entry_fees = Decimal("0")
            if rt.exit_fees is None:
                rt.exit_fees = Decimal("0")
        converted.append(rt)
    return converted


def _twr_for(session, series_id, level, ref_id, rts, tz, capital_base):
    """Build the time-ordered (pnl/flow) event stream from round-trip closes + EXTERNAL
    cashflows, then chain sub-period returns. Account level uses EXTERNAL movements;
    strategy level uses flows into the strategy bucket."""
    from app.models.fund_movement import FundMovement
    if capital_base is None:
        return None
    movements = (
        session.query(FundMovement)
        .filter(FundMovement.series_id == series_id, FundMovement.voided_at.is_(None))
        .all()
    )
    flows = []
    for m in movements:
        signed = _external_signed_flow(m, level, ref_id)  # base-ccy signed Decimal or None
        if signed is not None and signed != 0:
            flows.append((m.ts, "flow", signed))
    closes = [(rt.close_ts, "pnl", rt.net_pnl) for rt in rts]
    starting_base = _starting_base(session, series_id, level, ref_id, rts)
    merged = sorted(closes + flows, key=lambda e: e[0])
    events = [(kind, amount) for _, kind, amount in merged]
    return twr_from_periods(starting_base, events)
```

> **Note for the implementer:** `_external_signed_flow` and `_starting_base` are thin adapters over Phase-3 `capital`. `_starting_base` = the bucket's capital base *before the first round-trip close* (`account_base`/`strategy_base` at `first_close_ts - epsilon`, or the base at `None` if the first flow precedes trading). `_external_signed_flow` returns `+amount` for flows **into** the bucket (`EXTERNAL→FREE_CASH`/`EXTERNAL→STRATEGY(ref)` at account/strategy level), `−amount` for flows **out**, and `None` for movements that don't touch the bucket's external boundary. Convert each movement's `amount`/`currency` to base ccy via `fx.to_base(session, series_id, m.amount, m.currency, m.ts)` (skip/flag if `None`). Keep this logic in `metrics.py`; it's the only place that turns capital movements into a TWR event stream.

- [ ] **Step 1: Write the failing test** (orchestrator end-to-end on a real session)

```python
def test_compute_metrics_account_envelope_shape(db_session, make_user, make_series):
    user = make_user(status="approved")
    series = make_series(user, base_currency="USD", session_tz="UTC")
    # seed: one strategy, an EXTERNAL deposit of 10000, two closed round-trips via fills.
    _seed_strategy(db_session, series, "alpha")
    _seed_external_deposit(db_session, series, "2026-01-01T00:00:00+00:00", "10000")
    _seed_round_trip(db_session, series, "alpha", "AAPL",
                     open_iso="2026-01-02T15:00:00+00:00", close_iso="2026-01-02T16:00:00+00:00",
                     qty="100", entry="10", exit="12")   # +200 gross
    _seed_round_trip(db_session, series, "alpha", "AAPL",
                     open_iso="2026-01-03T15:00:00+00:00", close_iso="2026-01-03T16:00:00+00:00",
                     qty="100", entry="12", exit="11")    # -100 gross
    env = metrics.compute_metrics(db_session, series.id, "account")
    assert env.meta.level == "account"
    assert env.meta.base_currency == "USD"
    assert env.meta.flags.realized_only is True
    assert env.metrics.net_pnl == "100"        # +200 -100
    assert env.metrics.units["net_pnl"] == "USD"
    assert env.metrics.units["twr"] == "ratio"
    assert len(env.equity_curve) == 2
    assert env.equity_curve[0].realized_pnl == "200"
    assert env.equity_curve[1].realized_pnl == "100"
    # indexed return = cum_pnl / 10000
    assert env.equity_curve[0].indexed_return == "0.020000000000"


def test_compute_metrics_symbol_omits_return_fields(db_session, make_user, make_series):
    user = make_user(status="approved")
    series = make_series(user, base_currency="USD", session_tz="UTC")
    _seed_strategy(db_session, series, "alpha")
    _seed_round_trip(db_session, series, "alpha", "AAPL",
                     open_iso="2026-01-02T15:00:00+00:00", close_iso="2026-01-02T16:00:00+00:00",
                     qty="100", entry="10", exit="12")    # +200
    _seed_round_trip(db_session, series, "alpha", "MSFT",
                     open_iso="2026-01-03T15:00:00+00:00", close_iso="2026-01-03T16:00:00+00:00",
                     qty="100", entry="10", exit="11")     # +100, strategy total 300
    env = metrics.compute_metrics(db_session, series.id, "symbol",
                                  strategy="alpha", symbol="AAPL")
    assert env.metrics.twr is None
    assert env.metrics.sharpe is None
    assert env.metrics.cagr is None
    assert env.metrics.max_drawdown is None
    assert env.metrics.net_pnl == "200"
    # contribution = 200 / 300
    assert env.metrics.contribution_pct == "0.666666666667"


def test_compute_metrics_fx_converts_eur_to_usd(db_session, make_user, make_series):
    """EUR round-trip, as-of EUR→USD rate 1.10 → net_pnl converted to USD."""
    user = make_user(status="approved")
    series = make_series(user, base_currency="USD", session_tz="UTC")
    _seed_strategy(db_session, series, "alpha")
    _seed_external_deposit(db_session, series, "2026-01-01T00:00:00+00:00", "10000")
    _seed_round_trip(db_session, series, "alpha", "EURUSD",
                     open_iso="2026-01-02T15:00:00+00:00", close_iso="2026-01-02T16:00:00+00:00",
                     qty="1", entry="100", exit="300",
                     instrument_ccy="EUR", marker="fx_eur_usd_110")
    # seed an FxRate: EUR→USD at 1.10 before the close_ts
    _seed_fx_rate(db_session, series, "EUR", "USD", "1.10", "2026-01-02T12:00:00+00:00")
    env = metrics.compute_metrics(db_session, series.id, "account")
    assert env.meta.flags.fx_missing is False
    # EUR 200 net × 1.10 = USD 220
    assert env.metrics.net_pnl == "220"
    assert env.metrics.units["net_pnl"] == "USD"
    assert env.equity_curve[0].realized_pnl == "220"


def test_compute_metrics_fx_missing_rate_flags_and_excludes(db_session, make_user, make_series):
    """EUR round-trip with no as-of EUR→USD rate → fx_missing, excluded from net."""
    user = make_user(status="approved")
    series = make_series(user, base_currency="USD", session_tz="UTC")
    _seed_strategy(db_session, series, "alpha")
    _seed_external_deposit(db_session, series, "2026-01-01T00:00:00+00:00", "10000")
    _seed_round_trip(db_session, series, "alpha", "EURJPY",
                     open_iso="2026-01-02T15:00:00+00:00", close_iso="2026-01-02T16:00:00+00:00",
                     qty="1", entry="50", exit="150",
                     instrument_ccy="EUR")
    # no FxRate seeded → to_base returns None → fx_missing
    env = metrics.compute_metrics(db_session, series.id, "account")
    assert env.meta.flags.fx_missing is True
    # round-trip excluded from base-ccy aggregates
    assert env.metrics.net_pnl == "0"
    assert env.metrics.trade_count == 0
    assert len(env.equity_curve) == 0
```

> The `_seed_*` helpers wrap the existing Phase-2 ingestion factories (create strategy, post fills, post fund-movements). `_seed_round_trip` accepts optional keyword `instrument_ccy` (default `"USD"`) to set the instrument currency for the round-trip's underlying Instrument row. `_seed_fx_rate` inserts an `FxRate` row: `(series_id, ccy_from, ccy_to, rate, ts)`. If these factories don't exist in `conftest.py`, add thin local helpers in the test module that construct ORM rows directly and `db_session.add`/`commit`.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_metrics.py -k compute_metrics -v`
Expected: FAIL with `AttributeError: ... 'compute_metrics'` (or `ImportError` on `app.schemas.metrics`)

- [ ] **Step 3: Write minimal implementation**

Create `app/schemas/metrics.py` exactly as above, then add `units_map`, `_fmt`, `_load_fills`, the helper utilities, and `compute_metrics` to `app/services/metrics.py` as above. Add the imports at the top of `metrics.py`:

```python
from app.services.pairing import pair_fills, fees_on_open_positions, to_positions
from app.services.capital import account_base, strategy_base, base_series
from app.services import fx
from app.services.benchmark import benchmark_metrics
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_metrics.py -k compute_metrics -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add app/schemas/metrics.py app/services/metrics.py tests/unit/test_metrics.py
git commit -m "feat(metrics): assemble self-describing envelope + units map + orchestrator"
```

---

### Task 17: Metrics router + API tests

**Files:**
- Create: `app/routers/metrics.py`
- Modify: `app/routers/__init__.py`
- Test: `tests/api/test_metrics_api.py`

**Interfaces:**
- Consumes: `compute_metrics(...)` (Task 16), `get_current_user` (JWT), `get_db`.
- Produces: `GET /series/{id}/metrics?level=&strategy=&symbol=&date_from=&date_to=&trade_view=&active_days_only=` → `MetricsEnvelope` JSON. 404 if the series is not owned by the authenticated user (no existence leak).

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_metrics_api.py
def test_metrics_endpoint_returns_envelope(client, make_user, make_series, auth_headers,
                                           db_session):
    user = make_user(status="approved")
    series = make_series(user, base_currency="USD", session_tz="UTC")
    _seed_strategy(db_session, series, "alpha")
    _seed_external_deposit(db_session, series, "2026-01-01T00:00:00+00:00", "10000")
    _seed_round_trip(db_session, series, "alpha", "AAPL",
                     open_iso="2026-01-02T15:00:00+00:00", close_iso="2026-01-02T16:00:00+00:00",
                     qty="100", entry="10", exit="12")
    r = client.get(f"/series/{series.id}/metrics?level=account",
                   headers=auth_headers(user))
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"meta", "metrics", "equity_curve", "drawdown_series"}
    assert body["meta"]["level"] == "account"
    assert body["meta"]["base_currency"] == "USD"
    assert "flags" in body["meta"] and "units" in body["metrics"]
    assert body["metrics"]["net_pnl"] == "200"


def test_metrics_date_range_and_trade_view_query(client, make_user, make_series,
                                                 auth_headers, db_session):
    user = make_user(status="approved")
    series = make_series(user, base_currency="USD", session_tz="UTC")
    _seed_strategy(db_session, series, "alpha")
    _seed_round_trip(db_session, series, "alpha", "AAPL",
                     open_iso="2026-01-02T15:00:00+00:00", close_iso="2026-01-02T16:00:00+00:00",
                     qty="100", entry="10", exit="12")     # +200, in range
    _seed_round_trip(db_session, series, "alpha", "AAPL",
                     open_iso="2026-02-10T15:00:00+00:00", close_iso="2026-02-10T16:00:00+00:00",
                     qty="100", entry="10", exit="9")        # -100, OUT of range
    r = client.get(
        f"/series/{series.id}/metrics?level=account&date_from=2026-01-01&date_to=2026-01-31"
        f"&trade_view=lot&active_days_only=false",
        headers=auth_headers(user),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["trade_view"] == "lot"
    assert body["meta"]["date_range"]["from"] == "2026-01-01"
    assert body["metrics"]["trade_count"] == 1
    assert body["metrics"]["net_pnl"] == "200"


def test_metrics_per_user_isolation_returns_404(client, make_user, make_series, auth_headers):
    owner = make_user(status="approved")
    other = make_user(status="approved")
    series = make_series(owner, base_currency="USD", session_tz="UTC")
    r = client.get(f"/series/{series.id}/metrics?level=account",
                   headers=auth_headers(other))
    assert r.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_metrics_api.py -v`
Expected: FAIL with `404` for all (route not registered) or `AssertionError`

- [ ] **Step 3: Write minimal implementation**

```python
# app/routers/metrics.py
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.core.deps import get_current_user
from app.models.series import Series
from app.models.user import User
from app.services.metrics import compute_metrics
from app.schemas.metrics import MetricsEnvelope

router = APIRouter(tags=["metrics"])


@router.get("/series/{series_id}/metrics", response_model=MetricsEnvelope)
def get_series_metrics(
    series_id: int,
    level: str = Query("account", pattern="^(account|strategy|symbol)$"),
    strategy: str | None = None,
    symbol: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    trade_view: str = Query("lot", pattern="^(lot|position)$"),
    active_days_only: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MetricsEnvelope:
    series = db.get(Series, series_id)
    if series is None or series.user_id != user.id:
        raise HTTPException(status_code=404, detail="Series not found")
    return compute_metrics(
        db, series_id, level, strategy=strategy, symbol=symbol,
        date_from=date_from, date_to=date_to, trade_view=trade_view,
        active_days_only=active_days_only,
    )
```

Register it in `app/routers/__init__.py`:

```python
from app.routers import metrics as metrics_router
api_router.include_router(metrics_router.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/api/test_metrics_api.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full Phase-4 suite + ruff**

Run: `uv run ruff check app/services/metrics.py app/services/benchmark.py app/routers/metrics.py app/schemas/metrics.py && uv run pytest tests/unit/test_metrics.py tests/unit/test_benchmark.py tests/api/test_metrics_api.py -v`
Expected: ruff clean; all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/routers/metrics.py app/routers/__init__.py tests/api/test_metrics_api.py
git commit -m "feat(metrics): GET /series/{id}/metrics router + API tests + isolation"
```

---

## Self-Review

Mapping each acceptance criterion (验收标准 group F + risk/return/expanded/benchmark + ENV) to the task that satisfies it:

| Criterion | Requirement | Task |
|-----------|-------------|------|
| **F1** | Realized equity curve (stepped cumulative net PnL) + indexed/normalized curve | Task 2 (equity), Task 3 (indexed), assembled Task 16 |
| **F2** | Drawdown peak-to-trough + max_dd; annotated when open positions exist | Task 4 (dd series/max), Task 14/16 (`open_positions_exist` flag) |
| **F3** | Sharpe/Sortino on daily realized-PnL/time-varying-base, zero-return days, Sortino target 0 | Task 5 (daily returns + zero fill), Task 6 (Sharpe), Task 7 (Sortino) |
| **F4** | Trade stats (win rate, avg win/loss, PF, payoff, expectancy, consec, largest, hold, count) on net | Task 10 (core), Task 12 (consec/largest) |
| **F5** | Symbol level: PnL + stats only, contribution-to-strategy, return fields null | Task 13 (contribution), Task 16 (null return fields at symbol level) — tested in `test_compute_metrics_symbol_omits_return_fields` |
| **F6** | Date-range filter inclusive/inclusive, trade-date in session_tz | Task 1 (filter + trade_date), API test in Task 17 |
| **F7** | TWR neutralizes cashflow timing (same trades, different funding → same TWR) | Task 9 (`twr_from_periods` + `test_twr_identical_when_same_base_during_trades`), Task 16 (`_twr_for` event stream) |
| **F8** | Pinned risk conventions: rf, √365/×365, zero-day, low_sample (<20 trades / <30 days), suppress (<5) | Task 6/7 (rf + √365), Task 5 (zero-day + active_days_only), Task 14 (low_sample + suppression at thresholds) |
| **F9** | Expanded metrics correct: CAGR, Calmar (=CAGR/|maxDD|), volatility, expectancy, payoff, consec, largest | Task 8 (vol/CAGR/Calmar), Task 10 (expectancy/payoff), Task 12 (consec/largest) |
| **F10** | Benchmark alpha/beta/IR present when uploaded, null otherwise | Task 15 (`benchmark_metrics`), Task 16 (loads `BenchmarkReturn`, null when absent) |
| **ENV-1** | `meta` complete (level, base_currency, session_tz, date_range, trade_view, capital_base, sample) | Task 16 (`MetaBlock`) |
| **ENV-2** | `meta.flags` (realized_only, low_sample, sharpe_suppressed, fx_missing, open_positions_exist) | Task 14 (`build_flags`), Task 16 |
| **ENV-3** | `units` map per numeric field | Task 16 (`units_map`) |
| **ENV-4** | Render-ready sorted equity_curve (realized_pnl + indexed_return) + drawdown_series | Task 2/3/4 + Task 16 assembly |
| **ENV-5** | Decimal end-to-end, all numbers serialized as strings | Task 16 (`_fmt` → `str`, schema fields `str | None`) |
| **ENV-6** | Symbol-level field trimming (return fields null) | Task 13/16 |
| **H1** | Per-user isolation: other user's series → 404 | Task 17 (`test_metrics_per_user_isolation_returns_404`) |
| **CCY-3** | `fx_missing` surfaced in flags | Task 16 (`_convert_to_base_ccy` sets `rt.fx_missing` when `to_base` returns None, then `fx_missing = any(...)` → `build_flags`), Task 14 |
| **TZ-2/3** | Trade date in session_tz | Task 1 (`test_trade_date_uses_session_tz_not_utc`) |
| **D10** | lot vs position trade-stat views, view recorded in response | Task 11 (`stats_for_view`), Task 16 (`meta.trade_view`) |
| **FEE-1/3** | gross + net + total_fees + fees_on_open_positions reported | Task 10 (totals), Task 16 (`fees_on_open_positions`) |

**Placeholder scan:** no TBD/TODO; every code step shows real code; every test has concrete numeric fixtures and exact assertions; every run step has an exact `uv run pytest` command + expected result.

**Type consistency check:** `RoundTrip` field names (`close_ts`, `open_ts`, `net_pnl`, `gross_pnl`, `total_fees`, `fx_missing`) are used identically across Tasks 1–16. `_RATIO_Q` (12-dp quantizer) is defined once in Task 3 and reused in Tasks 4/9/13. `trade_stats` keys defined in Task 10 are consumed unchanged in Tasks 11/12/16. `build_flags` returns a dict consumed via `FlagsBlock(**flags)` and `flags["sharpe_suppressed"]` consistently. `compute_metrics` signature matches the spec's `services/metrics.py` contract verbatim.

**Open dependency note for the executor:** Tasks 9 and 16 depend on Phase-3 `capital`/`fund_movement` semantics for the TWR event stream (`_external_signed_flow`, `_starting_base`). These are thin adapters over `account_base`/`strategy_base`; if Phase-3's bucket model differs from the design doc, adjust the adapter only — `twr_from_periods` (the tested core) is pure and unchanged.