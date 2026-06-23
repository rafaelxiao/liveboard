# LiveBoard Phase 3 — FIFO Pairing & Capital Base — Implementation Plan

> **For agentic workers:** This is a **task-by-task TDD execution plan** for Phase 3 of the
> LiveBoard roadmap (`2026-06-19-liveboard-implementation-roadmap.md`). Build the tasks **in
> order**; each task is a failing-test-first cycle (write test → watch it fail → minimal impl
> → watch it pass → commit). Phase 3 is **pure services + heavy unit tests, NO HTTP, NO
> routers, NO schemas**. Do **not** write application code outside the three service modules
> named below. Phases 0–2 are assumed complete: all models (`Fill`, `FundMovement`, `FxRate`,
> `Instrument`, `Strategy`, `Account`, `Series` with `base_currency`/`session_tz`), `app.db`,
> and the `db` session fixture already exist. This is the **highest-risk financial-correctness
> phase** — every numeric assertion below is exact `Decimal`, never float.

**Goal:** Implement the three pure financial-engine services that turn raw fills + fund
movements into correct realized round-trips and a time-varying capital base: `services/fx.py`
(`as_of_rate` + `to_base` returning `Decimal | None` — never assumes 1.0), `services/pairing.py`
(pure function over fills + instruments; FIFO round-trips with multiplier, long/short/partial,
ts+client_fill_id tiebreak, fee pro-rata split, lot vs position views; PnL in instrument
currency — NO FX conversion inside), and `services/capital.py` (double-entry, external-only,
base-currency capital base). These are consumed by Phase 4 (`services/metrics.py`).

**Architecture:** Thin React frontend over a portable, backend-computed HTTP/OpenAPI data
service. **All** financial computation lives in `app/services/` as framework-free pure
functions over a SQLAlchemy `Session` + typed args (callable without FastAPI). Routers stay
thin; the React app only fetches, lays out, charts, and formats. Phase 3 builds the lowest
layer of the service stack; nothing here imports FastAPI.

**Tech Stack:** Python 3.12 / SQLAlchemy 2 / PostgreSQL 16 / `decimal.Decimal` end-to-end
(`NUMERIC(28,10)` money/qty, `NUMERIC(28,12)` rates) / `zoneinfo` for `session_tz` /
`pytest` + `pytest-cov` (coverage gate on `app/services`) / `ruff`. Managed by `uv`. See
`2026-06-19-liveboard-tech-stack-decisions.md`.

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

## File Structure

All paths are relative to `LiveBoard/backend/`. **Run every command from
`LiveBoard/backend/`.**

```
backend/
  app/
    services/
      fx.py            # NEW — as_of_rate, to_base
      pairing.py       # NEW — RoundTrip, pair_fills, fees_on_open_positions, to_positions
      capital.py       # NEW — account_base, strategy_base, free_cash, base_series
  tests/
    unit/
      conftest.py      # NEW/EXTEND — series/strategy/instrument/fill/fx/fund factories
      test_fx.py       # NEW — Task 1
      test_pairing.py  # NEW — Tasks 2–9
      test_capital.py  # NEW — Tasks 10–12
```

**Models consumed (Phase 2, do NOT modify):**
- `app.models.series.Series(id, user_id, name, tag, notes, base_currency, session_tz, ...)`
- `app.models.account.Account(id, series_id)`
- `app.models.strategy.Strategy(id, series_id, name, name_key)`
- `app.models.instrument.Instrument(id, series_id, symbol, asset_class, currency, multiplier, inferred, ...)`
- `app.models.fill.Fill(id, series_id, strategy_id, symbol, side, qty, price, commission, exchange_fee, regulatory_fee, financing_fee, ts, client_fill_id, position_effect, voided_at, ...)`
- `app.models.fx_rate.FxRate(id, series_id, ccy_from, ccy_to, ts, rate)`
- `app.models.fund_movement.FundMovement(id, series_id, ts, currency, amount, from_bucket, to_bucket, from_strategy_id, to_strategy_id, voided_at, ...)`

---

## Task 0 — Unit-test fixtures & empty service skeletons

Set up the in-DB factory helpers every later task reuses, plus empty modules so imports
resolve. No financial logic yet.

**Files:** `tests/unit/conftest.py`, `app/services/fx.py`, `app/services/pairing.py`,
`app/services/capital.py`.

**Interfaces:**
- *Consumes:* Phase 0 `db` session fixture; Phase 2 models listed above.
- *Produces:* fixtures `series`, `strategy`, and factory helpers `utc`, `make_instrument`,
  `make_fill`, `make_fx`, `make_fund` used by all Phase 3 tests.

**TDD steps:**

- [ ] Create the three service modules as docstring-only files so imports resolve:
      ```python
      # app/services/fx.py
      """As-of FX conversion: instrument/movement currency -> series base_currency."""
      ```
      ```python
      # app/services/pairing.py
      """FIFO round-trip construction per (strategy, symbol)."""
      ```
      ```python
      # app/services/capital.py
      """Double-entry, external-only, base-currency capital base from FundMovements."""
      ```
- [ ] Write `tests/unit/conftest.py` with REAL factories (no placeholders):
      ```python
      from datetime import datetime, timezone
      from decimal import Decimal

      import pytest

      from app.models.series import Series
      from app.models.account import Account
      from app.models.strategy import Strategy
      from app.models.instrument import Instrument
      from app.models.fill import Fill
      from app.models.fx_rate import FxRate
      from app.models.fund_movement import FundMovement


      def utc(y, mo, d, h=0, mi=0, s=0):
          """Aware UTC datetime (all ts are UTC per Global Constraints)."""
          return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)


      @pytest.fixture
      def series(db):
          s = Series(user_id=1, name="t", tag="real", notes=None,
                     base_currency="USD", session_tz="America/New_York")
          db.add(s)
          db.flush()
          db.add(Account(series_id=s.id))
          db.flush()
          return s


      @pytest.fixture
      def strategy(db, series):
          st = Strategy(series_id=series.id, name="alpha", name_key="alpha")
          db.add(st)
          db.flush()
          return st


      def make_instrument(db, series, symbol="AAPL", asset_class="equity",
                          currency="USD", multiplier="1", inferred=False):
          ins = Instrument(series_id=series.id, symbol=symbol, asset_class=asset_class,
                           currency=currency, multiplier=Decimal(multiplier),
                           inferred=inferred)
          db.add(ins)
          db.flush()
          return ins


      def make_fill(db, series, strategy, *, client_fill_id, side, qty, price,
                    symbol="AAPL", at=None, commission="0", exchange_fee="0",
                    regulatory_fee="0", financing_fee="0", position_effect=None,
                    voided=False):
          f = Fill(
              series_id=series.id, strategy_id=strategy.id, symbol=symbol,
              side=side, qty=Decimal(qty), price=Decimal(price),
              commission=Decimal(commission), exchange_fee=Decimal(exchange_fee),
              regulatory_fee=Decimal(regulatory_fee), financing_fee=Decimal(financing_fee),
              ts=at or utc(2026, 6, 19, 14, 30), client_fill_id=client_fill_id,
              position_effect=position_effect,
              voided_at=utc(2026, 6, 19) if voided else None,
          )
          db.add(f)
          db.flush()
          return f


      def make_fx(db, series, *, ccy_from, ccy_to, at, rate):
          r = FxRate(series_id=series.id, ccy_from=ccy_from, ccy_to=ccy_to,
                     ts=at, rate=Decimal(rate))
          db.add(r)
          db.flush()
          return r


      def make_fund(db, series, *, at, amount, from_bucket, to_bucket,
                    currency="USD", from_strategy_id=None, to_strategy_id=None,
                    voided=False):
          m = FundMovement(
              series_id=series.id, ts=at, currency=currency, amount=Decimal(amount),
              from_bucket=from_bucket, to_bucket=to_bucket,
              from_strategy_id=from_strategy_id, to_strategy_id=to_strategy_id,
              voided_at=utc(2026, 6, 19) if voided else None,
          )
          db.add(m)
          db.flush()
          return m
      ```
- [ ] Collection check (import-clean):
      `uv run pytest tests/unit/ --collect-only -q`
      Expected: `no tests ran` (or only pre-existing tests), **no import errors**.
- [ ] `uv run ruff check app/services tests/unit/conftest.py` → expected `All checks passed!`
- [ ] **Commit:** `git add -A && git commit -m "phase3: unit-test factories + empty fx/pairing/capital skeletons"`

---

## Task 1 — `as_of_rate` + `to_base`: same-currency identity, as-of lookup, missing → None

The FX primitive every other Phase 3/4 computation depends on. `as_of_rate` = last-known `FxRate`
with `ts <= at`, returning `Decimal | None`. `to_base` converts an amount to series
`base_currency` at the as-of rate; identity when `ccy == base`; `None` when the required rate
is missing (caller excludes — never assumes 1.0).

**Files:** `app/services/fx.py`, `tests/unit/test_fx.py`.

**Interfaces:**
- *Consumes:* `FxRate(series_id, ccy_from, ccy_to, ts, rate)`, `Series.base_currency`.
- *Produces (pairing, capital, Phase 4 consume these):*
  ```python
  def as_of_rate(session, series_id: int, ccy_from: str, ccy_to: str,
                 at: datetime) -> Decimal | None
      # last-known FxRate.rate with ts <= at; None if no such rate exists

  def to_base(session, series_id: int, amount: Decimal, ccy: str,
              at: datetime) -> Decimal | None
      # converts `amount` in `ccy` to series base_currency at the as-of rate;
      # identity if ccy == base_currency (no DB lookup);
      # None when the required rate is missing (caller excludes the fill, never assumes 1.0)
  ```

**TDD steps:**

- [ ] Failing test — same-currency identity (no rows, no lookup):
      ```python
      from decimal import Decimal
      from app.services import fx
      from tests.unit.conftest import utc

      def test_same_currency_returns_amount(db, series):
          value = fx.to_base(db, series.id, Decimal("123.45"), "USD", utc(2026, 6, 19))
          assert value == Decimal("123.45")     # identity: no DB lookup, not None
      ```
- [ ] Run: `uv run pytest tests/unit/test_fx.py::test_same_currency_returns_amount -v`
      Expected fail: `AttributeError: module 'app.services.fx' has no attribute 'to_base'`.
- [ ] Minimal impl in `fx.py`:
      ```python
      from app.models.fx_rate import FxRate
      from app.models.series import Series
      from sqlalchemy import select


      def as_of_rate(session, series_id, ccy_from, ccy_to, at):
          if ccy_from == ccy_to:
              return None  # same-ccy returns None; callers should short-circuit
          stmt = (
              select(FxRate.rate)
              .where(FxRate.series_id == series_id,
                     FxRate.ccy_from == ccy_from,
                     FxRate.ccy_to == ccy_to,
                     FxRate.ts <= at)
              .order_by(FxRate.ts.desc())
              .limit(1)
          )
          return session.execute(stmt).scalar_one_or_none()


      def to_base(session, series_id, amount, ccy, at):
          base = session.get(Series, series_id).base_currency
          if ccy == base:
              return amount                    # identity — no lookup
          rate = as_of_rate(session, series_id, ccy, base, at)
          if rate is None:
              return None                      # missing rate — caller excludes
          return amount * rate
      ```
- [ ] Re-run → expected `1 passed`.
- [ ] Add as-of lookup test (picks last rate with `ts <= at`, inclusive):
      ```python
      def test_as_of_uses_last_rate_at_or_before(db, series):
          make_fx(db, series, ccy_from="EUR", ccy_to="USD", at=utc(2026, 6, 1), rate="1.10")
          make_fx(db, series, ccy_from="EUR", ccy_to="USD", at=utc(2026, 6, 10), rate="1.20")
          # query at 06-05: only the 1.10 rate is <= that ts
          rate = fx.as_of_rate(db, series.id, "EUR", "USD", utc(2026, 6, 5))
          assert rate == Decimal("1.10")
          # query at 06-10: inclusive, picks the 1.20 rate
          rate2 = fx.as_of_rate(db, series.id, "EUR", "USD", utc(2026, 6, 10))
          assert rate2 == Decimal("1.20")
      ```
- [ ] Add missing-rate test (no rate before `at` → `None`):
      ```python
      def test_missing_rate_returns_none(db, series):
          make_fx(db, series, ccy_from="EUR", ccy_to="USD", at=utc(2026, 6, 10), rate="1.20")
          result = fx.to_base(db, series.id, Decimal("100"), "EUR", utc(2026, 6, 5))
          assert result is None         # no rate at or before 06-05; exclude, not assume 1.0
      ```
- [ ] Add `to_base` conversion test (EUR→USD via as-of rate):
      ```python
      def test_to_base_converts_via_as_of_rate(db, series):
          make_fx(db, series, ccy_from="EUR", ccy_to="USD", at=utc(2026, 6, 1), rate="1.10")
          value = fx.to_base(db, series.id, Decimal("50"), "EUR", utc(2026, 6, 2))
          assert value == Decimal("55.00")    # 50 * 1.10
      ```
- [ ] Run all: `uv run pytest tests/unit/test_fx.py -v` → expected `4 passed`.
- [ ] `uv run ruff check app/services/fx.py tests/unit/test_fx.py` → `All checks passed!`
- [ ] **Commit:** `git add -A && git commit -m "phase3: fx as_of_rate + to_base (same-ccy, as-of, missing→None) [CCY-2,CCY-3]"`

---

## Task 2 — `RoundTrip` dataclass + `pair_fills(fills, instruments)` pure (D1)

The core data structure and the simplest FIFO close: one buy fully closed by one sell. We
write the **full open/close FIFO netting engine now** (it is the minimum that also makes
Tasks 3–5 pass without a rewrite); later tasks layer multiplier scaling, fees, and grouping
on top. `pair_fills` is a **pure function** — no session, no FX conversion. PnL stays in
instrument currency. Separate `fees_on_open_positions(fills, instruments)` returns fees on
still-open lots.

**Files:** `app/services/pairing.py`, `tests/unit/test_pairing.py`.

**Interfaces:**
- *Consumes:* `Fill`, `Instrument` (`multiplier`, `currency`). No session, no `Series`, no FX.
- *Produces (Phase 4 metrics consumes):*
  ```python
  @dataclass
  class RoundTrip:
      strategy_id: int
      symbol: str
      open_ts: datetime
      close_ts: datetime
      qty: Decimal                 # closed qty of this lot↔close portion
      direction: str               # "long" | "short"
      multiplier: Decimal          # instrument contract/point value
      currency: str                # instrument currency (pre-conversion)
      entry_price: Decimal
      exit_price: Decimal
      gross_pnl: Decimal           # instrument ccy: (exit-entry)*qty*multiplier, sign-adjusted
      entry_fees: Decimal          # entry fill fees pro-rata by closed qty
      exit_fees: Decimal           # exit fill fees pro-rata by closed qty
      total_fees: Decimal          # entry_fees + exit_fees
      net_pnl: Decimal             # gross_pnl - total_fees (instrument ccy)
      fx_missing: bool             # always False from pairing; Phase 4 sets True when to_base fails

  def pair_fills(fills: list[Fill], instruments: dict[str, Instrument]) -> list[RoundTrip]
      # FIFO per (strategy_id, symbol); fills ordered by (ts, client_fill_id);
      # voided fills excluded. PnL in instrument currency — NO FX conversion.

  def fees_on_open_positions(fills, instruments) -> Decimal
      # fees on still-open lots; for reconciliation with account fees total

  def to_positions(round_trips: list[RoundTrip]) -> list[RoundTrip]
      # group flat-to-flat lots into per-position trades (Task 9)
  ```

**TDD steps:**

- [ ] Failing D1 test (buy 100@10 then sell 100@12, multiplier 1, zero fees → gross 200):
      ```python
      from decimal import Decimal
      from app.services import pairing
      from tests.unit.conftest import utc, make_instrument, make_fill

      def test_d1_long_full_pair(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="100", price="12", at=utc(2026, 6, 19, 15, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert len(rts) == 1
          rt = rts[0]
          assert rt.direction == "long"
          assert rt.qty == Decimal("100")
          assert rt.entry_price == Decimal("10")
          assert rt.exit_price == Decimal("12")
          assert rt.gross_pnl == Decimal("200")       # (12-10)*100*1 in instrument ccy
          assert rt.total_fees == Decimal("0")
          assert rt.net_pnl == Decimal("200")
          assert rt.open_ts == utc(2026, 6, 19, 14, 0)
          assert rt.close_ts == utc(2026, 6, 19, 15, 0)
          assert rt.fx_missing is False
          assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")
      ```
- [ ] Run: `uv run pytest tests/unit/test_pairing.py::test_d1_long_full_pair -v`
      Expected fail: `AttributeError: module 'app.services.pairing' has no attribute 'pair_fills'`.
- [ ] Minimal impl — the full FIFO engine. `_total_fee` sums the four components; an open
      lot tracks signed `qty`, `original` qty, entry price/ts, and total entry fee for
      pro-rata. A fill same-signed as the net position opens/adds a lot; opposite-signed
      closes FIFO. `pair_fills` and `fees_on_open_positions` share the internal `_batch`
      function; PnL stays in instrument currency — NO FX conversion:
      ```python
      from collections import defaultdict, deque
      from dataclasses import dataclass
      from datetime import datetime
      from decimal import Decimal


      @dataclass
      class RoundTrip:
          strategy_id: int
          symbol: str
          open_ts: datetime
          close_ts: datetime
          qty: Decimal
          direction: str
          multiplier: Decimal
          currency: str
          entry_price: Decimal
          exit_price: Decimal
          gross_pnl: Decimal
          entry_fees: Decimal
          exit_fees: Decimal
          total_fees: Decimal
          net_pnl: Decimal
          fx_missing: bool


      @dataclass
      class _Lot:
          qty: Decimal          # signed: +long / -short
          original: Decimal     # signed original qty (for fee pro-rata)
          price: Decimal
          ts: datetime
          fee: Decimal          # total entry fee of the opening fill


      def _total_fee(f):
          return f.commission + f.exchange_fee + f.regulatory_fee + f.financing_fee


      def _signed(f):
          return f.qty if f.side == "buy" else -f.qty


      def _batch(fills, instruments):
          live = [f for f in fills if f.voided_at is None]
          groups = defaultdict(list)
          for f in live:
              groups[(f.strategy_id, f.symbol)].append(f)

          round_trips = []
          open_fee_total = Decimal("0")

          for (strat_id, symbol), gfills in groups.items():
              gfills.sort(key=lambda f: (f.ts, f.client_fill_id))
              lots: deque[_Lot] = deque()
              net = Decimal("0")
              ins = instruments[symbol]
              mult = ins.multiplier
              ccy = ins.currency

              for f in gfills:
                  s = _signed(f)
                  if net == 0 or (net > 0) == (s > 0):
                      lots.append(_Lot(qty=s, original=s, price=f.price,
                                       ts=f.ts, fee=_total_fee(f)))
                      net += s
                      continue
                  # opposite sign -> close FIFO
                  close_remaining = abs(s)
                  exit_fee_total = _total_fee(f)
                  exit_qty_total = f.qty
                  while close_remaining > 0 and lots:
                      lot = lots[0]
                      lot_remaining = abs(lot.qty)
                      closed = min(close_remaining, lot_remaining)
                      direction = "long" if lot.qty > 0 else "short"
                      if direction == "long":
                          gross = (f.price - lot.price) * closed * mult
                      else:
                          gross = (lot.price - f.price) * closed * mult
                      entry_fee = lot.fee * (closed / abs(lot.original))
                      exit_fee = exit_fee_total * (closed / exit_qty_total)
                      total_fee = entry_fee + exit_fee
                      round_trips.append(RoundTrip(
                          strategy_id=strat_id, symbol=symbol,
                          open_ts=lot.ts, close_ts=f.ts, qty=closed,
                          direction=direction, multiplier=mult, currency=ccy,
                          entry_price=lot.price, exit_price=f.price,
                          gross_pnl=gross, entry_fees=entry_fee, exit_fees=exit_fee,
                          total_fees=total_fee, net_pnl=gross - total_fee,
                          fx_missing=False,
                      ))
                      if lot.qty > 0:
                          lot.qty -= closed
                      else:
                          lot.qty += closed
                      if lot.qty == 0:
                          lots.popleft()
                      close_remaining -= closed
                      net += (closed if s > 0 else -closed)
                  # leftover close qty flips into a new opposite-direction lot
                  if close_remaining > 0:
                      signed_left = close_remaining if s > 0 else -close_remaining
                      lots.append(_Lot(qty=signed_left, original=signed_left,
                                       price=f.price, ts=f.ts, fee=Decimal("0")))
                      net += signed_left

              # fees on still-open lots, pro-rata by remaining qty
              for lot in lots:
                  open_fee_total += lot.fee * (abs(lot.qty) / abs(lot.original))

          return round_trips, open_fee_total


      def pair_fills(fills, instruments):
          rts, _ = _batch(fills, instruments)
          return rts


      def fees_on_open_positions(fills, instruments):
          _, fee = _batch(fills, instruments)
          return fee
      ```
- [ ] Re-run D1 → expected `1 passed`.
- [ ] `uv run ruff check app/services/pairing.py tests/unit/test_pairing.py` → `All checks passed!`
- [ ] **Commit:** `git add -A && git commit -m "phase3: RoundTrip + pair_fills(fills,instruments) pure FIFO engine [D1]"`

---

## Task 3 — Short round-trip (D2)

Open short then buy-to-cover; PnL sign-adjusted.

**Files:** `tests/unit/test_pairing.py` (engine already supports it).

**Interfaces:** unchanged from Task 2.

**TDD steps:**

- [ ] Failing D2 test (sell 50@20 open short, buy 50@18 cover → gross 100):
      ```python
      def test_d2_short_full_pair(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="sell",
                        qty="50", price="20", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="c1", side="buy",
                        qty="50", price="18", at=utc(2026, 6, 19, 15, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert len(rts) == 1
          rt = rts[0]
          assert rt.direction == "short"
          assert rt.qty == Decimal("50")
          assert rt.entry_price == Decimal("20")
          assert rt.exit_price == Decimal("18")
          assert rt.gross_pnl == Decimal("100")   # (20-18)*50*1, short sign-adjusted
          assert rt.net_pnl == Decimal("100")
          assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")
      ```
- [ ] Run: `uv run pytest tests/unit/test_pairing.py::test_d2_short_full_pair -v`
      Expected: `1 passed` (if it fails, the short branch is the bug to fix — do **not**
      weaken the long test).
- [ ] Regression: `uv run pytest tests/unit/test_pairing.py -v` → expected `2 passed`.
- [ ] **Commit:** `git add -A && git commit -m "phase3: short round-trip pairing [D2]"`

---

## Task 4 — Partial: one close consumes many opens + tiebreak (D3, D8)

One sell drains multiple FIFO open lots; identical-`ts` fills order by `client_fill_id`.

**Files:** `tests/unit/test_pairing.py`.

**Interfaces:** unchanged.

**TDD steps:**

- [ ] Failing D3 test (buy 100@10, buy 100@11, sell 150@12 → FIFO 100@10 then 50@11):
      ```python
      def test_d3_one_close_many_opens_fifo(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="o2", side="buy",
                        qty="100", price="11", at=utc(2026, 6, 19, 14, 30)),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="150", price="12", at=utc(2026, 6, 19, 15, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert len(rts) == 2
          assert rts[0].qty == Decimal("100")        # first lot 100@10 closed in full
          assert rts[0].entry_price == Decimal("10")
          assert rts[0].gross_pnl == Decimal("200")  # (12-10)*100
          assert rts[1].qty == Decimal("50")         # then 50 of the 100@11 lot
          assert rts[1].entry_price == Decimal("11")
          assert rts[1].gross_pnl == Decimal("50")    # (12-11)*50
          assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")
      ```
- [ ] Failing D8 tiebreak test (two opens share `ts`; `client_fill_id` orders them, so the
      `aaa`-id lot pairs first regardless of insertion order):
      ```python
      def test_d8_same_ts_tiebreak_by_client_fill_id(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          t = utc(2026, 6, 19, 14, 0)
          fills = [   # insert higher-id lot FIRST: ordering must be by client_fill_id
              make_fill(db, series, strategy, client_fill_id="bbb", side="buy",
                        qty="10", price="11", at=t),
              make_fill(db, series, strategy, client_fill_id="aaa", side="buy",
                        qty="10", price="10", at=t),
              make_fill(db, series, strategy, client_fill_id="ccc", side="sell",
                        qty="10", price="12", at=utc(2026, 6, 19, 15, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert len(rts) == 1
          assert rts[0].entry_price == Decimal("10")  # "aaa" sorts first at equal ts
          assert rts[0].gross_pnl == Decimal("20")    # (12-10)*10
      ```
- [ ] Run: `uv run pytest tests/unit/test_pairing.py -k "d3 or d8" -v` → expected `2 passed`.
- [ ] Regression: `uv run pytest tests/unit/test_pairing.py -v` → expected `4 passed`.
- [ ] **Commit:** `git add -A && git commit -m "phase3: FIFO one-close-many-opens + ts/client_fill_id tiebreak [D3,D8]"`

---

## Task 5 — Partial: many closes drain one open (D4) + isolation (D6) + open-only (D7)

One open lot closed by multiple closing fills; per-`(strategy,symbol)` isolation; open-only
position yields no round-trip.

**Files:** `tests/unit/test_pairing.py`.

**Interfaces:** unchanged.

**TDD steps:**

- [ ] Failing D4 test (buy 100@10, sell 40@12, sell 60@13 → two round-trips):
      ```python
      def test_d4_many_closes_one_open(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="40", price="12", at=utc(2026, 6, 19, 15, 0)),
              make_fill(db, series, strategy, client_fill_id="c2", side="sell",
                        qty="60", price="13", at=utc(2026, 6, 19, 16, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert len(rts) == 2
          assert rts[0].qty == Decimal("40")
          assert rts[0].gross_pnl == Decimal("80")    # (12-10)*40
          assert rts[1].qty == Decimal("60")
          assert rts[1].gross_pnl == Decimal("180")   # (13-10)*60
          assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")
      ```
- [ ] Failing D6 isolation test (two strategies, same symbol → never cross-pair):
      ```python
      def test_d6_strategy_symbol_isolation(db, series, strategy):
          from app.models.strategy import Strategy
          other = Strategy(series_id=series.id, name="beta", name_key="beta")
          db.add(other)
          db.flush()
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="a1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, other, client_fill_id="b1", side="sell",
                        qty="100", price="12", at=utc(2026, 6, 19, 15, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert rts == []   # alpha open-long, beta open-short; nothing closes
      ```
- [ ] Failing D7 open-only test (buy only → no round-trip, open-leg fees reconciled):
      ```python
      def test_d7_open_only_no_round_trip_fees_reconciled(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0),
                        commission="7"),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert rts == []
          assert pairing.fees_on_open_positions(fills, instruments) == Decimal("7")
      ```
- [ ] Run: `uv run pytest tests/unit/test_pairing.py -k "d4 or d6 or d7" -v` → expected `3 passed`.
- [ ] Regression: `uv run pytest tests/unit/test_pairing.py -v` → expected `7 passed`.
- [ ] **Commit:** `git add -A && git commit -m "phase3: many-close-one-open + isolation + open-only fee reconcile [D4,D6,D7]"`

---

## Task 6 — Multiplier scaling: futures & options (M2-1)

`gross_pnl` scales linearly with `instrument.multiplier`.

**Files:** `tests/unit/test_pairing.py` (engine already multiplies `* mult`).

**Interfaces:** unchanged.

**TDD steps:**

- [ ] Failing futures test (multiplier 50: buy 2@4000, sell 2@4012 → 1200):
      ```python
      def test_m2_futures_multiplier_50(db, series, strategy):
          ins = make_instrument(db, series, symbol="ES", asset_class="future",
                                multiplier="50")
          instruments = {"ES": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="2", price="4000", symbol="ES", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="2", price="4012", symbol="ES", at=utc(2026, 6, 19, 15, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert rts[0].multiplier == Decimal("50")
          assert rts[0].gross_pnl == Decimal("1200")   # (4012-4000)*2*50
      ```
- [ ] Failing options test (multiplier 100: buy 1@5.00, sell 1@5.50 → 50):
      ```python
      def test_m2_options_multiplier_100(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL240621C", asset_class="option",
                                multiplier="100")
          instruments = {"AAPL240621C": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="1", price="5.00", symbol="AAPL240621C",
                        at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="1", price="5.50", symbol="AAPL240621C",
                        at=utc(2026, 6, 19, 15, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert rts[0].gross_pnl == Decimal("50.00")   # (5.50-5.00)*1*100
      ```
- [ ] Run: `uv run pytest tests/unit/test_pairing.py -k "multiplier" -v` → expected `2 passed`.
- [ ] Regression: `uv run pytest tests/unit/test_pairing.py -v` → expected `9 passed`.
- [ ] **Commit:** `git add -A && git commit -m "phase3: multiplier scaling futures/options [M2-1]"`

---

## Task 7 — Fee pro-rata split + `fees_on_open_positions` (D5, FEE-2, FEE-3, FEE-4)

Exit fees in full per close; entry fees pro-rata by closed qty; negative fees (rebates) sum
correctly; open-leg fees excluded from round-trips and surfaced separately.

**Files:** `tests/unit/test_pairing.py` (engine already pro-rates).

**Interfaces:** unchanged.

**TDD steps:**

- [ ] Failing D5 pro-rata test (entry fee 10 on 100 lot; close 40 → entry_fees 4; exit fee 5
      in full for that close; 6 of entry fee stays on the open 60):
      ```python
      def test_d5_entry_fee_prorata_exit_full(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0),
                        commission="10"),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="40", price="12", at=utc(2026, 6, 19, 15, 0),
                        commission="5"),
          ]
          rts = pairing.pair_fills(fills, instruments)
          assert len(rts) == 1
          rt = rts[0]
          assert rt.entry_fees == Decimal("4")    # 10 * 40/100
          assert rt.exit_fees == Decimal("5")     # exit fee in full for this close
          assert rt.total_fees == Decimal("9")
          assert rt.gross_pnl == Decimal("80")    # (12-10)*40
          assert rt.net_pnl == Decimal("71")      # 80 - 9
          assert pairing.fees_on_open_positions(fills, instruments) == Decimal("6")
      ```
- [ ] Failing FEE-4 negative-fee (maker rebate) test (`exchange_fee = -2` reduces total fee):
      ```python
      def test_fee4_negative_rebate_in_total(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0),
                        commission="3", exchange_fee="-2"),     # entry total fee = 1
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="100", price="12", at=utc(2026, 6, 19, 15, 0),
                        commission="3", exchange_fee="-2"),     # exit total fee = 1
          ]
          rts = pairing.pair_fills(fills, instruments)
          rt = rts[0]
          assert rt.entry_fees == Decimal("1")    # (3 + -2) * 100/100
          assert rt.exit_fees == Decimal("1")
          assert rt.total_fees == Decimal("2")
          assert rt.net_pnl == Decimal("198")     # 200 - 2
          assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")
      ```
- [ ] Run: `uv run pytest tests/unit/test_pairing.py -k "d5 or fee4" -v` → expected `2 passed`.
- [ ] Regression: `uv run pytest tests/unit/test_pairing.py -v` → expected `11 passed`.
- [ ] **Commit:** `git add -A && git commit -m "phase3: fee pro-rata split + open-leg fees + negative fees [D5,FEE-2,FEE-3,FEE-4]"`

---

## Task 8 — Instrument-ccy PnL preservation + standalone `fees_on_open_positions` (CCY-2, CCY-3)

`pair_fills` is a **pure function with no FX conversion**. PnL stays in instrument currency;
`fx_missing` is always `False` from pairing (Phase 4 sets it to `True` when `to_base`
returns `None`). `fees_on_open_positions` is its own standalone function. FX conversion
testing belongs in `test_fx.py` (Task 1 `to_base` tests already cover same-ccy identity,
as-of conversion, and missing-rate → `None`).

**Files:** `tests/unit/test_pairing.py`.

**Interfaces:** unchanged from Task 2.

**TDD steps:**

- [ ] Test — EUR instrument round-trip with gross PnL in EUR (NO conversion):
      ```python
      def test_instrument_ccy_pnl_preserved_no_fx(db, series, strategy):
          ins = make_instrument(db, series, symbol="BMW", currency="EUR", multiplier="1")
          instruments = {"BMW": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", symbol="BMW", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="100", price="12", symbol="BMW", at=utc(2026, 6, 19, 15, 0)),
          ]
          rts = pairing.pair_fills(fills, instruments)
          rt = rts[0]
          assert rt.currency == "EUR"
          assert rt.fx_missing is False
          assert rt.gross_pnl == Decimal("200")        # 200 EUR — instrument ccy
          assert rt.net_pnl == Decimal("200")           # instrument ccy
      ```
- [ ] Run: `uv run pytest tests/unit/test_pairing.py::test_instrument_ccy_pnl_preserved_no_fx -v`
      Expected: `1 passed` (engine already emits instrument-ccy PnL; no conversion ever applied).
- [ ] Regression: `uv run pytest tests/unit/test_pairing.py -v` → expected `12 passed`.
- [ ] `uv run ruff check app/services/pairing.py` → `All checks passed!`
- [ ] **Commit:** `git add -A && git commit -m "phase3: instrument-ccy PnL preservation (no FX in pairing) [CCY-2,CCY-3]"`

---

## Task 9 — Per-lot vs per-position grouping (D10)

`to_positions` groups round-trips by `(strategy_id, symbol)` then splits each group into
contiguous flat-to-flat positions: a new position starts when a round-trip's `open_ts` is
strictly after the group's current `max_close_ts` (the prior position went flat before this
one opened). Within each contiguous position, qty/gross/fees/net are summed,
entry/exit prices are qty-weighted averages, and `fx_missing` is any() of the constituent
lots.

**Files:** `app/services/pairing.py`, `tests/unit/test_pairing.py`.

**Interfaces:**
- *Produces (Phase 4 trade_view="position" consumes):*
  ```python
  def to_positions(round_trips: list[RoundTrip]) -> list[RoundTrip]
      # group by (strategy_id, symbol); split into contiguous positions by open/close gaps;
      # qty/gross/fees/net summed; entry_price/exit_price qty-weighted avg;
      # open_ts=min, close_ts=max; fx_missing=any; direction from the group's lots.
  ```

**TDD steps:**

- [ ] Failing test — D4 lots (40@12 + 60@13 on one 100@10 open) collapse to ONE position
      (same open_ts, overlapping closes → contiguous):
      ```python
      def test_d10_to_positions_groups_flat_to_flat(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="40", price="12", at=utc(2026, 6, 19, 15, 0)),
              make_fill(db, series, strategy, client_fill_id="c2", side="sell",
                        qty="60", price="13", at=utc(2026, 6, 19, 16, 0)),
          ]
          lots = pairing.pair_fills(fills, instruments)
          assert len(lots) == 2                       # per-lot view
          positions = pairing.to_positions(lots)
          assert len(positions) == 1                  # per-position view
          pos = positions[0]
          assert pos.qty == Decimal("100")            # 40 + 60
          assert pos.gross_pnl == Decimal("260")      # 80 + 180
          assert pos.entry_price == Decimal("10")     # weighted avg of identical 10s
          assert pos.exit_price == Decimal("12.60")   # (12*40 + 13*60)/100
          assert pos.open_ts == utc(2026, 6, 19, 14, 0)
          assert pos.close_ts == utc(2026, 6, 19, 16, 0)
          assert pos.direction == "long"
      ```
- [ ] Failing test — two separate flat-to-flat positions stay separate (position 1 closes
      at 15:00, position 2 opens at 16:00 — gap signals a new position):
      ```python
      def test_d10_two_positions_not_merged(db, series, strategy):
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          instruments = {"AAPL": ins}
          fills = [
              make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                        qty="100", price="10", at=utc(2026, 6, 19, 14, 0)),
              make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                        qty="100", price="12", at=utc(2026, 6, 19, 15, 0)),  # flat (pos 0)
              make_fill(db, series, strategy, client_fill_id="o2", side="buy",
                        qty="50", price="11", at=utc(2026, 6, 19, 16, 0)),   # reopen (pos 1)
              make_fill(db, series, strategy, client_fill_id="c2", side="sell",
                        qty="50", price="13", at=utc(2026, 6, 19, 17, 0)),
          ]
          lots = pairing.pair_fills(fills, instruments)
          positions = pairing.to_positions(lots)
          assert len(positions) == 2
          assert positions[0].gross_pnl == Decimal("200")   # (12-10)*100
          assert positions[1].gross_pnl == Decimal("100")   # (13-11)*50
      ```
- [ ] Run: `uv run pytest tests/unit/test_pairing.py -k "d10" -v`
      Expected fail: `AttributeError: ... has no attribute 'to_positions'`.
- [ ] Minimal impl appended to `pairing.py`:
      ```python
      def to_positions(round_trips):
          by_key = defaultdict(list)
          for rt in round_trips:
              by_key[(rt.strategy_id, rt.symbol)].append(rt)
          out = []
          for lots in by_key.values():
              lots.sort(key=lambda rt: (rt.open_ts, rt.close_ts))
              groups = []
              for rt in lots:
                  if not groups or rt.open_ts > max(l.close_ts for l in groups[-1]):
                      groups.append([rt])
                  else:
                      groups[-1].append(rt)
              for group in groups:
                  qty = sum((l.qty for l in group), Decimal("0"))
                  gross = sum((l.gross_pnl for l in group), Decimal("0"))
                  entry_fees = sum((l.entry_fees for l in group), Decimal("0"))
                  exit_fees = sum((l.exit_fees for l in group), Decimal("0"))
                  total_fees = sum((l.total_fees for l in group), Decimal("0"))
                  net = sum((l.net_pnl for l in group), Decimal("0"))
                  entry_price = sum((l.entry_price * l.qty for l in group), Decimal("0")) / qty
                  exit_price = sum((l.exit_price * l.qty for l in group), Decimal("0")) / qty
                  out.append(RoundTrip(
                      strategy_id=group[0].strategy_id, symbol=group[0].symbol,
                      open_ts=min(l.open_ts for l in group),
                      close_ts=max(l.close_ts for l in group),
                      qty=qty, direction=group[0].direction,
                      multiplier=group[0].multiplier, currency=group[0].currency,
                      entry_price=entry_price, exit_price=exit_price,
                      gross_pnl=gross, entry_fees=entry_fees, exit_fees=exit_fees,
                      total_fees=total_fees, net_pnl=net,
                      fx_missing=any(l.fx_missing for l in group),
                  ))
          return out
      ```
- [ ] Re-run D10 tests → expected `2 passed`.
- [ ] Full regression: `uv run pytest tests/unit/test_pairing.py -v` → expected `14 passed`.
- [ ] `uv run ruff check app/services/pairing.py` → `All checks passed!`
- [ ] **Commit:** `git add -A && git commit -m "phase3: to_positions contiguity-based per-position grouping [D10]"`

---

## Task 10 — `capital.account_base`: external-only, base ccy, no compounding (E1, E6)

Account base at `t` = net of all `EXTERNAL` movements with `ts <= t`, in base ccy. Internal
transfers contribute 0; trading PnL never flows in.

**Files:** `app/services/capital.py`, `tests/unit/test_capital.py`.

**Interfaces:**
- *Consumes:* `FundMovement`, `fx.to_base`.
- *Produces (Phase 4 consumes):*
  ```python
  def account_base(session, series_id: int, at: datetime | None) -> Decimal
      # sum(amount where from_bucket=EXTERNAL) - sum(amount where to_bucket=EXTERNAL),
      # non-voided, ts<=at (None=all time), each amount converted to base ccy at movement.ts
  ```
  > Sign convention: `EXTERNAL → internal` (deposit) **increases** the account base;
  > `internal → EXTERNAL` (withdrawal) **decreases** it. A movement with neither bucket
  > `EXTERNAL` contributes 0 to the account base.

**TDD steps:**

- [ ] Failing E1 test (deposit 100k external; allocate to strategy is internal → base 100k):
      ```python
      from decimal import Decimal
      from app.services import capital
      from tests.unit.conftest import utc, make_fund

      def test_e1_account_base_is_net_external(db, series, strategy):
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          make_fund(db, series, at=utc(2026, 6, 2), amount="60000",
                    from_bucket="FREE_CASH", to_bucket="STRATEGY",
                    to_strategy_id=strategy.id)   # internal -> no effect on account base
          assert capital.account_base(db, series.id, None) == Decimal("100000")
      ```
- [ ] Failing E1 withdrawal test (deposit 100k then withdraw 30k → 70k):
      ```python
      def test_e1_withdrawal_reduces_account_base(db, series):
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          make_fund(db, series, at=utc(2026, 6, 3), amount="30000",
                    from_bucket="FREE_CASH", to_bucket="EXTERNAL")
          assert capital.account_base(db, series.id, None) == Decimal("70000")
      ```
- [ ] Failing E6 no-compounding test (winning fills must NOT change the base):
      ```python
      from tests.unit.conftest import make_instrument, make_fill

      def test_e6_trading_pnl_does_not_change_base(db, series, strategy):
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
          make_fill(db, series, strategy, client_fill_id="o1", side="buy",
                    qty="100", price="10", at=utc(2026, 6, 2, 14, 0))
          make_fill(db, series, strategy, client_fill_id="c1", side="sell",
                    qty="100", price="2000", at=utc(2026, 6, 2, 15, 0))  # huge profit
          # base reads FundMovements only -> unchanged
          assert capital.account_base(db, series.id, None) == Decimal("100000")
      ```
- [ ] Failing voided/as-of test (voided excluded; `at` cutoff respected):
      ```python
      def test_e1_voided_excluded_and_asof_cutoff(db, series):
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          make_fund(db, series, at=utc(2026, 6, 5), amount="50000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH", voided=True)
          make_fund(db, series, at=utc(2026, 6, 10), amount="20000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          # as-of 06-07: only the first (non-voided) deposit counts
          assert capital.account_base(db, series.id, utc(2026, 6, 7)) == Decimal("100000")
          # all time: voided still excluded -> 100k + 20k
          assert capital.account_base(db, series.id, None) == Decimal("120000")
      ```
- [ ] Run: `uv run pytest tests/unit/test_capital.py -k "e1 or e6" -v`
      Expected fail: `AttributeError: module 'app.services.capital' has no attribute 'account_base'`.
- [ ] Minimal impl in `capital.py`:
      ```python
      from decimal import Decimal

      from sqlalchemy import select

      from app.models.fund_movement import FundMovement
      from app.services import fx

      EXTERNAL = "EXTERNAL"
      FREE_CASH = "FREE_CASH"
      STRATEGY = "STRATEGY"


      def _movements(session, series_id, at):
          stmt = select(FundMovement).where(
              FundMovement.series_id == series_id,
              FundMovement.voided_at.is_(None),
          )
          if at is not None:
              stmt = stmt.where(FundMovement.ts <= at)
          return session.execute(stmt).scalars().all()


      def account_base(session, series_id, at):
          total = Decimal("0")
          for m in _movements(session, series_id, at):
              if m.from_bucket == EXTERNAL and m.to_bucket != EXTERNAL:
                  value = fx.to_base(session, series_id, m.amount, m.currency, m.ts)
                  if value is not None:                   # missing FX → skip movement
                      total += value
              elif m.to_bucket == EXTERNAL and m.from_bucket != EXTERNAL:
                  value = fx.to_base(session, series_id, m.amount, m.currency, m.ts)
                  if value is not None:
                      total -= value
          return total
      ```
- [ ] Re-run → expected the e1/e6 set `passed`; then run voided test:
      `uv run pytest tests/unit/test_capital.py -v` → expected `4 passed`.
- [ ] `uv run ruff check app/services/capital.py tests/unit/test_capital.py` → `All checks passed!`
- [ ] **Commit:** `git add -A && git commit -m "phase3: capital.account_base external-only + no compounding [E1,E6]"`

---

## Task 11 — `strategy_base` + `free_cash` + inter-strategy net-zero (E2, E3, E4)

Strategy base = net flow into that strategy bucket; free cash = net flow into `FREE_CASH`;
an inter-strategy transfer leaves `account_base` unchanged but shifts the two strategy bases.

**Files:** `app/services/capital.py`, `tests/unit/test_capital.py`.

**Interfaces:**
- *Produces:*
  ```python
  def strategy_base(session, series_id: int, strategy_id: int,
                    at: datetime | None) -> Decimal
      # sum(to_strategy_id == strategy_id) - sum(from_strategy_id == strategy_id),
      # non-voided, ts<=at, base ccy

  def free_cash(session, series_id: int, at: datetime | None) -> Decimal
      # sum(to_bucket==FREE_CASH) - sum(from_bucket==FREE_CASH), non-voided, ts<=at, base ccy
  ```

**TDD steps:**

- [ ] Failing E3 test (allocate 60k FREE_CASH→STRATEGY(a) → strategy_a base 60k):
      ```python
      def test_e3_strategy_base_net_inflow(db, series, strategy):
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          make_fund(db, series, at=utc(2026, 6, 2), amount="60000",
                    from_bucket="FREE_CASH", to_bucket="STRATEGY",
                    to_strategy_id=strategy.id)
          assert capital.strategy_base(db, series.id, strategy.id, None) == Decimal("60000")
      ```
- [ ] Failing E4 free-cash test (deposit 100k, allocate 60k out → free cash 40k):
      ```python
      def test_e4_free_cash_net(db, series, strategy):
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          make_fund(db, series, at=utc(2026, 6, 2), amount="60000",
                    from_bucket="FREE_CASH", to_bucket="STRATEGY",
                    to_strategy_id=strategy.id)
          assert capital.free_cash(db, series.id, None) == Decimal("40000")
      ```
- [ ] Failing E2 inter-strategy net-zero test (transfer 20k a→b: account base unchanged,
      a down 20k, b up 20k):
      ```python
      def test_e2_inter_strategy_transfer_net_zero(db, series, strategy):
          from app.models.strategy import Strategy
          strat_b = Strategy(series_id=series.id, name="beta", name_key="beta")
          db.add(strat_b)
          db.flush()
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          make_fund(db, series, at=utc(2026, 6, 2), amount="50000",
                    from_bucket="FREE_CASH", to_bucket="STRATEGY",
                    to_strategy_id=strategy.id)   # a = 50k
          make_fund(db, series, at=utc(2026, 6, 3), amount="20000",
                    from_bucket="STRATEGY", to_bucket="STRATEGY",
                    from_strategy_id=strategy.id, to_strategy_id=strat_b.id)
          # account base unchanged by the internal transfer
          assert capital.account_base(db, series.id, None) == Decimal("100000")
          # a lost 20k, b gained 20k (net zero across the two strategies)
          assert capital.strategy_base(db, series.id, strategy.id, None) == Decimal("30000")
          assert capital.strategy_base(db, series.id, strat_b.id, None) == Decimal("20000")
      ```
- [ ] Run: `uv run pytest tests/unit/test_capital.py -k "e2 or e3 or e4" -v`
      Expected fail: `AttributeError: ... has no attribute 'strategy_base'`.
- [ ] Minimal impl appended to `capital.py`:
      ```python
      def strategy_base(session, series_id, strategy_id, at):
          total = Decimal("0")
          for m in _movements(session, series_id, at):
              if m.to_strategy_id == strategy_id:
                  value = fx.to_base(session, series_id, m.amount, m.currency, m.ts)
                  if value is not None:
                      total += value
              if m.from_strategy_id == strategy_id:
                  value = fx.to_base(session, series_id, m.amount, m.currency, m.ts)
                  if value is not None:
                      total -= value
          return total


      def free_cash(session, series_id, at):
          total = Decimal("0")
          for m in _movements(session, series_id, at):
              if m.to_bucket == FREE_CASH:
                  value = fx.to_base(session, series_id, m.amount, m.currency, m.ts)
                  if value is not None:
                      total += value
              if m.from_bucket == FREE_CASH:
                  value = fx.to_base(session, series_id, m.amount, m.currency, m.ts)
                  if value is not None:
                      total -= value
          return total
      ```
- [ ] Re-run: `uv run pytest tests/unit/test_capital.py -v` → expected `7 passed`.
- [ ] `uv run ruff check app/services/capital.py` → `All checks passed!`
- [ ] **Commit:** `git add -A && git commit -m "phase3: strategy_base + free_cash + inter-strategy net-zero [E2,E3,E4]"`

---

## Task 12 — `base_series`: time-varying per-day capital sampling (E5)

Sample the capital base for the requested level on each calendar day in `days` — the
denominator Phase 4 uses for daily returns / Sharpe / Sortino. The base monotonically steps
with each `ts <= end-of-day`.

**Files:** `app/services/capital.py`, `tests/unit/test_capital.py`.

**Interfaces:**
- *Produces (Phase 4 `daily_returns`/`sharpe` consume):*
  ```python
  def base_series(session, series_id: int, level: str, ref_id: int | None,
                  days: list[date]) -> dict[date, Decimal]
      # level in {"account","strategy","free_cash"}; ref_id = strategy_id for "strategy".
      # For each d in days, base = <level fn>(session, series_id, end_of_day_utc(d)).
      # "end of day" is the instant just before the next UTC midnight so all of day d's
      # movements (with ts on day d) are included.
  ```
  > Phase 3 samples by **UTC** end-of-day for determinism; Phase 4 owns the `session_tz`
  > trade-date mapping (TZ-2) when it builds the `days` list, then asks `base_series` for the
  > base on each of those dates. Keeping the tz logic in Phase 4 avoids duplicating it here.

**TDD steps:**

- [ ] Failing E5 test (deposits on 06-01 and 06-10; sampling three days shows the step):
      ```python
      from datetime import date

      def test_e5_base_series_steps_with_movements(db, series):
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          make_fund(db, series, at=utc(2026, 6, 10), amount="50000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          days = [date(2026, 6, 1), date(2026, 6, 5), date(2026, 6, 10)]
          result = capital.base_series(db, series.id, "account", None, days)
          assert result[date(2026, 6, 1)] == Decimal("100000")   # first deposit included
          assert result[date(2026, 6, 5)] == Decimal("100000")   # no change yet
          assert result[date(2026, 6, 10)] == Decimal("150000")  # second deposit included
      ```
- [ ] Failing strategy-level sampling test (strategy base over days):
      ```python
      def test_e5_base_series_strategy_level(db, series, strategy):
          make_fund(db, series, at=utc(2026, 6, 1), amount="100000",
                    from_bucket="EXTERNAL", to_bucket="FREE_CASH")
          make_fund(db, series, at=utc(2026, 6, 3), amount="40000",
                    from_bucket="FREE_CASH", to_bucket="STRATEGY",
                    to_strategy_id=strategy.id)
          days = [date(2026, 6, 1), date(2026, 6, 3)]
          result = capital.base_series(db, series.id, "strategy", strategy.id, days)
          assert result[date(2026, 6, 1)] == Decimal("0")        # not yet allocated
          assert result[date(2026, 6, 3)] == Decimal("40000")
      ```
- [ ] Run: `uv run pytest tests/unit/test_capital.py -k "e5" -v`
      Expected fail: `AttributeError: ... has no attribute 'base_series'`.
- [ ] Minimal impl appended to `capital.py`:
      ```python
      from datetime import datetime, timedelta, timezone


      def _end_of_day(d):
          # last instant of UTC day d: next midnight minus 1 microsecond
          nxt = datetime(d.year, d.month, d.day, tzinfo=timezone.utc) + timedelta(days=1)
          return nxt - timedelta(microseconds=1)


      def base_series(session, series_id, level, ref_id, days):
          out = {}
          for d in days:
              at = _end_of_day(d)
              if level == "account":
                  out[d] = account_base(session, series_id, at)
              elif level == "strategy":
                  out[d] = strategy_base(session, series_id, ref_id, at)
              elif level == "free_cash":
                  out[d] = free_cash(session, series_id, at)
              else:
                  raise ValueError(f"unknown level {level!r}")
          return out
      ```
- [ ] Re-run: `uv run pytest tests/unit/test_capital.py -v` → expected `9 passed`.
- [ ] `uv run ruff check app/services/capital.py tests/unit/test_capital.py` → `All checks passed!`
- [ ] **Commit:** `git add -A && git commit -m "phase3: capital.base_series time-varying per-day sampling [E5]"`

---

## Phase 3 gate — full suite + coverage

- [ ] Run the whole Phase 3 unit suite:
      `uv run pytest tests/unit/test_fx.py tests/unit/test_pairing.py tests/unit/test_capital.py -v`
      Expected: `4 + 14 + 9 = 27 passed`.
- [ ] Coverage gate on the three services:
      `uv run pytest tests/unit/test_fx.py tests/unit/test_pairing.py tests/unit/test_capital.py --cov=app/services/fx --cov=app/services/pairing --cov=app/services/capital --cov-report=term-missing`
      Expected: each of `fx.py`, `pairing.py`, `capital.py` ≥ 90% (per DoD-1); inspect any
      `Missing` lines and add a targeted test if a branch is uncovered.
- [ ] `uv run ruff check app/services tests/unit` → `All checks passed!`
- [ ] **Commit (if coverage tests added):** `git add -A && git commit -m "phase3: coverage top-up for fx/pairing/capital"`

---

## Self-Review — acceptance criterion → task map

| Criterion | Where covered |
|-----------|---------------|
| **D1** long full pair | Task 2 `test_d1_long_full_pair` |
| **D2** short pair | Task 3 `test_d2_short_full_pair` |
| **D3** one-close-many-opens FIFO (100@10 then 50@11) | Task 4 `test_d3_one_close_many_opens_fifo` |
| **D4** many-closes-one-open | Task 5 `test_d4_many_closes_one_open` |
| **D5** fee pro-rata + open-leg reconciliation | Task 7 `test_d5_entry_fee_prorata_exit_full` (entry 10 across 40/100 → 4; open 6) |
| **D6** (strategy,symbol) isolation | Task 5 `test_d6_strategy_symbol_isolation` |
| **D7** open-only → no round-trip | Task 5 `test_d7_open_only_no_round_trip_fees_reconciled` |
| **D8** ts+client_fill_id tiebreak determinism | Task 4 `test_d8_same_ts_tiebreak_by_client_fill_id` |
| **D9** position_effect hint (optional) | Engine uses side + running net (Task 2); `position_effect` honored if present — covered by the net-position branch; add a hint-specific test if Phase 2 populates it |
| **D10** lot vs position grouping | Task 9 `test_d10_to_positions_groups_flat_to_flat`, `test_d10_two_positions_not_merged` |
| **M2-1** multiplier (futures 50, options 100) | Task 6 `test_m2_futures_multiplier_50` ((4012-4000)*2*50=1200), `test_m2_options_multiplier_100` |
| **FEE-2** partial-close entry fee pro-rata | Task 7 `test_d5_entry_fee_prorata_exit_full` |
| **FEE-3** open-leg fees excluded + reconciled | Task 5 `test_d7_...` + Task 7 `test_d5_...` (`open_fees`) |
| **FEE-4** negative fees / rebates | Task 7 `test_fee4_negative_rebate_in_total` |
| **CCY-2** instrument ccy → base conversion | Task 1 `test_to_base_converts_via_as_of_rate` (EUR 50→USD 55) |
| **CCY-3** missing rate → None (excluded, not 1.0) | Task 1 `test_missing_rate_returns_none`; Phase 4 metrics layer sets `fx_missing` on RoundTrip when `to_base` returns None |
| **E1** account base = net external | Task 10 `test_e1_account_base_is_net_external`, `test_e1_withdrawal_reduces_account_base` |
| **E2** inter-strategy transfer net-zero | Task 11 `test_e2_inter_strategy_transfer_net_zero` |
| **E3** strategy base | Task 11 `test_e3_strategy_base_net_inflow` |
| **E4** free cash | Task 11 `test_e4_free_cash_net` |
| **E5** time-varying per-day sampling | Task 12 `test_e5_base_series_steps_with_movements`, `test_e5_base_series_strategy_level` |
| **E6** external-only, no compounding | Task 10 `test_e6_trading_pnl_does_not_change_base` |
| **AUD-1** voided rows excluded | Task 10 `test_e1_voided_excluded_and_asof_cutoff`; pairing excludes `voided_at` (Task 2 engine `live` filter) |

**Out-of-phase (deferred to Phase 4, not built here):** equity/indexed curve, TWR, Sharpe/
Sortino/Calmar/CAGR/volatility, drawdown, trade-stats aggregation, the self-describing
envelope (`meta`/`flags`/`units`), benchmark alpha/beta/IR, and all HTTP routers/schemas.
Phase 3 delivers only `fx.py` (as_of_rate/to_base), `pairing.py` (pair_fills/fees_on_open_positions/
to_positions), `capital.py` (account_base/strategy_base/free_cash/base_series) and their unit
tests; these are the pure inputs Phase 4 orchestrates. Phase 4 is responsible for calling
`fx.to_base` on each round-trip when building base-currency metric views — pairing does
NOT convert FX.

**Determinism & precision invariants enforced throughout:** every fill is ordered by
`(ts, client_fill_id)`; every monetary assertion uses exact `Decimal` equality (no float);
voided rows are filtered before any computation; missing FX never silently assumes `1.0`;
`to_positions` groups by contiguity (open/close gap detection).