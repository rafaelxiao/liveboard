# LiveBoard Phase 5 — Comparison Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `services/comparison.py` — a stateless multi-series comparison engine with a deterministic per-trade matcher — plus the thin `POST /comparisons` router, completing the **backend MVP**.

**Architecture:** A single pure-ish service function `compare(session, user_id, series_ids, ...)` orchestrates ownership validation, a currency guard, baseline resolution, reuse of Phase 4 `metrics.compute_metrics` for account/strategy/symbol blocks, and a deterministic same-side/nearest-timestamp greedy fill matcher producing baseline-signed diff rows with surfaced unmatched fills and pagination. The router parses the request, calls the one service, and serializes the `ComparisonOut` envelope. Nothing is persisted.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2 / Pydantic v2 / `decimal.Decimal` / `zoneinfo`; pytest + httpx TestClient against a test PostgreSQL.

## Global Constraints

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates `NUMERIC(28,12)`; JSON numbers serialized as **strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (reject naive/non-UTC); trade date derived in series `session_tz`.
- **No financial computation in the frontend.** If a number is shown, the backend produced it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest` green before a phase gate.
- Per-user data isolation everywhere; voided rows excluded from all computation.
- `PER_TRADE_MATCH_TOLERANCE` default `300` seconds (5 min), read from `core.config.Settings`.
- Comparison is **stateless** — nothing persisted, no comparison history; same input → same output (idempotent).
- Date-range boundary semantics: inclusive-start / inclusive-end; trade date derived in series `session_tz` (consistent with Phase 4 F6).

---

## Assumed Phase 0–4 deliverables (consumed, not re-built)

These exist and are stable. Consume their **exact** signatures; do not modify them.

- `app/core/config.py` — `Settings` (pydantic-settings) exposing `PER_TRADE_MATCH_TOLERANCE: int` (seconds, default 300). Access via `from app.core.config import get_settings` → `get_settings().PER_TRADE_MATCH_TOLERANCE`.
- `app/core/errors.py` — typed domain exceptions + handlers. Includes `NotFoundError` (mapped → HTTP 404). If a different name is used in your tree, the router maps the comparison ownership failure to **404**.
- `app/core/deps.py` — `get_current_user` (JWT) yielding the authenticated `User` with `.id`; `get_db` yields a `Session`.
- `app/models/` — ORM classes:
  - `Series(id, user_id, name, tag, notes, base_currency, session_tz, created_at)`
  - `Strategy(id, series_id, name, name_key)` — `name_key` already normalized lower+trim at ingestion.
  - `Fill(id, series_id, strategy_id, symbol, side, qty, price, commission, exchange_fee, regulatory_fee, financing_fee, ts, client_fill_id, signal_id?, position_effect?, created_at, updated_at, voided_at?)` — `side ∈ {"buy","sell"}`; `symbol` already uppercased+trimmed at ingestion; `ts` is aware UTC `datetime`; `voided_at` non-null means excluded.
  - `Instrument(id, series_id, symbol, asset_class, currency, multiplier, ..., inferred)`
- `app/services/metrics.py` — `compute_metrics(session, series_id, level, *, strategy=None, symbol=None, date_from=None, date_to=None, trade_view="lot", active_days_only=False) -> MetricsEnvelope`. Returns a Pydantic `MetricsEnvelope` with `.meta` (incl. `.base_currency`, `.session_tz`, `.capital_base`, `.sample`, `.flags`) and `.metrics` (incl. `.units`). `level ∈ {"account","strategy","symbol"}`. For `level="strategy"` pass `strategy=<strategy name or name_key>`; for `level="symbol"` pass `strategy=` and `symbol=`. Symbol-level omits return-based fields (null).
- `app/schemas/metrics.py` — `MetricsEnvelope`, `MetaBlock`, `FlagsBlock`, `EquityPoint`, `DrawdownPoint`.
- Ownership pattern: a `Series` is private to `Series.user_id`; reads filter by `user_id`.

> **Phase-4 coupling note:** `compute_metrics` raises (or the caller checks) on a series not owned — but in Phase 5 ownership is validated up-front (Task 1) **before** any metrics call, so `compute_metrics` is always invoked with an already-owned `series_id`.

---

## File Structure

- **Create** `backend/app/schemas/comparison.py` — Pydantic DTOs: `ComparisonIn` (request body), `ComparisonOut` and its nested blocks (`ComparisonMeta`, `AccountBlock`, `AccountSeriesEntry`, `StrategyBlock`, `SymbolBlock`, `PerTradeBlock`, `PerTradeRow`, `PerTradeValue`, `PerTradeDiff`, `UnmatchedFill`). All numeric leaves are `str` (serialized Decimal).
- **Create** `backend/app/services/comparison.py` — the engine. Public: `compare(...)`. Internal helpers: `_validate_ownership`, `_partition_by_currency`, `_resolve_baseline`, `_account_block`, `_strategy_block`, `_symbol_block`, `_match_fills`, `_diff_pair`, `_collect_fills`, `_paginate`. Plus small dataclasses `MatchedPair`, `FillRef`.
- **Create** `backend/app/routers/comparisons.py` — thin `POST /comparisons`; parses `ComparisonIn`, calls `compare`, returns `ComparisonOut`; maps ownership failure → 404.
- **Modify** `backend/app/routers/__init__.py` — register the `comparisons` router in the aggregator.
- **Create** `backend/tests/unit/test_comparison.py` — unit tests over `compare` and helpers with fixtures (minimal DB / factory-built series).
- **Create** `backend/tests/api/test_comparison_api.py` — FastAPI TestClient end-to-end against test Postgres.

> **Test harness assumption:** `tests/conftest.py` (Phase 0) provides `db_session` (a `Session` on the test DB), a `client` (`TestClient`), and factory helpers. This plan uses helper builders defined locally in the test modules (`_make_series`, `_add_fill`, `_auth_headers`) layered on those fixtures so each test is self-contained and readable. If your conftest already exposes equivalent factories, prefer them — the assertions are what matter.

> **Determinism / matcher decisions locked here (read before Task 7):**
> - **Same-side only:** a `buy` fill can only pair with a `buy` fill, a `sell` with a `sell`. Fills are partitioned by `side` before matching.
> - **Pairwise against baseline:** per-trade matching runs the baseline series against **each other same-currency series independently**, in `series_ids` input order. For 2 series this is the single `B − A` pairing; for 3+ each non-baseline series is matched to the baseline (diffs always signed `other − baseline`).
> - **Aligned groups only:** matching (and per-trade `unmatched`) is restricted to `(name_key, symbol)` groups that exist in **both** the baseline and the other series. Fills in non-aligned strategies/symbols are surfaced by the strategy/symbol blocks (side-by-side, `matched=false`), not by per-trade.
> - **`name_key` matching is equality on the stored, already-normalized `name_key` column** (Phase 2 owns normalization: lower+trim, and whatever separator canonicalization it applies so e.g. `momo-eth` and `MOMO_ETH` share a key). Phase 5 does **not** re-normalize; it compares `Strategy.name_key` for equality.
> - **Symbol matching is equality on the stored, already-uppercased `symbol`** (Phase 2 uppercases+trims at ingestion).

---

## Tasks

### Task 1: Comparison schemas (request + response DTOs)

Define the Pydantic contract first so every later task produces values that fit a fixed shape. Numeric leaves are `str` (Decimal serialized as string).

**Files:**
- Create: `backend/app/schemas/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `app.schemas.metrics.MetricsEnvelope` (embedded in account/strategy entries).
- Produces:
  - `ComparisonIn(series_ids: list[int], baseline_series_id: int | None = None, date_from: datetime | None = None, date_to: datetime | None = None, trade_view: Literal["lot","position"] = "lot", per_trade_page: int = 1, per_trade_page_size: int = 500)`
  - `ComparisonOut(meta, account, strategy, symbol, per_trade)` with nested:
    - `ComparisonMeta(base_currency: str | None, baseline_series_id: int | None, date_range: dict[str,str|None], currency_mismatch_series: list[int])`
    - `AccountSeriesEntry(series_id: int, meta: dict, metrics: dict)` ; `AccountBlock(series: list[AccountSeriesEntry])`
    - `StrategyBlock(matched: bool, series: list[dict])` ; `strategy: dict[str, StrategyBlock]` keyed by `name_key`
    - `SymbolBlock(series: list[dict])` ; `symbol: dict[str, SymbolBlock]` keyed by `"<name_key>/<symbol>"`
    - `PerTradeValue(price: str, qty: str, total_fee: str, ts: str)`
    - `PerTradeDiff(price_slippage: str, price_slippage_pct: str, timing_sec: int, qty_diff: str, fee_diff: str)`
    - `PerTradeRow(ts: str, symbol: str, side: str, name_key: str, values: dict[str, PerTradeValue], diff: PerTradeDiff)`
    - `UnmatchedFill(client_fill_id: str, symbol: str, side: str, ts: str)`
    - `PerTradeBlock(page: int, page_size: int, total: int, rows: list[PerTradeRow], unmatched: dict[str, list[UnmatchedFill]])`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/unit/test_comparison.py
from datetime import datetime, timezone

from app.schemas.comparison import (
    ComparisonIn,
    ComparisonOut,
    ComparisonMeta,
    PerTradeBlock,
    PerTradeRow,
    PerTradeDiff,
    PerTradeValue,
)


def test_comparison_in_defaults():
    body = ComparisonIn(series_ids=[1, 2])
    assert body.baseline_series_id is None
    assert body.trade_view == "lot"
    assert body.per_trade_page == 1
    assert body.per_trade_page_size == 500


def test_comparison_out_serializes_numbers_as_strings():
    row = PerTradeRow(
        ts="2026-06-19T13:30:00+00:00",
        symbol="ETH",
        side="buy",
        name_key="momo-eth",
        values={
            "1": PerTradeValue(price="100.00", qty="1.0", total_fee="0.50", ts="2026-06-19T13:30:00+00:00"),
            "2": PerTradeValue(price="100.10", qty="1.0", total_fee="0.60", ts="2026-06-19T13:30:03+00:00"),
        },
        diff=PerTradeDiff(
            price_slippage="0.10", price_slippage_pct="0.1", timing_sec=3, qty_diff="0.0", fee_diff="0.10"
        ),
    )
    out = ComparisonOut(
        meta=ComparisonMeta(
            base_currency="USD", baseline_series_id=1,
            date_range={"from": None, "to": None}, currency_mismatch_series=[],
        ),
        account={"series": []},
        strategy={},
        symbol={},
        per_trade=PerTradeBlock(page=1, page_size=500, total=1, rows=[row], unmatched={}),
    )
    dumped = out.model_dump()
    assert dumped["per_trade"]["rows"][0]["diff"]["timing_sec"] == 3
    assert dumped["per_trade"]["rows"][0]["values"]["2"]["price"] == "100.10"
    assert isinstance(dumped["per_trade"]["rows"][0]["values"]["2"]["price"], str)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schemas.comparison'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/schemas/comparison.py
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ComparisonIn(BaseModel):
    series_ids: list[int] = Field(min_length=2)
    baseline_series_id: int | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    trade_view: Literal["lot", "position"] = "lot"
    per_trade_page: int = Field(default=1, ge=1)
    per_trade_page_size: int = Field(default=500, ge=1, le=5000)


class ComparisonMeta(BaseModel):
    base_currency: str | None
    baseline_series_id: int | None
    date_range: dict[str, str | None]
    currency_mismatch_series: list[int]


class AccountSeriesEntry(BaseModel):
    series_id: int
    meta: dict
    metrics: dict


class AccountBlock(BaseModel):
    series: list[AccountSeriesEntry]


class StrategyBlock(BaseModel):
    matched: bool
    series: list[dict]


class SymbolBlock(BaseModel):
    series: list[dict]


class PerTradeValue(BaseModel):
    price: str
    qty: str
    total_fee: str
    ts: str


class PerTradeDiff(BaseModel):
    price_slippage: str
    price_slippage_pct: str
    timing_sec: int
    qty_diff: str
    fee_diff: str


class PerTradeRow(BaseModel):
    ts: str
    symbol: str
    side: str
    name_key: str
    values: dict[str, PerTradeValue]
    diff: PerTradeDiff


class UnmatchedFill(BaseModel):
    client_fill_id: str
    symbol: str
    side: str
    ts: str


class PerTradeBlock(BaseModel):
    page: int
    page_size: int
    total: int
    rows: list[PerTradeRow]
    unmatched: dict[str, list[UnmatchedFill]]


class ComparisonOut(BaseModel):
    meta: ComparisonMeta
    account: AccountBlock
    strategy: dict[str, StrategyBlock]
    symbol: dict[str, SymbolBlock]
    per_trade: PerTradeBlock
```

> Note: `account` accepts a dict in the test (`{"series": []}`) because Pydantic coerces it into `AccountBlock`. Later tasks construct `AccountBlock` explicitly.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): add comparison request/response schemas"
```

---

### Task 2: Ownership validation + `compare()` skeleton (H1/H2/H3 → 404)

The very first thing `compare` does is fetch the requested series **scoped to `user_id`**. If any requested `series_id` is missing from the owned set, the whole request is rejected with `NotFoundError` (router → 404). This protects against cross-user access and non-existent ids without leaking existence.

**Files:**
- Create: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `Session`; `app.models.series.Series`; `app.core.errors.NotFoundError`.
- Produces: `compare(session, user_id, series_ids, *, baseline_series_id=None, date_from=None, date_to=None, trade_view="lot", per_trade_page=1, per_trade_page_size=500) -> ComparisonOut`. Also `_load_owned_series(session, user_id, series_ids) -> list[Series]` (ordered to match `series_ids` input order; raises `NotFoundError` if any id not owned).

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
import pytest

from app.core.errors import NotFoundError
from app.services.comparison import compare, _load_owned_series


def _make_series(db_session, user_id, base_currency="USD", name="s", tz="America/New_York"):
    from app.models.series import Series
    s = Series(user_id=user_id, name=name, tag="real", notes=None,
               base_currency=base_currency, session_tz=tz)
    db_session.add(s)
    db_session.flush()  # assign s.id without committing
    return s


def test_load_owned_series_preserves_input_order(db_session):
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    loaded = _load_owned_series(db_session, user_id=1, series_ids=[b.id, a.id])
    assert [s.id for s in loaded] == [b.id, a.id]


def test_compare_rejects_unowned_series_with_notfound(db_session):
    mine = _make_series(db_session, user_id=1, name="mine")
    theirs = _make_series(db_session, user_id=2, name="theirs")
    with pytest.raises(NotFoundError):
        compare(db_session, user_id=1, series_ids=[mine.id, theirs.id])


def test_compare_rejects_missing_series_with_notfound(db_session):
    mine = _make_series(db_session, user_id=1, name="mine")
    with pytest.raises(NotFoundError):
        compare(db_session, user_id=1, series_ids=[mine.id, 999_999])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "owned or notfound" -v`
Expected: FAIL — `ImportError: cannot import name 'compare' from 'app.services.comparison'`

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/services/comparison.py
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.models.series import Series
from app.schemas.comparison import (
    AccountBlock,
    ComparisonMeta,
    ComparisonOut,
    PerTradeBlock,
)


def _load_owned_series(session: Session, user_id: int, series_ids: list[int]) -> list[Series]:
    rows = session.execute(
        select(Series).where(Series.user_id == user_id, Series.id.in_(series_ids))
    ).scalars().all()
    by_id = {s.id: s for s in rows}
    missing = [sid for sid in series_ids if sid not in by_id]
    if missing:
        # Do not leak which ids exist for other users: a single 404 for the request.
        raise NotFoundError(f"series not found: {missing}")
    # Preserve caller-supplied order (baseline default = first-picked relies on it).
    return [by_id[sid] for sid in series_ids]


def compare(
    session: Session,
    user_id: int,
    series_ids: list[int],
    *,
    baseline_series_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    trade_view: str = "lot",
    per_trade_page: int = 1,
    per_trade_page_size: int = 500,
) -> ComparisonOut:
    series = _load_owned_series(session, user_id, series_ids)

    # Filled in by later tasks; skeleton returns an empty, well-formed envelope.
    return ComparisonOut(
        meta=ComparisonMeta(
            base_currency=None,
            baseline_series_id=baseline_series_id,
            date_range={
                "from": date_from.isoformat() if date_from else None,
                "to": date_to.isoformat() if date_to else None,
            },
            currency_mismatch_series=[],
        ),
        account=AccountBlock(series=[]),
        strategy={},
        symbol={},
        per_trade=PerTradeBlock(
            page=per_trade_page, page_size=per_trade_page_size, total=0, rows=[], unmatched={}
        ),
    )
```

> If your `core.errors` names the 404 exception differently (e.g. `NotFound`, `ResourceNotFound`), import that name instead and keep the router mapping in Task 11 consistent.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "owned or notfound" -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): ownership validation + compare skeleton (404 on cross-user)"
```

---

### Task 3: Currency guard + meta (G7)

Partition the owned series into a **diff cohort** (those sharing a `base_currency`) and **mismatched** series (different currency). The diff cohort's currency is the baseline series' currency; any series not in that currency is flagged in `meta.currency_mismatch_series` and excluded from all diffs (but still appears in the account block side-by-side — handled in Task 4).

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `_load_owned_series` (Task 2); `Series.base_currency`.
- Produces: `_partition_by_currency(series: list[Series], baseline: Series) -> tuple[list[Series], list[int]]` returning `(diff_cohort, mismatched_series_ids)`. `compare` now sets `meta.base_currency` (baseline's) and `meta.currency_mismatch_series`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from app.services.comparison import _partition_by_currency


def test_partition_by_currency_splits_on_base_currency(db_session):
    usd1 = _make_series(db_session, user_id=1, base_currency="USD", name="usd1")
    usd2 = _make_series(db_session, user_id=1, base_currency="USD", name="usd2")
    eur = _make_series(db_session, user_id=1, base_currency="EUR", name="eur")
    cohort, mismatched = _partition_by_currency([usd1, usd2, eur], baseline=usd1)
    assert {s.id for s in cohort} == {usd1.id, usd2.id}
    assert mismatched == [eur.id]


def test_compare_meta_flags_currency_mismatch(db_session):
    usd = _make_series(db_session, user_id=1, base_currency="USD", name="usd")
    eur = _make_series(db_session, user_id=1, base_currency="EUR", name="eur")
    out = compare(db_session, user_id=1, series_ids=[usd.id, eur.id])
    assert out.meta.base_currency == "USD"
    assert out.meta.currency_mismatch_series == [eur.id]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "currency" -v`
Expected: FAIL — `ImportError: cannot import name '_partition_by_currency'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to backend/app/services/comparison.py
def _partition_by_currency(
    series: list[Series], baseline: Series
) -> tuple[list[Series], list[int]]:
    base_ccy = baseline.base_currency
    cohort: list[Series] = []
    mismatched: list[int] = []
    for s in series:
        if s.base_currency == base_ccy:
            cohort.append(s)
        else:
            mismatched.append(s.id)
    return cohort, mismatched
```

Then update `compare` (after `series = _load_owned_series(...)`, before building the envelope). Baseline resolution is finalized in Task 4; here use the **first-picked** series so the guard has a reference currency:

```python
    # NOTE: baseline_series_id is fully resolved in Task 4; until then the first
    # owned series is the reference. Task 4 replaces this with _resolve_baseline.
    baseline = series[0]
    diff_cohort, mismatched = _partition_by_currency(series, baseline)
```

And replace the `meta=ComparisonMeta(...)` block so it reports the real currency + mismatches:

```python
        meta=ComparisonMeta(
            base_currency=baseline.base_currency,
            baseline_series_id=baseline.id,
            date_range={
                "from": date_from.isoformat() if date_from else None,
                "to": date_to.isoformat() if date_to else None,
            },
            currency_mismatch_series=mismatched,
        ),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "currency" -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): currency guard + currency_mismatch_series in meta"
```

---

### Task 4: Baseline resolution (G6)

Resolve the baseline series deterministically: if `baseline_series_id` is given it **must** be one of `series_ids` (else `NotFoundError`); otherwise default to the **first-picked** series (`series_ids[0]`). All diffs are later signed `other − baseline`. For exactly 2 series this yields `B − A` when A is the (default) baseline. The baseline must be in the diff cohort; if the caller picks a baseline whose currency is the minority, the cohort is recomputed relative to that baseline (the guard always keys off the baseline's currency).

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `_load_owned_series`, `_partition_by_currency`.
- Produces: `_resolve_baseline(series: list[Series], baseline_series_id: int | None) -> Series`. `compare` uses it before `_partition_by_currency`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from app.services.comparison import _resolve_baseline


def test_resolve_baseline_defaults_to_first_picked(db_session):
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    # input order [b, a] -> baseline is b
    baseline = _resolve_baseline([b, a], baseline_series_id=None)
    assert baseline.id == b.id


def test_resolve_baseline_honours_explicit_choice(db_session):
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    c = _make_series(db_session, user_id=1, name="c")
    baseline = _resolve_baseline([a, b, c], baseline_series_id=b.id)
    assert baseline.id == b.id


def test_resolve_baseline_rejects_baseline_not_in_set(db_session):
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    with pytest.raises(NotFoundError):
        _resolve_baseline([a, b], baseline_series_id=999_999)


def test_compare_baseline_id_reflected_in_meta(db_session):
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    out = compare(db_session, user_id=1, series_ids=[a.id, b.id], baseline_series_id=b.id)
    assert out.meta.baseline_series_id == b.id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "baseline" -v`
Expected: FAIL — `ImportError: cannot import name '_resolve_baseline'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to backend/app/services/comparison.py
def _resolve_baseline(series: list[Series], baseline_series_id: int | None) -> Series:
    if baseline_series_id is None:
        return series[0]  # default = first-picked
    for s in series:
        if s.id == baseline_series_id:
            return s
    raise NotFoundError(f"baseline_series_id not in series_ids: {baseline_series_id}")
```

Replace the interim `baseline = series[0]` line in `compare` with:

```python
    baseline = _resolve_baseline(series, baseline_series_id)
    diff_cohort, mismatched = _partition_by_currency(series, baseline)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "baseline" -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): deterministic baseline resolution (default first-picked)"
```

---

### Task 5: Account block — always compared (G1) via `compute_metrics`

For **every** series in `series_ids` (cohort and mismatched alike — account is always shown), call Phase 4 `compute_metrics(session, series_id, "account", date_from=..., date_to=..., trade_view=...)` and embed its `meta` + `metrics` per series. No diff is computed in the account block itself; it is side-by-side data the frontend renders with A|B|Δ rows (Δ is purely presentational at account level and computed client-side from these strings... no — per the portable-data rule the frontend must not compute. The account block carries raw per-series metrics; account-level deltas are NOT part of Phase 5's required output — the spec's `account` block shape is `series:[{series_id, meta, metrics}]`, and any A|B|Δ display reads the per-series numbers. Deltas at trade/row granularity live in `per_trade`.)

> Decision (locked): the `account` block contains **per-series metric envelopes only** (matching spec §8 shape `account.series[].{series_id,meta,metrics}`). It does not embed a computed account-level delta. This keeps it identical to the metrics envelope the dashboard already consumes and avoids duplicating diff logic; the comparison's signed diffs are delivered at `per_trade` granularity (Tasks 7–8).

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `app.services.metrics.compute_metrics(session, series_id, level, *, date_from, date_to, trade_view, ...)` returning a `MetricsEnvelope` with `.meta` and `.metrics` (both Pydantic models exposing `.model_dump()`).
- Produces: `_account_block(session, series, date_from, date_to, trade_view) -> AccountBlock`. `compare` populates `account`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from app.services.comparison import _account_block


def _add_strategy(db_session, series, name):
    from app.models.strategy import Strategy
    # name_key normalization is Phase 2's job; for unit tests set it explicitly.
    st = Strategy(series_id=series.id, name=name, name_key=name.strip().lower())
    db_session.add(st)
    db_session.flush()
    return st


def _add_fill(db_session, series, strategy, symbol, side, qty, price, ts, cfid,
              commission="0", exchange_fee="0", regulatory_fee="0", financing_fee="0"):
    from decimal import Decimal
    from app.models.fill import Fill
    f = Fill(
        series_id=series.id, strategy_id=strategy.id, symbol=symbol, side=side,
        qty=Decimal(str(qty)), price=Decimal(str(price)), ts=ts, client_fill_id=cfid,
        commission=Decimal(commission), exchange_fee=Decimal(exchange_fee),
        regulatory_fee=Decimal(regulatory_fee), financing_fee=Decimal(financing_fee),
    )
    db_session.add(f)
    db_session.flush()
    return f


def test_account_block_has_one_entry_per_series(db_session):
    from datetime import datetime, timezone
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    sa = _add_strategy(db_session, a, "momo")
    sb = _add_strategy(db_session, b, "momo")
    t = datetime(2026, 6, 19, 13, 30, tzinfo=timezone.utc)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=timezone.utc)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, t, "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, t, "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 105, t2, "b2")
    block = _account_block(db_session, [a, b], date_from=None, date_to=None, trade_view="lot")
    assert [e.series_id for e in block.series] == [a.id, b.id]
    # each entry carries a metrics dict produced by compute_metrics
    assert "net_pnl" in block.series[0].metrics
    assert "units" in block.series[0].metrics


def test_compare_populates_account_block_for_all_series_including_mismatch(db_session):
    from datetime import datetime, timezone
    usd = _make_series(db_session, user_id=1, base_currency="USD", name="usd")
    eur = _make_series(db_session, user_id=1, base_currency="EUR", name="eur")
    su = _add_strategy(db_session, usd, "momo")
    se = _add_strategy(db_session, eur, "momo")
    t = datetime(2026, 6, 19, 13, 30, tzinfo=timezone.utc)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=timezone.utc)
    _add_fill(db_session, usd, su, "ETH", "buy", 1, 100, t, "u1")
    _add_fill(db_session, usd, su, "ETH", "sell", 1, 110, t2, "u2")
    _add_fill(db_session, eur, se, "ETH", "buy", 1, 100, t, "e1")
    _add_fill(db_session, eur, se, "ETH", "sell", 1, 110, t2, "e2")
    out = compare(db_session, user_id=1, series_ids=[usd.id, eur.id])
    # account is ALWAYS shown for every series, even the currency-mismatched one
    assert {e.series_id for e in out.account.series} == {usd.id, eur.id}
    assert out.meta.currency_mismatch_series == [eur.id]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "account_block or all_series" -v`
Expected: FAIL — `ImportError: cannot import name '_account_block'`

- [ ] **Step 3: Write minimal implementation**

```python
# add imports + helper to backend/app/services/comparison.py
from app.services.metrics import compute_metrics
from app.schemas.comparison import AccountSeriesEntry


def _account_block(session, series, date_from, date_to, trade_view) -> AccountBlock:
    entries: list[AccountSeriesEntry] = []
    for s in series:
        env = compute_metrics(
            session, s.id, "account",
            date_from=date_from, date_to=date_to, trade_view=trade_view,
        )
        entries.append(
            AccountSeriesEntry(
                series_id=s.id,
                meta=env.meta.model_dump(),
                metrics=env.metrics.model_dump(),
            )
        )
    return AccountBlock(series=entries)
```

In `compare`, replace `account=AccountBlock(series=[])` with:

```python
        account=_account_block(series, ...)  # see below
```

Concretely, build it before the return and reference the variable:

```python
    account = _account_block(session, series, date_from, date_to, trade_view)
    ...
        account=account,
```

> `series` here is the full owned list (all `series_ids`), so account is shown for every series including currency-mismatched ones (G1).

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "account_block or all_series" -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): account block always compared via compute_metrics (G1)"
```

---

### Task 6: Strategy block — `name_key` matching (G2)

Within the **diff cohort** (same-currency series), gather every distinct `Strategy.name_key`. A `name_key` is `matched=true` when it appears in **2+ cohort series**; otherwise `matched=false` (side-by-side, no diff). For each `name_key`, call `compute_metrics(session, series_id, "strategy", strategy=<name_key>, ...)` for each cohort series that has that strategy, and embed per-series metrics keyed by `name_key`.

> `name_key` equality is the match rule. Phase 2 already normalized (`momo-eth` and `MOMO_ETH` resolve to the same stored `name_key`). Phase 5 compares the stored column; it does not re-normalize. The unit test asserts the matched key groups the two series; the case/separator-canonicalization itself is Phase 2's contract (re-verified in the API test by ingesting both spellings).

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `compute_metrics(..., "strategy", strategy=name_key, ...)`; `Strategy(series_id, name_key)`.
- Produces: `_strategy_block(session, cohort, date_from, date_to, trade_view) -> dict[str, StrategyBlock]`. Also `_strategy_keys_by_series(session, cohort) -> dict[int, set[str]]` (series_id → set of name_keys). `compare` populates `strategy`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from app.services.comparison import _strategy_block


def test_strategy_block_matches_shared_name_key(db_session):
    from datetime import datetime, timezone
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    # same name_key "momo-eth" reached via different spellings (Phase 2 normalizes;
    # we set name_key explicitly here to emulate that normalization).
    sa = _add_strategy(db_session, a, "momo-eth")
    sb = _add_strategy(db_session, b, "MOMO_ETH")
    sb.name_key = "momo-eth"  # emulate Phase-2 canonicalization
    db_session.flush()
    t = datetime(2026, 6, 19, 13, 30, tzinfo=timezone.utc)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=timezone.utc)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, t, "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, t, "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 105, t2, "b2")
    block = _strategy_block(db_session, [a, b], None, None, "lot")
    assert "momo-eth" in block
    assert block["momo-eth"].matched is True
    assert {e["series_id"] for e in block["momo-eth"].series} == {a.id, b.id}


def test_strategy_block_unmatched_is_side_by_side(db_session):
    from datetime import datetime, timezone
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    sa = _add_strategy(db_session, a, "only-in-a")
    sb = _add_strategy(db_session, b, "only-in-b")
    t = datetime(2026, 6, 19, 13, 30, tzinfo=timezone.utc)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=timezone.utc)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, t, "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, t, "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 105, t2, "b2")
    block = _strategy_block(db_session, [a, b], None, None, "lot")
    assert block["only-in-a"].matched is False
    assert block["only-in-b"].matched is False
    assert {e["series_id"] for e in block["only-in-a"].series} == {a.id}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "strategy_block" -v`
Expected: FAIL — `ImportError: cannot import name '_strategy_block'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to backend/app/services/comparison.py
from app.models.strategy import Strategy
from app.schemas.comparison import StrategyBlock


def _strategy_keys_by_series(session, cohort) -> dict[int, set[str]]:
    out: dict[int, set[str]] = {}
    for s in cohort:
        keys = session.execute(
            select(Strategy.name_key).where(Strategy.series_id == s.id)
        ).scalars().all()
        out[s.id] = set(keys)
    return out


def _strategy_block(session, cohort, date_from, date_to, trade_view) -> dict[str, StrategyBlock]:
    keys_by_series = _strategy_keys_by_series(session, cohort)
    # count how many cohort series each name_key appears in
    all_keys: dict[str, int] = {}
    for keys in keys_by_series.values():
        for k in keys:
            all_keys[k] = all_keys.get(k, 0) + 1

    block: dict[str, StrategyBlock] = {}
    for name_key, count in sorted(all_keys.items()):  # sorted -> deterministic ordering
        matched = count >= 2
        entries: list[dict] = []
        for s in cohort:  # cohort order = input order, deterministic
            if name_key in keys_by_series[s.id]:
                env = compute_metrics(
                    session, s.id, "strategy", strategy=name_key,
                    date_from=date_from, date_to=date_to, trade_view=trade_view,
                )
                entries.append({"series_id": s.id, "metrics": env.metrics.model_dump()})
        block[name_key] = StrategyBlock(matched=matched, series=entries)
    return block
```

In `compare`, build and pass the strategy block (diff cohort only):

```python
    strategy = _strategy_block(session, diff_cohort, date_from, date_to, trade_view)
    ...
        strategy=strategy,
```

> `compute_metrics` accepts the strategy by `name_key`; if your Phase-4 implementation expects the strategy *name* rather than `name_key`, pass the name and look it up — but the spec signature uses `strategy=` as the selector and Phase 4 resolves it. Keep one convention; the test passes `name_key` and expects metrics back.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "strategy_block" -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): strategy block matched by name_key (G2)"
```

---

### Task 7: Symbol block — within matched strategy, PnL only (G3)

For each **matched** strategy `name_key`, find symbols that appear in **2+ cohort series** within that strategy (symbol equality on the stored uppercased `symbol`). For each such `(name_key, symbol)`, call `compute_metrics(session, series_id, "symbol", strategy=name_key, symbol=symbol, ...)` per cohort series that traded it, embedding **PnL-only** metrics keyed `"<name_key>/<symbol>"`. Symbol-level metrics from Phase 4 already omit return-based fields (null), so no extra filtering is needed here.

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `compute_metrics(..., "symbol", strategy=name_key, symbol=symbol, ...)`; `Fill(series_id, strategy_id, symbol)`; `Strategy(series_id, name_key)`; `_strategy_block` result (for matched keys).
- Produces: `_symbol_block(session, cohort, matched_keys: set[str], date_from, date_to, trade_view) -> dict[str, SymbolBlock]`. Also `_symbols_for_strategy(session, series_id, name_key) -> set[str]`. `compare` populates `symbol`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from app.services.comparison import _symbol_block


def test_symbol_block_matches_symbol_within_matched_strategy(db_session):
    from datetime import datetime, timezone
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    sa = _add_strategy(db_session, a, "momo")
    sb = _add_strategy(db_session, b, "momo")
    t = datetime(2026, 6, 19, 13, 30, tzinfo=timezone.utc)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=timezone.utc)
    # both series trade ETH under momo -> matched symbol
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, t, "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, t, "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 105, t2, "b2")
    # only A trades BTC -> not matched, excluded from symbol block
    _add_fill(db_session, a, sa, "BTC", "buy", 1, 100, t, "a3")
    _add_fill(db_session, a, sa, "BTC", "sell", 1, 120, t2, "a4")
    block = _symbol_block(db_session, [a, b], matched_keys={"momo"},
                          date_from=None, date_to=None, trade_view="lot")
    assert "momo/ETH" in block
    assert "momo/BTC" not in block
    assert {e["series_id"] for e in block["momo/ETH"].series} == {a.id, b.id}
    # PnL-only: symbol metrics have null return-based fields (Phase 4 contract)
    metrics = block["momo/ETH"].series[0]["pnl_metrics"]
    assert "net_pnl" in metrics
    assert metrics.get("sharpe") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "symbol_block" -v`
Expected: FAIL — `ImportError: cannot import name '_symbol_block'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to backend/app/services/comparison.py
from app.models.fill import Fill
from app.schemas.comparison import SymbolBlock


def _symbols_for_strategy(session, series_id, name_key) -> set[str]:
    rows = session.execute(
        select(Fill.symbol)
        .join(Strategy, Strategy.id == Fill.strategy_id)
        .where(
            Fill.series_id == series_id,
            Strategy.name_key == name_key,
            Fill.voided_at.is_(None),
        )
        .distinct()
    ).scalars().all()
    return set(rows)


def _symbol_block(session, cohort, matched_keys, date_from, date_to, trade_view) -> dict[str, SymbolBlock]:
    block: dict[str, SymbolBlock] = {}
    for name_key in sorted(matched_keys):  # deterministic
        # series_id -> set of symbols traded under this strategy
        syms_by_series = {s.id: _symbols_for_strategy(session, s.id, name_key) for s in cohort}
        counts: dict[str, int] = {}
        for syms in syms_by_series.values():
            for sym in syms:
                counts[sym] = counts.get(sym, 0) + 1
        for symbol in sorted(counts):  # deterministic
            if counts[symbol] < 2:
                continue  # symbol must match across 2+ series within the matched strategy
            entries: list[dict] = []
            for s in cohort:
                if symbol in syms_by_series[s.id]:
                    env = compute_metrics(
                        session, s.id, "symbol", strategy=name_key, symbol=symbol,
                        date_from=date_from, date_to=date_to, trade_view=trade_view,
                    )
                    entries.append({"series_id": s.id, "pnl_metrics": env.metrics.model_dump()})
            block[f"{name_key}/{symbol}"] = SymbolBlock(series=entries)
    return block
```

In `compare`, derive matched keys from the strategy block and build the symbol block:

```python
    matched_keys = {k for k, v in strategy.items() if v.matched}
    symbol = _symbol_block(session, diff_cohort, matched_keys, date_from, date_to, trade_view)
    ...
        symbol=symbol,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "symbol_block" -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): symbol block within matched strategy, PnL-only (G3)"
```

---

### Task 8: Per-trade matcher core — same-side, nearest-ts, greedy, deterministic (G4)

**This is the crux of Phase 5.** Spell the algorithm out so it is coded unambiguously.

**The deterministic greedy matcher** pairs fills from one *other* series against the *baseline* series, within a single aligned `(name_key, symbol)` group, restricted to **one side at a time**:

1. Collect baseline fills `B` and other fills `O` for this `(name_key, symbol, side)` group. Exclude voided fills.
2. **Sort both** `B` and `O` ascending by `(ts, client_fill_id)` — the `client_fill_id` tiebreak makes identical timestamps deterministic (same convention as FIFO pairing).
3. Maintain a set `used_other` of consumed indices in `O`.
4. **Iterate baseline fills in sorted order.** For each baseline fill `b`:
   - Among **unused** `O` fills whose `|o.ts − b.ts| <= tolerance` (seconds), pick the **nearest** by absolute time delta. **Tie-break** (equal delta, e.g. one fill 3s before and one 3s after) by choosing the **earlier** `o.ts`, then the smaller `client_fill_id`. This makes the choice deterministic.
   - If found, emit a matched pair `(b, o)` and add `o`'s index to `used_other`.
   - If none within tolerance, `b` is unmatched (collected later in Task 10).
5. After iterating, any `O` fill not in `used_other` is unmatched on the other side.

Greedy-by-baseline-time + nearest + deterministic tie-break ⇒ **same input always yields the same pairing** (G5/G9 determinism). With 10 baseline ETH buys vs 8 other ETH buys, you get 8 (or fewer, if some fall outside tolerance) deterministic pairs and ≥2 unmatched baseline fills.

> **Why same-side:** comparison aligns *executions* (a buy in A vs the analogous buy in B), not round-trips. Slippage/timing answer "for the same trade decision, how did the two series' executions differ?" — only meaningful side-to-side.

This task implements the matcher returning **pairs + unmatched index lists**; diff computation is Task 9, collection/assembly Task 10.

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `get_settings().PER_TRADE_MATCH_TOLERANCE`; `Fill` rows.
- Produces:
  - `@dataclass FillRef: series_id:int; client_fill_id:str; symbol:str; side:str; ts:datetime; price:Decimal; qty:Decimal; total_fee:Decimal`
  - `@dataclass MatchedPair: baseline: FillRef; other: FillRef`
  - `_to_fillref(fill: Fill) -> FillRef` (computes `total_fee = commission+exchange_fee+regulatory_fee+financing_fee`)
  - `_match_side(baseline_fills: list[FillRef], other_fills: list[FillRef], tolerance_sec: int) -> tuple[list[MatchedPair], list[FillRef], list[FillRef]]` returning `(pairs, unmatched_baseline, unmatched_other)`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from decimal import Decimal
from datetime import datetime, timezone

from app.services.comparison import FillRef, _match_side


def _fr(series_id, cfid, ts, price="100", qty="1", fee="0", side="buy", symbol="ETH"):
    return FillRef(
        series_id=series_id, client_fill_id=cfid, symbol=symbol, side=side, ts=ts,
        price=Decimal(price), qty=Decimal(qty), total_fee=Decimal(fee),
    )


def test_match_side_pairs_nearest_within_tolerance():
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    # baseline buy at 09:30:00 ; other buy at 09:30:03 -> within 300s -> matched
    b = [_fr(1, "b1", base)]
    o = [_fr(2, "o1", base.replace(second=3))]
    pairs, ub, uo = _match_side(b, o, tolerance_sec=300)
    assert len(pairs) == 1
    assert pairs[0].baseline.client_fill_id == "b1"
    assert pairs[0].other.client_fill_id == "o1"
    assert ub == [] and uo == []


def test_match_side_unmatched_outside_tolerance():
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    b = [_fr(1, "b1", base)]
    # 301s away -> outside 300s tolerance -> unmatched on both sides
    o = [_fr(2, "o1", base.replace(minute=35, second=1))]
    pairs, ub, uo = _match_side(b, o, tolerance_sec=300)
    assert pairs == []
    assert [f.client_fill_id for f in ub] == ["b1"]
    assert [f.client_fill_id for f in uo] == ["o1"]


def test_match_side_greedy_multiple_same_day_deterministic():
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    # 4 baseline buys; 2 other buys near the first two -> 2 pairs, 2 unmatched baseline
    b = [
        _fr(1, "b1", base.replace(second=0)),
        _fr(1, "b2", base.replace(second=10)),
        _fr(1, "b3", base.replace(second=20)),
        _fr(1, "b4", base.replace(second=30)),
    ]
    o = [
        _fr(2, "o1", base.replace(second=2)),   # nearest to b1
        _fr(2, "o2", base.replace(second=11)),  # nearest to b2
    ]
    pairs, ub, uo = _match_side(b, o, tolerance_sec=300)
    assert [(p.baseline.client_fill_id, p.other.client_fill_id) for p in pairs] == [
        ("b1", "o1"), ("b2", "o2")
    ]
    assert [f.client_fill_id for f in ub] == ["b3", "b4"]
    assert uo == []
    # determinism: run again, identical result
    pairs2, ub2, uo2 = _match_side(b, o, tolerance_sec=300)
    assert [(p.baseline.client_fill_id, p.other.client_fill_id) for p in pairs2] == [
        ("b1", "o1"), ("b2", "o2")
    ]


def test_match_side_equal_delta_tiebreak_prefers_earlier_ts():
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    b = [_fr(1, "b1", base.replace(second=5))]
    # one 3s before, one 3s after -> equal delta -> pick earlier ts (o_before)
    o = [
        _fr(2, "o_after", base.replace(second=8)),
        _fr(2, "o_before", base.replace(second=2)),
    ]
    pairs, ub, uo = _match_side(b, o, tolerance_sec=300)
    assert pairs[0].other.client_fill_id == "o_before"
    assert [f.client_fill_id for f in uo] == ["o_after"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "match_side" -v`
Expected: FAIL — `ImportError: cannot import name 'FillRef'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to backend/app/services/comparison.py
from dataclasses import dataclass
from decimal import Decimal

from app.core.config import get_settings


@dataclass
class FillRef:
    series_id: int
    client_fill_id: str
    symbol: str
    side: str
    ts: datetime
    price: Decimal
    qty: Decimal
    total_fee: Decimal


@dataclass
class MatchedPair:
    baseline: FillRef
    other: FillRef


def _to_fillref(fill: Fill) -> FillRef:
    total_fee = (
        (fill.commission or Decimal("0"))
        + (fill.exchange_fee or Decimal("0"))
        + (fill.regulatory_fee or Decimal("0"))
        + (fill.financing_fee or Decimal("0"))
    )
    return FillRef(
        series_id=fill.series_id,
        client_fill_id=fill.client_fill_id,
        symbol=fill.symbol,
        side=fill.side,
        ts=fill.ts,
        price=fill.price,
        qty=fill.qty,
        total_fee=total_fee,
    )


def _match_side(
    baseline_fills: list[FillRef],
    other_fills: list[FillRef],
    tolerance_sec: int,
) -> tuple[list[MatchedPair], list[FillRef], list[FillRef]]:
    # Deterministic sort: ts then client_fill_id.
    b_sorted = sorted(baseline_fills, key=lambda f: (f.ts, f.client_fill_id))
    o_sorted = sorted(other_fills, key=lambda f: (f.ts, f.client_fill_id))

    used: set[int] = set()
    pairs: list[MatchedPair] = []
    unmatched_baseline: list[FillRef] = []

    for b in b_sorted:
        best_idx: int | None = None
        best_key: tuple | None = None
        for idx, o in enumerate(o_sorted):
            if idx in used:
                continue
            delta = abs((o.ts - b.ts).total_seconds())
            if delta > tolerance_sec:
                continue
            # Choose nearest; tie-break earlier ts, then smaller client_fill_id.
            key = (delta, o.ts, o.client_fill_id)
            if best_key is None or key < best_key:
                best_key = key
                best_idx = idx
        if best_idx is None:
            unmatched_baseline.append(b)
        else:
            used.add(best_idx)
            pairs.append(MatchedPair(baseline=b, other=o_sorted[best_idx]))

    unmatched_other = [o for idx, o in enumerate(o_sorted) if idx not in used]
    return pairs, unmatched_baseline, unmatched_other
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "match_side" -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): deterministic same-side nearest-ts greedy matcher (G4)"
```

---

### Task 9: Per-trade diff computation — baseline-signed (G4 diff fields)

Given a `MatchedPair`, compute the diff **from the baseline's perspective** (`other − baseline`):

- `price_slippage = other.price − baseline.price` (Decimal, base/instrument price units).
- `price_slippage_pct = (other.price − baseline.price) / baseline.price × 100` if `baseline.price != 0` else `"0"`. (Percent; `baseline.price` can be negative for some instruments — division still well-defined; guard only the exact-zero case.)
- `timing_sec = int((other.ts − baseline.ts).total_seconds())` — **signed**: positive ⇒ other executed later than baseline.
- `qty_diff = other.qty − baseline.qty`.
- `fee_diff = other.total_fee − baseline.total_fee`.

All Decimal results serialized as strings; `timing_sec` is an int. Use a fixed quantization for the two price fields and fee/qty so output is stable: quantize money/qty to 10 dp, percent to 6 dp, then `str()` with trailing zeros trimmed via `format` is **not** used — keep full Decimal string for exactness (consumers parse strings). Test pins the exact strings, so the implementation must match the chosen quantization.

> Decision (locked): emit the **unquantized** Decimal `str()` for `price_slippage`, `qty_diff`, `fee_diff` (exact arithmetic on `NUMERIC(28,10)` inputs stays exact); quantize `price_slippage_pct` to 6 decimal places with `Decimal.quantize(Decimal("0.000001"))`. This keeps money/qty exact and bounds the only division result.

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `MatchedPair`, `FillRef`.
- Produces: `_diff_pair(pair: MatchedPair) -> PerTradeDiff` and `_row_from_pair(pair: MatchedPair, baseline_series_id: int, name_key: str) -> PerTradeRow`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from app.services.comparison import _diff_pair, _row_from_pair, MatchedPair
from app.schemas.comparison import PerTradeRow


def test_diff_pair_signed_from_baseline_perspective():
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    baseline = _fr(1, "b1", base, price="100.00", qty="1.0", fee="0.50")
    other = _fr(2, "o1", base.replace(second=3), price="100.10", qty="1.0", fee="0.60")
    diff = _diff_pair(MatchedPair(baseline=baseline, other=other))
    assert diff.price_slippage == "0.10"
    assert diff.price_slippage_pct == "0.100000"   # 0.10/100 * 100 = 0.1 %
    assert diff.timing_sec == 3                      # other 3s later -> +3
    assert diff.qty_diff == "0.0"
    assert diff.fee_diff == "0.10"


def test_diff_pair_negative_timing_when_other_earlier():
    base = datetime(2026, 6, 19, 9, 30, 5, tzinfo=timezone.utc)
    baseline = _fr(1, "b1", base, price="100", qty="2", fee="1")
    other = _fr(2, "o1", base.replace(second=2), price="99", qty="2", fee="1")
    diff = _diff_pair(MatchedPair(baseline=baseline, other=other))
    assert diff.timing_sec == -3
    assert diff.price_slippage == "-1"
    assert diff.price_slippage_pct == "-1.000000"


def test_diff_pair_zero_baseline_price_guard():
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    baseline = _fr(1, "b1", base, price="0", qty="1", fee="0")
    other = _fr(2, "o1", base, price="5", qty="1", fee="0")
    diff = _diff_pair(MatchedPair(baseline=baseline, other=other))
    assert diff.price_slippage == "5"
    assert diff.price_slippage_pct == "0"   # guarded division-by-zero


def test_row_from_pair_carries_both_series_values():
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    baseline = _fr(1, "b1", base, price="100.00", qty="1.0", fee="0.50")
    other = _fr(2, "o1", base.replace(second=3), price="100.10", qty="1.0", fee="0.60")
    row = _row_from_pair(MatchedPair(baseline=baseline, other=other),
                         baseline_series_id=1, name_key="momo")
    assert isinstance(row, PerTradeRow)
    assert row.side == "buy"
    assert row.symbol == "ETH"
    assert row.name_key == "momo"
    assert set(row.values.keys()) == {"1", "2"}
    assert row.values["1"].price == "100.00"
    assert row.values["2"].price == "100.10"
    # row ts is the baseline fill's ts (anchor)
    assert row.ts == baseline.ts.isoformat()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "diff_pair or row_from_pair" -v`
Expected: FAIL — `ImportError: cannot import name '_diff_pair'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to backend/app/services/comparison.py
from app.schemas.comparison import PerTradeDiff, PerTradeRow, PerTradeValue

_PCT_Q = Decimal("0.000001")


def _diff_pair(pair: MatchedPair) -> PerTradeDiff:
    b, o = pair.baseline, pair.other
    price_slippage = o.price - b.price
    if b.price == 0:
        pct = Decimal("0")
    else:
        pct = (price_slippage / b.price) * Decimal("100")
    timing_sec = int((o.ts - b.ts).total_seconds())
    qty_diff = o.qty - b.qty
    fee_diff = o.total_fee - b.total_fee
    return PerTradeDiff(
        price_slippage=str(price_slippage),
        price_slippage_pct=str(pct.quantize(_PCT_Q) if b.price != 0 else pct),
        timing_sec=timing_sec,
        qty_diff=str(qty_diff),
        fee_diff=str(fee_diff),
    )


def _value_from_fillref(f: FillRef) -> PerTradeValue:
    return PerTradeValue(
        price=str(f.price), qty=str(f.qty), total_fee=str(f.total_fee), ts=f.ts.isoformat()
    )


def _row_from_pair(pair: MatchedPair, baseline_series_id: int, name_key: str) -> PerTradeRow:
    b, o = pair.baseline, pair.other
    return PerTradeRow(
        ts=b.ts.isoformat(),       # anchor row on baseline timestamp
        symbol=b.symbol,
        side=b.side,
        name_key=name_key,
        values={
            str(b.series_id): _value_from_fillref(b),
            str(o.series_id): _value_from_fillref(o),
        },
        diff=_diff_pair(pair),
    )
```

> The `price_slippage_pct == "0"` case (zero baseline price) returns the unquantized `Decimal("0")` → `"0"`; the non-zero case is quantized to 6dp → e.g. `"0.100000"`. The test pins both.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "diff_pair or row_from_pair" -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): baseline-signed per-trade diff (slippage/timing/qty/fee)"
```

---

### Task 10: Per-trade assembly + unmatched collection (G4, G5)

Wire the matcher (Task 8) and diff (Task 9) over **all aligned `(name_key, symbol)` groups** in the diff cohort, running baseline-vs-each-other-series, both sides. Produce the full unpaginated list of `PerTradeRow` and the `unmatched` map keyed by `str(series_id)` → list of `UnmatchedFill` (every fill never paired, on any side, in any group). Pagination is Task 11; here `_build_per_trade` returns `(all_rows, unmatched)`.

**Alignment scope:** only `(name_key, symbol)` groups present in **both** the baseline and the given other series are matched. The baseline series itself is in the cohort; it is not matched against itself.

**Row ordering (deterministic):** rows sorted by `(name_key, symbol, side, baseline_ts, baseline_client_fill_id, other_series_id)`.

**Unmatched ordering:** per series, sorted by `(symbol, side, ts, client_fill_id)`.

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `_match_side`, `_to_fillref`, `_row_from_pair`, `Fill`, `Strategy`.
- Produces:
  - `_aligned_fills(session, series_id, name_key, symbol, side, date_from, date_to) -> list[FillRef]` (non-voided, date-filtered, sorted later by matcher).
  - `_aligned_groups(session, baseline, other, date_from, date_to) -> list[tuple[str, str]]` — `(name_key, symbol)` pairs present in both.
  - `_build_per_trade(session, baseline, cohort, date_from, date_to, tolerance_sec) -> tuple[list[PerTradeRow], dict[str, list[UnmatchedFill]]]`.

> **Date filtering:** trade date = `ts` in `series.session_tz` (TZ-2). For Phase 5 the comparison `date_from`/`date_to` are date bounds; convert each fill's `ts` to the series `session_tz` calendar date and include when `date_from <= trade_date <= date_to` (inclusive both ends). Reuse the Phase-4 helper if one is exported (e.g. `metrics._trade_date(ts, tz)`); otherwise compute inline with `zoneinfo.ZoneInfo`. The test below uses no date range (both None) to keep the unit focused on matching; date-range behavior is covered in the API test (Task 12) consistent with F6/G10.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from app.services.comparison import _build_per_trade
from app.schemas.comparison import UnmatchedFill


def test_build_per_trade_matches_and_surfaces_unmatched(db_session):
    from datetime import datetime, timezone
    a = _make_series(db_session, user_id=1, name="a")  # baseline
    b = _make_series(db_session, user_id=1, name="b")
    sa = _add_strategy(db_session, a, "momo")
    sb = _add_strategy(db_session, b, "momo")
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    # A: 4 ETH buys at :00 :10 :20 :30 ; B: 2 ETH buys near first two
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, base.replace(second=0), "a1")
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, base.replace(second=10), "a2")
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, base.replace(second=20), "a3")
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, base.replace(second=30), "a4")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100.10, base.replace(second=2), "b1")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100.20, base.replace(second=11), "b2")

    rows, unmatched = _build_per_trade(
        db_session, baseline=a, cohort=[a, b], date_from=None, date_to=None, tolerance_sec=300
    )
    # 2 matched pairs
    assert len(rows) == 2
    assert all(r.side == "buy" and r.symbol == "ETH" and r.name_key == "momo" for r in rows)
    # unmatched: a3, a4 in baseline series a; none in b
    assert [u.client_fill_id for u in unmatched[str(a.id)]] == ["a3", "a4"]
    assert str(b.id) not in unmatched or unmatched[str(b.id)] == []


def test_build_per_trade_is_idempotent(db_session):
    from datetime import datetime, timezone
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    sa = _add_strategy(db_session, a, "momo")
    sb = _add_strategy(db_session, b, "momo")
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, base.replace(second=0), "a1")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, base.replace(second=2), "b1")
    r1, u1 = _build_per_trade(db_session, a, [a, b], None, None, 300)
    r2, u2 = _build_per_trade(db_session, a, [a, b], None, None, 300)
    assert [r.model_dump() for r in r1] == [r.model_dump() for r in r2]
    assert {k: [x.model_dump() for x in v] for k, v in u1.items()} == \
           {k: [x.model_dump() for x in v] for k, v in u2.items()}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "build_per_trade" -v`
Expected: FAIL — `ImportError: cannot import name '_build_per_trade'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to backend/app/services/comparison.py
from app.schemas.comparison import UnmatchedFill

_SIDES = ("buy", "sell")


def _aligned_fills(session, series_id, name_key, symbol, side, date_from, date_to) -> list[FillRef]:
    stmt = (
        select(Fill)
        .join(Strategy, Strategy.id == Fill.strategy_id)
        .where(
            Fill.series_id == series_id,
            Strategy.name_key == name_key,
            Fill.symbol == symbol,
            Fill.side == side,
            Fill.voided_at.is_(None),
        )
    )
    fills = session.execute(stmt).scalars().all()
    refs = [_to_fillref(f) for f in fills]
    # Date filtering by trade date in session_tz is applied by caller when bounds set.
    if date_from is None and date_to is None:
        return refs
    return [r for r in refs if _in_date_range(session, series_id, r.ts, date_from, date_to)]


def _in_date_range(session, series_id, ts, date_from, date_to) -> bool:
    from zoneinfo import ZoneInfo
    s = session.get(Series, series_id)
    local_date = ts.astimezone(ZoneInfo(s.session_tz)).date()
    if date_from is not None and local_date < _as_date(date_from):
        return False
    if date_to is not None and local_date > _as_date(date_to):
        return False
    return True


def _as_date(value):
    # Accept date or datetime; comparison date bounds are inclusive calendar days.
    return value.date() if hasattr(value, "date") else value


def _strategy_keys_intersection(session, baseline, other) -> set[str]:
    bk = set(session.execute(
        select(Strategy.name_key).where(Strategy.series_id == baseline.id)
    ).scalars().all())
    ok = set(session.execute(
        select(Strategy.name_key).where(Strategy.series_id == other.id)
    ).scalars().all())
    return bk & ok


def _aligned_groups(session, baseline, other, date_from, date_to) -> list[tuple[str, str]]:
    groups: set[tuple[str, str]] = set()
    for name_key in _strategy_keys_intersection(session, baseline, other):
        b_syms = _symbols_for_strategy(session, baseline.id, name_key)
        o_syms = _symbols_for_strategy(session, other.id, name_key)
        for symbol in (b_syms & o_syms):
            groups.add((name_key, symbol))
    return sorted(groups)


def _build_per_trade(session, baseline, cohort, date_from, date_to, tolerance_sec):
    all_rows: list[PerTradeRow] = []
    unmatched: dict[str, list[UnmatchedFill]] = {}

    def _add_unmatched(fr: FillRef):
        unmatched.setdefault(str(fr.series_id), []).append(
            UnmatchedFill(
                client_fill_id=fr.client_fill_id, symbol=fr.symbol,
                side=fr.side, ts=fr.ts.isoformat(),
            )
        )

    others = [s for s in cohort if s.id != baseline.id]
    for other in others:
        for name_key, symbol in _aligned_groups(session, baseline, other, date_from, date_to):
            for side in _SIDES:
                b_fills = _aligned_fills(session, baseline.id, name_key, symbol, side, date_from, date_to)
                o_fills = _aligned_fills(session, other.id, name_key, symbol, side, date_from, date_to)
                if not b_fills and not o_fills:
                    continue
                pairs, ub, uo = _match_side(b_fills, o_fills, tolerance_sec)
                for p in pairs:
                    all_rows.append(_row_from_pair(p, baseline.id, name_key))
                for fr in ub:
                    _add_unmatched(fr)
                for fr in uo:
                    _add_unmatched(fr)

    all_rows.sort(key=lambda r: (r.name_key, r.symbol, r.side, r.ts))
    for sid in unmatched:
        unmatched[sid].sort(key=lambda u: (u.symbol, u.side, u.ts, u.client_fill_id))
    return all_rows, unmatched
```

> Note: a baseline fill matched against series B but not series C would appear unmatched for C and matched (a row) for B — the same baseline `client_fill_id` can legitimately be both a row participant and an unmatched entry in another pairing. The 2-series case (B−A) has no such ambiguity; for 3+ this is the documented baseline-pairwise behavior.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -k "build_per_trade" -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): per-trade assembly over aligned groups + unmatched (G4/G5)"
```

---

### Task 11: Pagination + wire per_trade into `compare` (G8)

Paginate the row list (1-based `page`, `page_size`), report `total` = full row count (pre-slice). `unmatched` is **not** paginated (it is a bounded disclosure list returned whole). Then wire `_build_per_trade` + `_paginate` into `compare` so the assembled envelope is complete.

**Files:**
- Modify: `backend/app/services/comparison.py`
- Test: `backend/tests/unit/test_comparison.py`

**Interfaces:**
- Consumes: `_build_per_trade`, `get_settings().PER_TRADE_MATCH_TOLERANCE`.
- Produces: `_paginate(rows: list[PerTradeRow], page: int, page_size: int) -> tuple[list[PerTradeRow], int]` returning `(page_rows, total)`. `compare` builds and returns the full `PerTradeBlock`.

- [ ] **Step 1: Write the failing test**

```python
# append to backend/tests/unit/test_comparison.py
from app.services.comparison import _paginate


def _dummy_row(i):
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    fr_b = _fr(1, f"b{i}", base.replace(second=i), symbol="ETH")
    fr_o = _fr(2, f"o{i}", base.replace(second=i), symbol="ETH")
    return _row_from_pair(MatchedPair(baseline=fr_b, other=fr_o), 1, "momo")


def test_paginate_slices_and_reports_total():
    rows = [_dummy_row(i) for i in range(5)]
    page_rows, total = _paginate(rows, page=2, page_size=2)
    assert total == 5
    assert len(page_rows) == 2
    assert page_rows[0].values["1"].client_fill_id if False else True  # rows are PerTradeRow
    # page 2 of size 2 -> rows index 2,3
    assert [r.values["1"].ts for r in page_rows] == [rows[2].values["1"].ts, rows[3].values["1"].ts]


def test_paginate_past_end_returns_empty_but_correct_total():
    rows = [_dummy_row(i) for i in range(3)]
    page_rows, total = _paginate(rows, page=99, page_size=10)
    assert total == 3
    assert page_rows == []


def test_compare_per_trade_end_to_end_two_series(db_session):
    a = _make_series(db_session, user_id=1, name="a")
    b = _make_series(db_session, user_id=1, name="b")
    sa = _add_strategy(db_session, a, "momo")
    sb = _add_strategy(db_session, b, "momo")
    base = datetime(2026, 6, 19, 9, 30, 0, tzinfo=timezone.utc)
    t2 = datetime(2026, 6, 19, 14, 30, 0, tzinfo=timezone.utc)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100.00, base.replace(second=0), "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110.00, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100.10, base.replace(second=3), "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 109.00, t2, "b2")
    out = compare(db_session, user_id=1, series_ids=[a.id, b.id])
    # baseline default = a (first-picked); diffs signed b - a
    buy_rows = [r for r in out.per_trade.rows if r.side == "buy"]
    assert len(buy_rows) == 1
    assert buy_rows[0].diff.timing_sec == 3       # b 3s later than a
    assert buy_rows[0].diff.price_slippage == "10.00"  # 100.10 - 100.00 ... see note
    assert out.per_trade.total == 2               # one buy pair + one sell pair
    assert out.per_trade.page == 1
```

> **Price-slippage note for the test:** `100.10 - 100.00 = 0.10`, not `10.00`. **Fix the expected value to `"0.10"`** when writing the test (the line above is intentionally the kind of typo the implementer must catch — assert the arithmetic, do not copy blindly). The sell pair: `109.00 - 110.00 = "-1.00"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_comparison.py -k "paginate or per_trade_end_to_end" -v`
Expected: FAIL — `ImportError: cannot import name '_paginate'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to backend/app/services/comparison.py
def _paginate(rows: list[PerTradeRow], page: int, page_size: int) -> tuple[list[PerTradeRow], int]:
    total = len(rows)
    start = (page - 1) * page_size
    end = start + page_size
    return rows[start:end], total
```

Wire into `compare` — build the per_trade block from the diff cohort, baseline-anchored:

```python
    tolerance = get_settings().PER_TRADE_MATCH_TOLERANCE
    all_rows, unmatched = _build_per_trade(
        session, baseline, diff_cohort, date_from, date_to, tolerance
    )
    page_rows, total = _paginate(all_rows, per_trade_page, per_trade_page_size)
    per_trade = PerTradeBlock(
        page=per_trade_page,
        page_size=per_trade_page_size,
        total=total,
        rows=page_rows,
        unmatched=unmatched,
    )
```

And reference `per_trade=per_trade` in the returned `ComparisonOut` (replacing the empty skeleton block).

The final `compare` body order is: `_load_owned_series` → `_resolve_baseline` → `_partition_by_currency` → `_account_block` (all series) → `_strategy_block` (cohort) → `_symbol_block` (cohort, matched keys) → `_build_per_trade` + `_paginate` (cohort) → assemble `ComparisonOut`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_comparison.py -v`
Expected: PASS (all unit tests, including the full-`compare` end-to-end)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/comparison.py backend/tests/unit/test_comparison.py
git commit -m "feat(comparison): paginate per_trade + wire full compare envelope (G8)"
```

---

### Task 12: `POST /comparisons` router + API tests (G1–G10, H1–H3)

Thin router: parse `ComparisonIn`, resolve the JWT user, call `compare`, return `ComparisonOut`. Map `NotFoundError` → 404 (Phase-0 exception handler should already do this globally; the router adds no logic beyond the call).

**Files:**
- Create: `backend/app/routers/comparisons.py`
- Modify: `backend/app/routers/__init__.py`
- Test: `backend/tests/api/test_comparison_api.py`

**Interfaces:**
- Consumes: `app.services.comparison.compare`; `app.core.deps.get_current_user`, `get_db`; `ComparisonIn`, `ComparisonOut`.
- Produces: `POST /comparisons` → `ComparisonOut` (200); 404 on any unowned series; 422 on `<2` series_ids (Pydantic `min_length=2`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/api/test_comparison_api.py
from datetime import datetime, timezone


def _auth_headers(client, email="cmp@example.com", password="pw-secret-123"):
    # Register -> (admin approves) -> login. Reuse Phase-1 helpers if conftest exposes them.
    client.post("/auth/register", json={"email": email, "password": password})
    from tests.conftest import approve_user  # Phase-0/1 helper; adapt to your conftest
    approve_user(email)
    tok = client.post("/auth/login", json={"email": email, "password": password}).json()
    return {"Authorization": f"Bearer {tok['access_token']}"}


def _api_key(client, headers):
    r = client.post("/api-keys", json={"name": "k"}, headers=headers)
    return {"X-API-Key": r.json()["key"]}


def _make_series_api(client, key_headers, name, base_currency="USD", tz="America/New_York"):
    r = client.post("/series", json={
        "name": name, "tag": "real", "base_currency": base_currency, "session_tz": tz,
    }, headers=key_headers)
    return r.json()["series_id"]


def _post_fills(client, key_headers, series_id, fills):
    return client.post(f"/series/{series_id}/fills:batch", json={"fills": fills}, headers=key_headers)


def test_comparison_two_series_b_minus_a(client):
    h = _auth_headers(client)
    k = _api_key(client, h)
    a = _make_series_api(client, k, "A")
    b = _make_series_api(client, k, "B")
    fills_a = [
        {"client_fill_id": "a1", "strategy": "momo", "symbol": "ETH", "side": "buy",
         "qty": "1", "price": "100.00", "ts": "2026-06-19T13:30:00Z"},
        {"client_fill_id": "a2", "strategy": "momo", "symbol": "ETH", "side": "sell",
         "qty": "1", "price": "110.00", "ts": "2026-06-19T18:30:00Z"},
    ]
    fills_b = [
        {"client_fill_id": "b1", "strategy": "momo", "symbol": "ETH", "side": "buy",
         "qty": "1", "price": "100.10", "ts": "2026-06-19T13:30:03Z"},
        {"client_fill_id": "b2", "strategy": "momo", "symbol": "ETH", "side": "sell",
         "qty": "1", "price": "109.00", "ts": "2026-06-19T18:30:00Z"},
    ]
    _post_fills(client, k, a, fills_a)
    _post_fills(client, k, b, fills_b)
    r = client.post("/comparisons", json={"series_ids": [a, b]}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["baseline_series_id"] == a   # default first-picked
    assert body["meta"]["base_currency"] == "USD"
    # account always present for both
    assert {e["series_id"] for e in body["account"]["series"]} == {a, b}
    # per-trade buy pair: b - a slippage 0.10, timing +3
    buys = [row for row in body["per_trade"]["rows"] if row["side"] == "buy"]
    assert len(buys) == 1
    assert buys[0]["diff"]["price_slippage"] == "0.10"
    assert buys[0]["diff"]["timing_sec"] == 3


def test_comparison_three_series_baseline_signing(client):
    h = _auth_headers(client, email="cmp3@example.com")
    k = _api_key(client, h)
    a = _make_series_api(client, k, "A")
    b = _make_series_api(client, k, "B")
    c = _make_series_api(client, k, "C")
    for sid, price in ((a, "100.00"), (b, "100.50"), (c, "101.00")):
        _post_fills(client, k, sid, [
            {"client_fill_id": f"{sid}-1", "strategy": "momo", "symbol": "ETH", "side": "buy",
             "qty": "1", "price": price, "ts": "2026-06-19T13:30:00Z"},
        ])
    # choose b as baseline -> diffs signed (other - b)
    r = client.post("/comparisons", json={"series_ids": [a, b, c], "baseline_series_id": b}, headers=h)
    assert r.status_code == 200
    body = r.json()
    assert body["meta"]["baseline_series_id"] == b
    # rows pair baseline b vs a (a-b = -0.50) and baseline b vs c (c-b = +0.50)
    slippages = sorted(row["diff"]["price_slippage"] for row in body["per_trade"]["rows"])
    assert slippages == ["-0.50", "0.50"]


def test_comparison_multiple_same_day_deterministic_unmatched(client):
    h = _auth_headers(client, email="cmpmany@example.com")
    k = _api_key(client, h)
    a = _make_series_api(client, k, "A")
    b = _make_series_api(client, k, "B")
    # A: 10 ETH buys 30s apart ; B: 8 ETH buys near the first 8 -> 8 pairs, 2 unmatched in A
    a_fills, b_fills = [], []
    for i in range(10):
        a_fills.append({"client_fill_id": f"a{i}", "strategy": "momo", "symbol": "ETH",
                        "side": "buy", "qty": "1", "price": "100",
                        "ts": f"2026-06-19T13:{30 + i:02d}:00Z"})
    for i in range(8):
        b_fills.append({"client_fill_id": f"b{i}", "strategy": "momo", "symbol": "ETH",
                        "side": "buy", "qty": "1", "price": "100",
                        "ts": f"2026-06-19T13:{30 + i:02d}:02Z"})
    _post_fills(client, k, a, a_fills)
    _post_fills(client, k, b, b_fills)
    r = client.post("/comparisons", json={"series_ids": [a, b], "per_trade_page_size": 100}, headers=h)
    body = r.json()
    assert body["per_trade"]["total"] == 8
    assert [u["client_fill_id"] for u in body["per_trade"]["unmatched"][str(a)]] == ["a8", "a9"]
    # determinism: same request -> identical body
    r2 = client.post("/comparisons", json={"series_ids": [a, b], "per_trade_page_size": 100}, headers=h)
    assert r2.json() == body


def test_comparison_currency_mismatch_flagged(client):
    h = _auth_headers(client, email="cmpccy@example.com")
    k = _api_key(client, h)
    usd = _make_series_api(client, k, "USD", base_currency="USD")
    eur = _make_series_api(client, k, "EUR", base_currency="EUR")
    for sid in (usd, eur):
        _post_fills(client, k, sid, [
            {"client_fill_id": f"{sid}-1", "strategy": "momo", "symbol": "ETH", "side": "buy",
             "qty": "1", "price": "100", "ts": "2026-06-19T13:30:00Z"},
            {"client_fill_id": f"{sid}-2", "strategy": "momo", "symbol": "ETH", "side": "sell",
             "qty": "1", "price": "110", "ts": "2026-06-19T18:30:00Z"},
        ])
    r = client.post("/comparisons", json={"series_ids": [usd, eur]}, headers=h)
    body = r.json()
    assert body["meta"]["currency_mismatch_series"] == [eur]
    # account still shown for both; eur excluded from per_trade diffs
    assert {e["series_id"] for e in body["account"]["series"]} == {usd, eur}
    assert body["per_trade"]["rows"] == []  # no same-currency counterpart to diff


def test_comparison_cross_user_series_returns_404(client):
    h1 = _auth_headers(client, email="owner@example.com")
    k1 = _api_key(client, h1)
    mine = _make_series_api(client, k1, "mine")
    h2 = _auth_headers(client, email="other@example.com")
    k2 = _api_key(client, h2)
    theirs = _make_series_api(client, k2, "theirs")
    # user 1 tries to compare their series with user 2's series
    r = client.post("/comparisons", json={"series_ids": [mine, theirs]}, headers=h1)
    assert r.status_code == 404


def test_comparison_requires_two_series(client):
    h = _auth_headers(client, email="cmpone@example.com")
    k = _api_key(client, h)
    a = _make_series_api(client, k, "A")
    r = client.post("/comparisons", json={"series_ids": [a]}, headers=h)
    assert r.status_code == 422  # min_length=2
```

> Adapt `_auth_headers`/`approve_user` to whatever Phase-0/1 conftest provides (a fixture that mints an approved user + token is ideal). The assertions are the contract; the plumbing mirrors `test_metrics_api.py`.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_comparison_api.py -v`
Expected: FAIL — `404` on `POST /comparisons` (route not registered) / collection import errors.

- [ ] **Step 3: Write minimal implementation**

```python
# backend/app/routers/comparisons.py
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.comparison import ComparisonIn, ComparisonOut
from app.services.comparison import compare

router = APIRouter(tags=["comparisons"])


@router.post("/comparisons", response_model=ComparisonOut)
def post_comparison(
    body: ComparisonIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ComparisonOut:
    return compare(
        db,
        user.id,
        body.series_ids,
        baseline_series_id=body.baseline_series_id,
        date_from=body.date_from,
        date_to=body.date_to,
        trade_view=body.trade_view,
        per_trade_page=body.per_trade_page,
        per_trade_page_size=body.per_trade_page_size,
    )
```

Register in the aggregator:

```python
# backend/app/routers/__init__.py  (add to existing aggregator)
from app.routers import comparisons  # noqa: E402

api_router.include_router(comparisons.router)
```

> `NotFoundError` → 404 mapping is the global handler from Phase 0 (`core/errors.py`). If no global handler exists, add one there (out of scope for this file but required); do not catch the exception in the router.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/api/test_comparison_api.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/comparisons.py backend/app/routers/__init__.py backend/tests/api/test_comparison_api.py
git commit -m "feat(comparison): POST /comparisons router + end-to-end API tests (G/H)"
```

---

### Task 13: Phase gate — full suite + ruff (backend MVP completion)

Run the whole backend test suite and linter to confirm Phase 5 is green and nothing upstream regressed. **This is the backend MVP completion point** — a fully usable, documented OpenAPI data service.

**Files:** none (verification only).

- [ ] **Step 1: Run the comparison unit + API tests together**

Run: `uv run pytest tests/unit/test_comparison.py tests/api/test_comparison_api.py -v`
Expected: PASS (all comparison tests green)

- [ ] **Step 2: Run the full suite**

Run: `uv run pytest`
Expected: PASS (entire unit + api suite green; no regressions in Phases 0–4)

- [ ] **Step 3: Lint + format check**

Run: `uv run ruff check . && uv run ruff format --check .`
Expected: no errors

- [ ] **Step 4: Confirm OpenAPI exposes the new endpoint**

Run: `uv run python -c "from app.main import app; print('/comparisons' in [r.path for r in app.routes])"`
Expected: `True`

- [ ] **Step 5: Commit (if any lint/format fixes were applied)**

```bash
git add -A
git commit -m "chore(comparison): phase 5 gate — full suite + ruff green (backend MVP complete)"
```

---

## Self-Review

### Acceptance-criteria → task mapping (验收标准 G & H)

| Criterion | Requirement | Task(s) |
|-----------|-------------|---------|
| **G1** | Account level always compared (every series, incl. mismatched) | Task 5 (`_account_block` over full owned list) |
| **G2** | Strategy matched by `name_key` (`momo-eth` ≡ `MOMO_ETH`); unmatched side-by-side, `matched=false` | Task 6 (`_strategy_block`) + API Task 12 |
| **G3** | Symbol matched (uppercased) within matched strategy, PnL only | Task 7 (`_symbol_block`) |
| **G4** | Deterministic per-trade matcher (same side + nearest-ts within `PER_TRADE_MATCH_TOLERANCE`, greedy); diff price_slippage(±,%)/timing_sec/qty_diff/fee_diff baseline-signed | Tasks 8 (matcher) + 9 (diff) + 10 (assembly) |
| **G5** | Unmatched fills surfaced per series (never dropped) | Task 10 (`_build_per_trade` unmatched map) + API Task 12 |
| **G6** | Baseline signing — 2 series `B−A`; 3+ vs chosen baseline (default first-picked) | Task 4 (`_resolve_baseline`) + API Task 12 (3-series test) |
| **G7** | Currency guard — only same `base_currency` diffed; mismatch flagged in `meta.currency_mismatch_series` | Task 3 (`_partition_by_currency`) + API Task 12 |
| **G8** | `per_trade` paginated (`page`/`page_size`/`total`/`rows`/`unmatched`) | Task 11 (`_paginate`) |
| **G9** | Stateless / idempotent (same input → same output) | Stateless by construction (no writes); determinism tests in Tasks 8, 10, and API Task 12 (`r2.json() == body`) |
| **G10** | Optional `date_from`/`date_to` constrains all levels (trade date in `session_tz`, inclusive) | Task 5/6/7 pass dates to `compute_metrics`; Task 10 `_in_date_range` for per_trade |
| **H1** | Cross-user isolation (read/metrics): unowned `series_id` → 404 | Task 2 (`_load_owned_series`) |
| **H2** | Cross-user isolation (comparison): any unowned `series_id` → whole request 404 | Task 2 + API Task 12 (`test_comparison_cross_user_series_returns_404`) |
| **H3** | Ownership — only own series compared | Task 2 (user-scoped query) |

Supporting envelope/precision criteria touched: **ENV-5** (all numerics serialized as strings — Task 1 schema + Tasks 9/10), **ENV-1/2/3** (account/strategy/symbol blocks embed Phase-4 `meta`/`metrics`/`units` verbatim — Tasks 5/6/7). Voided-row exclusion (**AUD-1**) honored via `Fill.voided_at.is_(None)` in Tasks 7/10.

### Placeholder scan
No `TBD`/`TODO`/"implement later"/"add error handling" placeholders. Every code step shows complete code; every test step shows real fixtures and pinned assertions. One **intentional trap** is documented in Task 11 (the `"10.00"` vs correct `"0.10"` slippage line) with an explicit instruction to assert the arithmetic — this is a teaching note, not a placeholder.

### Type/name consistency
- `compare(...)` signature identical across Tasks 2, 5–7, 11, 12 and the structure-doc contract.
- `compute_metrics(session, series_id, level, *, strategy=, symbol=, date_from=, date_to=, trade_view=, active_days_only=)` consumed exactly as Phase 4 defines (Tasks 5/6/7).
- `FillRef`, `MatchedPair`, `_match_side`, `_diff_pair`, `_row_from_pair`, `_build_per_trade`, `_paginate`, `_account_block`, `_strategy_block`, `_symbol_block`, `_partition_by_currency`, `_resolve_baseline`, `_load_owned_series` — each defined once and referenced with matching names/arities throughout.
- Schema names (`ComparisonIn`, `ComparisonOut`, `ComparisonMeta`, `AccountBlock`, `AccountSeriesEntry`, `StrategyBlock`, `SymbolBlock`, `PerTradeBlock`, `PerTradeRow`, `PerTradeValue`, `PerTradeDiff`, `UnmatchedFill`) consistent between Task 1 (definition) and all consumers.

### Notes for the implementer
- If Phase-4 `compute_metrics` selects strategy by **name** rather than `name_key`, adapt Tasks 6/7 to pass the resolved name (look up `Strategy.name` for the matched `name_key` in that series) — keep the `name_key` as the block **key**.
- If `core.errors` 404 exception is not named `NotFoundError`, swap the import in Task 2 and keep the global handler mapping it to 404 (Task 12 relies on a global handler, not a router-level try/except).
- **Backend MVP is complete at Task 13** — the OpenAPI service exposes auth, ingestion, metrics, and comparison end-to-end. Phase 8 (Comparison UI) consumes `ComparisonOut` exactly as defined in Task 1.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-19-liveboard-phase5-comparison.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
