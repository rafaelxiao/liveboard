# LiveBoard Phase 2 — Series, Instruments & Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the ingestion layer of LiveBoard — create series (currency/tz/instruments), batch-append fills with dedup/partial-success/audit, fund movements, FX rates, benchmark returns, and soft-delete void — storing data only (no PnL/metrics; pairing is Phase 3).

**Architecture:** All business logic lives in `app/services/series.py` and `app/services/ingestion.py` as framework-free functions over a SQLAlchemy `Session`. Routers stay thin: parse → call one service → serialize. Models are typed SQLAlchemy 2.0 with `NUMERIC(28,10)` money/qty and `NUMERIC(28,12)` rates. Upserts use PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` via `sqlalchemy.dialects.postgresql.insert`.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2.0 (typed `Mapped[]`) / Alembic / PostgreSQL 16 / psycopg 3 / Pydantic v2 / pytest + httpx. Managed by `uv`.

## Global Constraints

[Copied verbatim from `2026-06-19-liveboard-implementation-roadmap.md` "Global Constraints (apply to every phase)".]

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates `NUMERIC(28,12)`; JSON numbers serialized as **strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (reject naive/non-UTC); trade date derived in series `session_tz`.
- **No financial computation in the frontend.** If a number is shown, the backend produced it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest` green before a phase gate.
- Per-user data isolation everywhere; voided rows excluded from all computation.

**Phase 2 additional rules (from design §4/§8 + tech-stack ADR):**
- `base_currency` is ISO-4217 (e.g. `"USD"`); `session_tz` is an IANA tz (e.g. `"America/New_York"`); both validated at series creation (`422` on bad input).
- Symbols normalized **uppercase + trim**; strategy `name_key` normalized **lower + trim**.
- Fee components (`commission`, `exchange_fee`, `regulatory_fee`, `financing_fee`) default `0` and **may be negative** (maker rebates).
- `qty > 0`; `side ∈ {buy, sell}`; `position_effect` optional.
- Unknown symbol → auto-create `Instrument(asset_class=equity, multiplier=1, currency=base_currency, inferred=true)`; explicit `POST /instruments` sets `inferred=false`.
- FundMovement: `from_bucket != to_bucket`, `amount > 0`, `bucket ∈ {EXTERNAL, FREE_CASH, STRATEGY}`, strategy id required when a bucket is `STRATEGY`.
- Batch cap: **10,000 fills** per `:batch` request → `413` (whole batch rejected, nothing stored).
- Partial success: valid rows commit in **one transaction**; invalid rows reported per-row; every call writes an `IngestionBatch` audit row.
- Void = soft-delete (`voided_at`); rows retained for audit, excluded from all computation. Never hard-delete.
- Ingestion auth is dual-mode (`X-API-Key` primary, JWT for frontend edits); both resolve to a user via `get_api_user` / `get_current_user`, then per-user ownership applies (cannot append to another user's series).

---

## File Structure

**Phases 0–1 are assumed complete.** The following already exist and are **consumed** (not created) by this phase:
- `app/main.py` (app factory, CORS, router aggregator, startup admin-seed)
- `app/db.py` (`engine`, `SessionLocal`, `Base`, `get_db`)
- `app/core/config.py` (`Settings`, env vars)
- `app/core/errors.py` (typed domain exceptions + handlers → uniform error JSON)
- `app/core/deps.py` (`get_current_user` JWT, `get_api_user` X-API-Key touching `last_used_at`, `require_admin`, `require_approved`)
- `app/models/user.py` (`User`), `app/models/api_key.py` (`ApiKey`)
- `app/models/__init__.py` (imports all models so Alembic autogenerate sees them)
- `app/routers/__init__.py` (`api_router` aggregator)
- `tests/conftest.py` (test engine/session, `TestClient`, factory helpers, auth/api-key fixtures)

**Created / modified in this phase:**

| File | Responsibility |
|------|----------------|
| `app/models/series.py` | `Series(id, user_id, name, tag, notes, base_currency, session_tz, created_at)` |
| `app/models/account.py` | `Account(id, series_id unique 1:1)` |
| `app/models/strategy.py` | `Strategy(id, series_id, name, name_key)`; `unique(series_id, name)` |
| `app/models/instrument.py` | `Instrument(id, series_id, symbol, asset_class, currency, multiplier, tick_size?, lot_size?, inferred)`; `unique(series_id, symbol)` |
| `app/models/fx_rate.py` | `FxRate(id, series_id, ccy_from, ccy_to, ts, rate NUMERIC(28,12))` |
| `app/models/benchmark_return.py` | `BenchmarkReturn(id, series_id, name, ts, return_pct NUMERIC(28,12))` |
| `app/models/fund_movement.py` | `FundMovement(id, series_id, ts, currency, amount, from_bucket, to_bucket, from_strategy_id?, to_strategy_id?, created_at, updated_at, voided_at?)` |
| `app/models/fill.py` | `Fill(id, series_id, strategy_id, symbol, side, qty, price, 4 fee cols, ts, client_fill_id, signal_id?, position_effect?, created_at, updated_at, voided_at?)`; `unique(series_id, client_fill_id)` |
| `app/models/ingestion_batch.py` | `IngestionBatch(id, series_id, api_key_id, received_at, kind, inserted, updated, rejected)` |
| `app/models/enums.py` | `AssetClass`, `Side`, `Bucket`, `PositionEffect`, `IngestionKind` enums |
| `app/models/__init__.py` (modify) | add imports for all new models |
| `app/schemas/series.py` | `StrategyIn`, `SeriesCreateIn`, `SeriesOut`, `SeriesDetailOut`, `SeriesCounts` |
| `app/schemas/instrument.py` | `InstrumentIn`, `InstrumentOut`, `InstrumentUpsertOut` |
| `app/schemas/fx.py` | `FxRateIn`, `FxIngestOut` |
| `app/schemas/benchmark.py` | `BenchmarkReturnIn`, `BenchmarkIn`, `BenchmarkIngestOut` |
| `app/schemas/ingestion.py` | `FillIn`, `FillBatchIn`, `BatchResultOut`, `BatchError`, `FundMovementIn`, `FundIngestOut`, `VoidFillsIn`, `VoidOut` |
| `app/services/series.py` | `create_series`, `list_series`, `get_series_detail` |
| `app/services/ingestion.py` | `ingest_fills_batch`, `ingest_fund_movements`, `void_fills`, `upsert_instruments`, `ingest_fx_rates`, `ingest_benchmark`, plus normalization/validation helpers + auto-create helpers |
| `app/routers/series.py` | `POST /series`, `GET /series`, `GET /series/{id}` |
| `app/routers/ingestion.py` | `POST /series/{id}/fills:batch`, `POST /series/{id}/fund-movements`, `POST /series/{id}/fills:void` |
| `app/routers/instruments.py` | `POST /series/{id}/instruments` |
| `app/routers/fx.py` | `POST /series/{id}/fx-rates` |
| `app/routers/benchmark.py` | `POST /series/{id}/benchmark` |
| `app/routers/__init__.py` (modify) | register the 5 new routers on `api_router` |
| `app/alembic/versions/0002_phase2_ingestion.py` | one migration creating all 9 tables with `unique(series_id, client_fill_id)`, `unique(series_id, symbol)`, `unique(series_id, name)`, `NUMERIC(28,10)`/`(28,12)` columns, `voided_at` soft-delete cols, FK/index definitions |
| `tests/unit/test_ingestion.py` | service-layer unit tests (upsert dedup, partial success, 10k cap, auto-create, void, audit, UTC/tz validation, trade-date in session_tz, fund-movement validation) |
| `tests/unit/test_series.py` | service-layer unit tests for `create_series`/`list_series`/`get_series_detail` |
| `tests/api/test_ingestion_api.py` | batch dedup, partial success, 413 cap, fund movements, void, audit-batch recorded, per-user ownership |
| `tests/api/test_instruments_api.py` | POST instruments upsert + inferred-on-unknown-symbol |
| `tests/api/test_fx_api.py` | POST fx-rates ingest |
| `tests/api/test_benchmark_api.py` | POST benchmark ingest |

---

## Test environment assumptions (from Phase 0/1 `tests/conftest.py`)

These fixtures already exist and are used by every test below:

- `db_session: Session` — SQLAlchemy session bound to `TEST_DATABASE_URL`; schema is created via `Base.metadata.create_all(bind=engine)` (per structure doc §1.4 "or `create_all` for speed — pick one"), rolled back per test. **Models become available to tests as soon as their module is imported in `app/models/__init__.py`**; the Alembic migration is verified separately in Task 12 for DoD-5.
- `client: TestClient` — FastAPI `TestClient` over the app factory.
- `make_user(db_session, *, status="approved", role="user", email=None) -> User`
- `make_api_key(db_session, user) -> tuple[ApiKey, str]` — returns the `ApiKey` row and the **raw** key string (`X-API-Key` value).
- `auth_header(user) -> dict` — returns a JWT `Authorization` header for `user`.

`User` (Phase 1) has fields `id, email, password_hash, role, status, created_at`; `ApiKey` has `id, user_id, ...`.

All commands run from `backend/`. Run a single test with e.g. `uv run pytest tests/unit/test_series.py::test_create_series_creates_account -v`.

---

## Tasks

### Task 1: Series + Account models, enums, and series create/list/detail

**Files:**
- Create: `app/models/enums.py`
- Create: `app/models/series.py`
- Create: `app/models/account.py`
- Modify: `app/models/__init__.py`
- Create: `app/schemas/series.py`
- Create: `app/services/series.py`
- Create: `app/routers/series.py`
- Modify: `app/routers/__init__.py`
- Test: `tests/unit/test_series.py`

**Interfaces:**
- Consumes: `app.db.Base`, `app.db.get_db`, `app.core.deps.get_api_user -> User`, `app.core.deps.get_current_user -> User`, `app.models.user.User`.
- Produces:
  - `app.models.enums`: `AssetClass`, `Side`, `Bucket`, `PositionEffect`, `IngestionKind` (all `enum.StrEnum`).
  - `app.models.series.Series`, `app.models.account.Account`.
  - `app.services.series.create_series(session, *, user_id: int, data: SeriesCreateIn) -> int` (returns `series_id`).
  - `app.services.series.list_series(session, *, user_id: int) -> list[SeriesOut]`.
  - `app.services.series.get_series_detail(session, *, user_id: int, series_id: int) -> SeriesDetailOut`.
  - `app.services.series.get_owned_series(session, user_id: int, series_id: int) -> Series` (raises `SeriesNotFound`).
  - `app.services.series.SeriesNotFound(Exception)`.
  - `app.schemas.series`: `StrategyIn`, `SeriesCreateIn`, `SeriesOut`, `SeriesCounts`, `SeriesDetailOut`.

- [ ] **Step 1: Write the failing test** — `tests/unit/test_series.py`

```python
import pytest
from app.models.series import Series
from app.models.account import Account
from app.schemas.series import SeriesCreateIn
from app.services.series import create_series, get_series_detail, get_owned_series, SeriesNotFound


def test_create_series_creates_account(db_session):
    user = _make_user(db_session)
    sid = create_series(
        db_session,
        user_id=user.id,
        data=SeriesCreateIn(name="Real", tag="real", base_currency="USD", session_tz="America/New_York"),
    )
    series = db_session.get(Series, sid)
    assert series.user_id == user.id
    assert series.base_currency == "USD"
    acct = db_session.query(Account).filter_by(series_id=sid).one()
    assert acct.series_id == sid


def test_create_series_rejects_bad_currency():
    with pytest.raises(Exception):
        SeriesCreateIn(name="x", base_currency="US", session_tz="UTC")


def test_create_series_rejects_bad_tz():
    with pytest.raises(Exception):
        SeriesCreateIn(name="x", base_currency="USD", session_tz="Mars/Olympus")


def test_get_series_detail_enforces_ownership(db_session):
    owner = _make_user(db_session, email="a@x.com")
    other = _make_user(db_session, email="b@x.com")
    sid = create_series(
        db_session, user_id=owner.id,
        data=SeriesCreateIn(name="R", base_currency="USD", session_tz="UTC"),
    )
    with pytest.raises(SeriesNotFound):
        get_series_detail(db_session, user_id=other.id, series_id=sid)
    detail = get_series_detail(db_session, user_id=owner.id, series_id=sid)
    assert detail.id == sid


def _make_user(db_session, email="u@x.com"):
    from app.models.user import User
    u = User(email=email, password_hash="x", role="user", status="approved")
    db_session.add(u)
    db_session.flush()
    return u
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_series.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.series'`.

- [ ] **Step 3: Write the enums** — `app/models/enums.py`

```python
from enum import StrEnum


class AssetClass(StrEnum):
    EQUITY = "equity"
    FUTURE = "future"
    OPTION = "option"
    FX = "fx"
    CRYPTO = "crypto"
    CFD = "cfd"


class Side(StrEnum):
    BUY = "buy"
    SELL = "sell"


class Bucket(StrEnum):
    EXTERNAL = "EXTERNAL"
    FREE_CASH = "FREE_CASH"
    STRATEGY = "STRATEGY"


class PositionEffect(StrEnum):
    OPEN = "open"
    CLOSE = "close"


class IngestionKind(StrEnum):
    FILLS = "fills"
    FUND_MOVEMENTS = "fund_movements"
    INSTRUMENTS = "instruments"
    FX_RATES = "fx_rates"
    BENCHMARK = "benchmark"
```

- [ ] **Step 4: Write the Series model** — `app/models/series.py`

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Series(Base):
    __tablename__ = "series"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tag: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(String(2000))
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    session_tz: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
```

- [ ] **Step 5: Write the Account model** — `app/models/account.py`

```python
from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), unique=True, nullable=False
    )
```

- [ ] **Step 6: Register models** — modify `app/models/__init__.py`

Add to the existing imports (so Alembic + `create_all` see them):

```python
from app.models.series import Series  # noqa: F401
from app.models.account import Account  # noqa: F401
```

- [ ] **Step 7: Write the schemas** — `app/schemas/series.py`

```python
import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, field_validator

_CCY_RE = re.compile(r"^[A-Z]{3}$")


class StrategyIn(BaseModel):
    name: str


class SeriesCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    tag: str | None = None
    notes: str | None = None
    base_currency: str
    session_tz: str
    strategies: list[StrategyIn] | None = None
    instruments: list["InstrumentIn"] | None = None
    fund_movements: list["FundMovementIn"] | None = None

    @field_validator("base_currency")
    @classmethod
    def _ccy(cls, v: str) -> str:
        if not _CCY_RE.match(v):
            raise ValueError("base_currency must be a 3-letter ISO-4217 code")
        return v

    @field_validator("session_tz")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("session_tz must be a valid IANA timezone") from exc
        return v


class SeriesCounts(BaseModel):
    strategies: int
    instruments: int
    fills: int


class SeriesOut(BaseModel):
    id: int
    name: str
    tag: str | None
    base_currency: str
    session_tz: str
    created_at: datetime
    counts: SeriesCounts


class InstrumentDetailOut(BaseModel):
    symbol: str
    asset_class: str
    currency: str
    multiplier: str
    tick_size: str | None
    lot_size: str | None
    inferred: bool


class SeriesDetailOut(BaseModel):
    id: int
    name: str
    tag: str | None
    notes: str | None
    base_currency: str
    session_tz: str
    created_at: datetime
    strategies: list[str]
    instruments: list[InstrumentDetailOut]
    discovered_symbols: list[str]


# Resolve forward refs from sibling schema modules (defined in later tasks).
from app.schemas.instrument import InstrumentIn  # noqa: E402
from app.schemas.ingestion import FundMovementIn  # noqa: E402

SeriesCreateIn.model_rebuild()
```

> Note: `InstrumentIn` and `FundMovementIn` are created in Tasks 3 and 6. Until then, create minimal stubs so this imports — but since Task 3/6 follow, the simplest TDD path is to make the forward-ref optional fields `list[dict] | None` for now and tighten in Task 3/6. To keep Task 1 self-contained, replace the two `from app.schemas...` imports and `model_rebuild()` with `list[dict] | None` typing on `instruments`/`fund_movements` and drop the rebuild; Task 3 and Task 6 will re-type them.

For Task 1, use this self-contained version of the optional fields (no cross-module import):

```python
    strategies: list[StrategyIn] | None = None
    instruments: list[dict] | None = None
    fund_movements: list[dict] | None = None
```

(and omit the trailing import/`model_rebuild()` block). Tasks 3 and 6 will replace `list[dict]` with the real `InstrumentIn`/`FundMovementIn` types.

- [ ] **Step 8: Write the series service** — `app/services/series.py`

```python
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.series import Series
from app.schemas.series import (
    InstrumentDetailOut,
    SeriesCounts,
    SeriesCreateIn,
    SeriesDetailOut,
    SeriesOut,
)


class SeriesNotFound(Exception):
    pass


def create_series(session: Session, *, user_id: int, data: SeriesCreateIn) -> int:
    series = Series(
        user_id=user_id,
        name=data.name,
        tag=data.tag,
        notes=data.notes,
        base_currency=data.base_currency,
        session_tz=data.session_tz,
    )
    session.add(series)
    session.flush()  # assigns series.id
    session.add(Account(series_id=series.id))

    # Optional nested creation is delegated to ingestion helpers in later tasks.
    if data.strategies:
        from app.services.ingestion import get_or_create_strategy

        cache: dict[str, int] = {}
        for s in data.strategies:
            get_or_create_strategy(session, series.id, s.name, cache)
    if data.instruments:
        from app.schemas.instrument import InstrumentIn
        from app.services.ingestion import upsert_instruments

        upsert_instruments(
            session,
            series_id=series.id,
            instruments=[InstrumentIn(**i) for i in data.instruments],
        )
    if data.fund_movements:
        from app.schemas.ingestion import FundMovementIn
        from app.services.ingestion import ingest_fund_movements

        ingest_fund_movements(
            session,
            series_id=series.id,
            movements=[FundMovementIn(**m) for m in data.fund_movements],
        )

    session.flush()
    return series.id


def get_owned_series(session: Session, user_id: int, series_id: int) -> Series:
    series = session.get(Series, series_id)
    if series is None or series.user_id != user_id:
        raise SeriesNotFound(f"series {series_id} not found")
    return series


def list_series(session: Session, *, user_id: int) -> list[SeriesOut]:
    from app.models.fill import Fill
    from app.models.instrument import Instrument
    from app.models.strategy import Strategy

    rows = session.scalars(
        select(Series).where(Series.user_id == user_id).order_by(Series.id)
    ).all()
    out: list[SeriesOut] = []
    for s in rows:
        strat_n = session.scalar(
            select(func.count()).select_from(Strategy).where(Strategy.series_id == s.id)
        )
        inst_n = session.scalar(
            select(func.count()).select_from(Instrument).where(Instrument.series_id == s.id)
        )
        fill_n = session.scalar(
            select(func.count())
            .select_from(Fill)
            .where(Fill.series_id == s.id, Fill.voided_at.is_(None))
        )
        out.append(
            SeriesOut(
                id=s.id,
                name=s.name,
                tag=s.tag,
                base_currency=s.base_currency,
                session_tz=s.session_tz,
                created_at=s.created_at,
                counts=SeriesCounts(strategies=strat_n, instruments=inst_n, fills=fill_n),
            )
        )
    return out


def get_series_detail(session: Session, *, user_id: int, series_id: int) -> SeriesDetailOut:
    from app.models.fill import Fill
    from app.models.instrument import Instrument
    from app.models.strategy import Strategy

    series = get_owned_series(session, user_id, series_id)
    strategies = session.scalars(
        select(Strategy.name).where(Strategy.series_id == series_id).order_by(Strategy.name)
    ).all()
    instruments = session.scalars(
        select(Instrument).where(Instrument.series_id == series_id).order_by(Instrument.symbol)
    ).all()
    discovered = session.scalars(
        select(Fill.symbol)
        .where(Fill.series_id == series_id, Fill.voided_at.is_(None))
        .distinct()
        .order_by(Fill.symbol)
    ).all()
    return SeriesDetailOut(
        id=series.id,
        name=series.name,
        tag=series.tag,
        notes=series.notes,
        base_currency=series.base_currency,
        session_tz=series.session_tz,
        created_at=series.created_at,
        strategies=list(strategies),
        instruments=[
            InstrumentDetailOut(
                symbol=i.symbol,
                asset_class=i.asset_class,
                currency=i.currency,
                multiplier=_dec(i.multiplier),
                tick_size=_dec(i.tick_size),
                lot_size=_dec(i.lot_size),
                inferred=i.inferred,
            )
            for i in instruments
        ],
        discovered_symbols=list(discovered),
    )


def _dec(value: Decimal | None) -> str | None:
    return None if value is None else str(value)
```

> Note: `list_series`/`get_series_detail` import `Fill`/`Instrument`/`Strategy` lazily, so Task 1 tests that only touch `create_series`/`get_owned_series` pass before those models exist — but `test_get_series_detail_enforces_ownership` calls `get_series_detail`, which imports them. **Therefore Task 1's detail test requires Tasks 2 & 3 models.** To keep Task 1 independently green, the detail test in Step 1 only asserts ownership raise + `detail.id`; if `Strategy`/`Instrument`/`Fill` are not yet present, temporarily guard the lazy imports with `try/except ImportError` returning empty lists. Tasks 2/3 remove the guards. (Simpler alternative: move `test_get_series_detail_enforces_ownership` to Task 3. Pick one; the plan assumes the guard approach so Task 1 is self-contained.)

- [ ] **Step 9: Write the router** — `app/routers/series.py`

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user, get_current_user
from app.db import get_db
from app.models.user import User
from app.schemas.series import SeriesCreateIn, SeriesDetailOut, SeriesOut
from app.services.series import (
    SeriesNotFound,
    create_series,
    get_series_detail,
    list_series,
)

router = APIRouter(tags=["series"])


@router.post("/series", status_code=status.HTTP_201_CREATED)
def post_series(
    body: SeriesCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> dict:
    series_id = create_series(db, user_id=user.id, data=body)
    return {"series_id": series_id}


@router.get("/series", response_model=list[SeriesOut])
def get_series_list(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SeriesOut]:
    return list_series(db, user_id=user.id)


@router.get("/series/{series_id}", response_model=SeriesDetailOut)
def get_series_one(
    series_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SeriesDetailOut:
    try:
        return get_series_detail(db, user_id=user.id, series_id=series_id)
    except SeriesNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="series not found")
```

- [ ] **Step 10: Register the router** — modify `app/routers/__init__.py`

```python
from app.routers import series as series_router

api_router.include_router(series_router.router)
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_series.py -v`
Expected: PASS (4 passed).

- [ ] **Step 12: Commit**

```bash
git add app/models/enums.py app/models/series.py app/models/account.py app/models/__init__.py \
        app/schemas/series.py app/services/series.py app/routers/series.py app/routers/__init__.py \
        tests/unit/test_series.py
git commit -m "feat(series): Series+Account models, enums, create/list/detail service+router"
```

---

### Task 2: Strategy model + name_key normalization + auto-create

**Files:**
- Create: `app/models/strategy.py`
- Modify: `app/models/__init__.py`
- Create: `app/services/ingestion.py` (start the module with normalization + strategy auto-create)
- Test: `tests/unit/test_ingestion.py`

**Interfaces:**
- Consumes: `app.db.Base`, `Series` (Task 1).
- Produces:
  - `app.models.strategy.Strategy` with `unique(series_id, name)`.
  - `app.services.ingestion.normalize_strategy_name(name: str) -> tuple[str, str]` → `(name_stripped, name_key)` where `name_key = name.strip().lower()`.
  - `app.services.ingestion.normalize_symbol(symbol: str) -> str` → `symbol.strip().upper()`.
  - `app.services.ingestion.get_or_create_strategy(session, series_id: int, name: str, cache: dict[str, int]) -> int` (returns `strategy_id`; idempotent per `name_key`).

- [ ] **Step 1: Write the failing test** — append to `tests/unit/test_ingestion.py`

```python
from app.schemas.series import SeriesCreateIn
from app.services.series import create_series
from app.services.ingestion import (
    get_or_create_strategy,
    normalize_strategy_name,
    normalize_symbol,
)
from app.models.strategy import Strategy


def _series(db_session):
    from app.models.user import User
    u = User(email="t@x.com", password_hash="x", role="user", status="approved")
    db_session.add(u)
    db_session.flush()
    sid = create_series(
        db_session, user_id=u.id,
        data=SeriesCreateIn(name="R", base_currency="USD", session_tz="UTC"),
    )
    return sid


def test_normalize_helpers():
    assert normalize_strategy_name("  Momentum  ") == ("Momentum", "momentum")
    assert normalize_symbol("  aapl ") == "AAPL"


def test_get_or_create_strategy_is_idempotent(db_session):
    sid = _series(db_session)
    cache: dict[str, int] = {}
    a = get_or_create_strategy(db_session, sid, "Momentum", cache)
    b = get_or_create_strategy(db_session, sid, " momentum ", cache)  # same name_key
    assert a == b
    rows = db_session.query(Strategy).filter_by(series_id=sid).all()
    assert len(rows) == 1
    assert rows[0].name_key == "momentum"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_ingestion.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.strategy'`.

- [ ] **Step 3: Write the Strategy model** — `app/models/strategy.py`

```python
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Strategy(Base):
    __tablename__ = "strategies"
    __table_args__ = (UniqueConstraint("series_id", "name", name="uq_strategy_series_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    name_key: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
```

- [ ] **Step 4: Register the model** — modify `app/models/__init__.py`

```python
from app.models.strategy import Strategy  # noqa: F401
```

- [ ] **Step 5: Write the ingestion module start** — `app/services/ingestion.py`

```python
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.strategy import Strategy


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def normalize_strategy_name(name: str) -> tuple[str, str]:
    stripped = name.strip()
    return stripped, stripped.lower()


def get_or_create_strategy(
    session: Session, series_id: int, name: str, cache: dict[str, int]
) -> int:
    stripped, name_key = normalize_strategy_name(name)
    if name_key in cache:
        return cache[name_key]
    existing = session.scalar(
        select(Strategy).where(Strategy.series_id == series_id, Strategy.name_key == name_key)
    )
    if existing is None:
        existing = Strategy(series_id=series_id, name=stripped, name_key=name_key)
        session.add(existing)
        session.flush()
    cache[name_key] = existing.id
    return existing.id
```

- [ ] **Step 6: Remove the Task-1 detail-test import guard** (if used) — `app/services/series.py`: the lazy `Strategy` import now resolves cleanly.

- [ ] **Step 7: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_ingestion.py tests/unit/test_series.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/models/strategy.py app/models/__init__.py app/services/ingestion.py \
        app/services/series.py tests/unit/test_ingestion.py
git commit -m "feat(strategy): Strategy model + name_key normalization + idempotent auto-create"
```

---

### Task 3: Instrument model + inferred auto-create + instruments endpoint

**Files:**
- Create: `app/models/instrument.py`
- Modify: `app/models/__init__.py`
- Create: `app/schemas/instrument.py`
- Modify: `app/services/ingestion.py` (add `get_or_create_instrument`, `upsert_instruments`)
- Modify: `app/schemas/series.py` (re-type `instruments` field to `list[InstrumentIn]`)
- Create: `app/routers/instruments.py`
- Modify: `app/routers/__init__.py`
- Test: `tests/unit/test_ingestion.py` (append), `tests/api/test_instruments_api.py`

**Interfaces:**
- Consumes: `Series`, `get_owned_series`, `get_api_user`.
- Produces:
  - `app.models.instrument.Instrument` with `unique(series_id, symbol)`, `multiplier NUMERIC(28,12)`, `tick_size/lot_size NUMERIC(28,10)` nullable, `inferred bool`.
  - `app.schemas.instrument.InstrumentIn(symbol, asset_class, currency, multiplier=Decimal("1"), tick_size=None, lot_size=None)`, `InstrumentOut`, `InstrumentUpsertOut(upserted: int)`.
  - `app.services.ingestion.get_or_create_instrument(session, series_id, symbol, base_currency, cache: set[str]) -> None` (auto-creates inferred=True if absent).
  - `app.services.ingestion.upsert_instruments(session, *, series_id, instruments: list[InstrumentIn]) -> int` (upsert by `(series_id, symbol)`, sets `inferred=False`).

- [ ] **Step 1: Write the failing API test** — `tests/api/test_instruments_api.py`

```python
def test_post_instruments_upserts_and_clears_inferred(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series", headers=h,
        json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]

    r = client.post(
        f"/series/{sid}/instruments", headers=h,
        json=[{"symbol": "es", "asset_class": "future", "currency": "USD", "multiplier": "50"}],
    )
    assert r.status_code == 201
    assert r.json() == {"upserted": 1}

    detail = client.get(f"/series/{sid}", headers=_jwt(user)).json()
    inst = next(i for i in detail["instruments"] if i["symbol"] == "ES")
    assert inst["asset_class"] == "future"
    assert inst["multiplier"] == "50"
    assert inst["inferred"] is False


def _jwt(user):
    # auth_header fixture from conftest produces the JWT header
    from tests.conftest import auth_header  # if exposed; otherwise inject the fixture
    return auth_header(user)
```

> If `auth_header` is a pytest fixture (not importable), inject it as a test argument instead of importing: `def test_...(..., auth_header):` and call `auth_header(user)`.

- [ ] **Step 2: Write the failing unit test** — append to `tests/unit/test_ingestion.py`

```python
from decimal import Decimal
from app.models.instrument import Instrument
from app.schemas.instrument import InstrumentIn
from app.services.ingestion import get_or_create_instrument, upsert_instruments


def test_auto_create_instrument_is_inferred(db_session):
    sid = _series(db_session)
    cache: set[str] = set()
    get_or_create_instrument(db_session, sid, "AAPL", "USD", cache)
    inst = db_session.query(Instrument).filter_by(series_id=sid, symbol="AAPL").one()
    assert inst.inferred is True
    assert inst.asset_class == "equity"
    assert inst.multiplier == Decimal("1")
    assert inst.currency == "USD"


def test_upsert_instruments_sets_inferred_false(db_session):
    sid = _series(db_session)
    cache: set[str] = set()
    get_or_create_instrument(db_session, sid, "ES", "USD", cache)  # inferred future-as-equity
    n = upsert_instruments(
        db_session, series_id=sid,
        instruments=[InstrumentIn(symbol="es", asset_class="future", currency="USD", multiplier=Decimal("50"))],
    )
    assert n == 1
    inst = db_session.query(Instrument).filter_by(series_id=sid, symbol="ES").one()
    assert inst.inferred is False
    assert inst.multiplier == Decimal("50")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/unit/test_ingestion.py -k instrument -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.instrument'`.

- [ ] **Step 4: Write the Instrument model** — `app/models/instrument.py`

```python
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Instrument(Base):
    __tablename__ = "instruments"
    __table_args__ = (UniqueConstraint("series_id", "symbol", name="uq_instrument_series_symbol"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False
    )
    symbol: Mapped[str] = mapped_column(String(64), nullable=False)
    asset_class: Mapped[str] = mapped_column(String(16), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    multiplier: Mapped[Decimal] = mapped_column(
        Numeric(28, 12), nullable=False, default=Decimal("1")
    )
    tick_size: Mapped[Decimal | None] = mapped_column(Numeric(28, 10))
    lot_size: Mapped[Decimal | None] = mapped_column(Numeric(28, 10))
    inferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

- [ ] **Step 5: Register the model** — modify `app/models/__init__.py`

```python
from app.models.instrument import Instrument  # noqa: F401
```

- [ ] **Step 6: Write the schemas** — `app/schemas/instrument.py`

```python
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import AssetClass


class InstrumentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    asset_class: AssetClass
    currency: str
    multiplier: Decimal = Decimal("1")
    tick_size: Decimal | None = None
    lot_size: Decimal | None = None


class InstrumentOut(BaseModel):
    symbol: str
    asset_class: str
    currency: str
    multiplier: str
    tick_size: str | None
    lot_size: str | None
    inferred: bool


class InstrumentUpsertOut(BaseModel):
    upserted: int
```

- [ ] **Step 7: Re-type the series schema** — modify `app/schemas/series.py`

Replace `instruments: list[dict] | None = None` with the real type and rebuild:

```python
    instruments: list["InstrumentIn"] | None = None
```

and at the bottom of the module:

```python
from app.schemas.instrument import InstrumentIn  # noqa: E402

SeriesCreateIn.model_rebuild()
```

Also update `create_series` (Task 1 Step 8) to drop the `InstrumentIn(**i)` dict-coercion — `data.instruments` items are already `InstrumentIn`:

```python
    if data.instruments:
        from app.services.ingestion import upsert_instruments

        upsert_instruments(session, series_id=series.id, instruments=data.instruments)
```

- [ ] **Step 8: Add instrument service functions** — modify `app/services/ingestion.py`

```python
from decimal import Decimal

from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.instrument import Instrument
from app.schemas.instrument import InstrumentIn


def get_or_create_instrument(
    session: Session, series_id: int, symbol: str, base_currency: str, cache: set[str]
) -> None:
    sym = normalize_symbol(symbol)
    if sym in cache:
        return
    existing = session.scalar(
        select(Instrument).where(Instrument.series_id == series_id, Instrument.symbol == sym)
    )
    if existing is None:
        session.add(
            Instrument(
                series_id=series_id,
                symbol=sym,
                asset_class="equity",
                currency=base_currency,
                multiplier=Decimal("1"),
                inferred=True,
            )
        )
        session.flush()
    cache.add(sym)


def upsert_instruments(
    session: Session, *, series_id: int, instruments: list[InstrumentIn]
) -> int:
    n = 0
    for spec in instruments:
        sym = normalize_symbol(spec.symbol)
        stmt = (
            pg_insert(Instrument)
            .values(
                series_id=series_id,
                symbol=sym,
                asset_class=str(spec.asset_class),
                currency=spec.currency,
                multiplier=spec.multiplier,
                tick_size=spec.tick_size,
                lot_size=spec.lot_size,
                inferred=False,
            )
            .on_conflict_do_update(
                index_elements=["series_id", "symbol"],
                set_={
                    "asset_class": str(spec.asset_class),
                    "currency": spec.currency,
                    "multiplier": spec.multiplier,
                    "tick_size": spec.tick_size,
                    "lot_size": spec.lot_size,
                    "inferred": False,
                },
            )
        )
        session.execute(stmt)
        n += 1
    session.flush()
    return n
```

> `on_conflict_do_update(index_elements=["series_id", "symbol"], ...)` targets the `uq_instrument_series_symbol` unique constraint — this is the real PostgreSQL UPSERT. `str(spec.asset_class)` flattens the `AssetClass` StrEnum to its value.

- [ ] **Step 9: Write the router** — `app/routers/instruments.py`

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user
from app.db import get_db
from app.models.user import User
from app.schemas.instrument import InstrumentIn, InstrumentUpsertOut
from app.services.ingestion import upsert_instruments
from app.services.series import SeriesNotFound, get_owned_series

router = APIRouter(tags=["instruments"])


@router.post(
    "/series/{series_id}/instruments",
    status_code=status.HTTP_201_CREATED,
    response_model=InstrumentUpsertOut,
)
def post_instruments(
    series_id: int,
    body: list[InstrumentIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> InstrumentUpsertOut:
    try:
        get_owned_series(db, user.id, series_id)
    except SeriesNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="series not found")
    n = upsert_instruments(db, series_id=series_id, instruments=body)
    db.commit()
    return InstrumentUpsertOut(upserted=n)
```

- [ ] **Step 10: Register the router** — modify `app/routers/__init__.py`

```python
from app.routers import instruments as instruments_router

api_router.include_router(instruments_router.router)
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_ingestion.py tests/api/test_instruments_api.py -v`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add app/models/instrument.py app/models/__init__.py app/schemas/instrument.py \
        app/schemas/series.py app/services/ingestion.py app/routers/instruments.py \
        app/routers/__init__.py tests/unit/test_ingestion.py tests/api/test_instruments_api.py
git commit -m "feat(instrument): Instrument model + inferred auto-create + upsert endpoint"
```

---

### Task 4: FxRate model + fx-rates endpoint

**Files:**
- Create: `app/models/fx_rate.py`
- Modify: `app/models/__init__.py`
- Create: `app/schemas/fx.py`
- Modify: `app/services/ingestion.py` (add `ingest_fx_rates`)
- Create: `app/routers/fx.py`
- Modify: `app/routers/__init__.py`
- Test: `tests/api/test_fx_api.py`

**Interfaces:**
- Consumes: `Series`, `get_owned_series`, `get_api_user`, `require_utc` (Task 7 introduces `require_utc`; for Task 4 use a local UTC check — see note).
- Produces:
  - `app.models.fx_rate.FxRate(id, series_id, ccy_from, ccy_to, ts, rate NUMERIC(28,12))`.
  - `app.schemas.fx.FxRateIn(ccy_from, ccy_to, ts: datetime, rate: Decimal)`, `FxIngestOut(ingested: int)`.
  - `app.services.ingestion.ingest_fx_rates(session, *, series_id, rates: list[FxRateIn]) -> int`.

> **UTC handling:** `ts` validation is centralized in Task 7 (`ensure_utc`). To keep Task 4 self-contained, define `ensure_utc` now in `app/services/ingestion.py` (Task 7 reuses it, does not redefine). Code shown below.

- [ ] **Step 1: Write the failing API test** — `tests/api/test_fx_api.py`

```python
def test_post_fx_rates_ingests(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series", headers=h,
        json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]

    r = client.post(
        f"/series/{sid}/fx-rates", headers=h,
        json=[
            {"ccy_from": "EUR", "ccy_to": "USD", "ts": "2026-06-19T00:00:00Z", "rate": "1.082000000000"},
            {"ccy_from": "EUR", "ccy_to": "USD", "ts": "2026-06-19T12:00:00Z", "rate": "1.090000000000"},
        ],
    )
    assert r.status_code == 201
    assert r.json() == {"ingested": 2}


def test_post_fx_rates_rejects_naive_ts(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series", headers=h, json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]
    r = client.post(
        f"/series/{sid}/fx-rates", headers=h,
        json=[{"ccy_from": "EUR", "ccy_to": "USD", "ts": "2026-06-19T00:00:00", "rate": "1.0"}],
    )
    assert r.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_fx_api.py -v`
Expected: FAIL — 404/500 (route not registered) or `ModuleNotFoundError`.

- [ ] **Step 3: Write the FxRate model** — `app/models/fx_rate.py`

```python
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class FxRate(Base):
    __tablename__ = "fx_rates"
    __table_args__ = (
        Index("ix_fxrate_lookup", "series_id", "ccy_from", "ccy_to", "ts"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )
    ccy_from: Mapped[str] = mapped_column(String(3), nullable=False)
    ccy_to: Mapped[str] = mapped_column(String(3), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
```

- [ ] **Step 4: Register the model** — modify `app/models/__init__.py`

```python
from app.models.fx_rate import FxRate  # noqa: F401
```

- [ ] **Step 5: Write the schema** — `app/schemas/fx.py`

```python
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class FxRateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ccy_from: str
    ccy_to: str
    ts: datetime
    rate: Decimal


class FxIngestOut(BaseModel):
    ingested: int
```

- [ ] **Step 6: Add `ensure_utc` + `ingest_fx_rates`** — modify `app/services/ingestion.py`

```python
from datetime import datetime, timezone

from app.models.fx_rate import FxRate
from app.schemas.fx import FxRateIn


class IngestionError(ValueError):
    """Row-level validation failure with a human-readable reason."""


def ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        raise IngestionError("timestamp must be timezone-aware UTC (got naive)")
    if ts.utcoffset() != timezone.utc.utcoffset(None):
        raise IngestionError("timestamp must be UTC")
    return ts.astimezone(timezone.utc)


def ingest_fx_rates(session: Session, *, series_id: int, rates: list[FxRateIn]) -> int:
    for r in rates:
        ensure_utc(r.ts)
        session.add(
            FxRate(
                series_id=series_id,
                ccy_from=r.ccy_from.strip().upper(),
                ccy_to=r.ccy_to.strip().upper(),
                ts=r.ts,
                rate=r.rate,
            )
        )
    session.flush()
    return len(rates)
```

> `ensure_utc` rejects naive timestamps and any non-zero UTC offset. A FastAPI/Pydantic-parsed `"...Z"` or `"+00:00"` yields `utcoffset() == timedelta(0)` and passes; `"...+05:00"` is rejected. The router maps `IngestionError` → `422`.

- [ ] **Step 7: Write the router** — `app/routers/fx.py`

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user
from app.db import get_db
from app.models.user import User
from app.schemas.fx import FxIngestOut, FxRateIn
from app.services.ingestion import IngestionError, ingest_fx_rates
from app.services.series import SeriesNotFound, get_owned_series

router = APIRouter(tags=["fx"])


@router.post(
    "/series/{series_id}/fx-rates",
    status_code=status.HTTP_201_CREATED,
    response_model=FxIngestOut,
)
def post_fx_rates(
    series_id: int,
    body: list[FxRateIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> FxIngestOut:
    try:
        get_owned_series(db, user.id, series_id)
    except SeriesNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="series not found")
    try:
        n = ingest_fx_rates(db, series_id=series_id, rates=body)
    except IngestionError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    db.commit()
    return FxIngestOut(ingested=n)
```

- [ ] **Step 8: Register the router** — modify `app/routers/__init__.py`

```python
from app.routers import fx as fx_router

api_router.include_router(fx_router.router)
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_fx_api.py -v`
Expected: PASS (2 passed).

- [ ] **Step 10: Commit**

```bash
git add app/models/fx_rate.py app/models/__init__.py app/schemas/fx.py \
        app/services/ingestion.py app/routers/fx.py app/routers/__init__.py \
        tests/api/test_fx_api.py
git commit -m "feat(fx): FxRate model + UTC-validated fx-rates ingest endpoint"
```

---

### Task 5: BenchmarkReturn model + benchmark endpoint

**Files:**
- Create: `app/models/benchmark_return.py`
- Modify: `app/models/__init__.py`
- Create: `app/schemas/benchmark.py`
- Modify: `app/services/ingestion.py` (add `ingest_benchmark`)
- Create: `app/routers/benchmark.py`
- Modify: `app/routers/__init__.py`
- Test: `tests/api/test_benchmark_api.py`

**Interfaces:**
- Consumes: `Series`, `get_owned_series`, `get_api_user`, `ensure_utc` (Task 4).
- Produces:
  - `app.models.benchmark_return.BenchmarkReturn(id, series_id, name, ts, return_pct NUMERIC(28,12))`.
  - `app.schemas.benchmark.BenchmarkReturnIn(ts, return_pct)`, `BenchmarkIn(name, returns: list[BenchmarkReturnIn])`, `BenchmarkIngestOut(ingested: int)`.
  - `app.services.ingestion.ingest_benchmark(session, *, series_id, payload: BenchmarkIn) -> int`.

- [ ] **Step 1: Write the failing API test** — `tests/api/test_benchmark_api.py`

```python
def test_post_benchmark_ingests(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series", headers=h, json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]

    r = client.post(
        f"/series/{sid}/benchmark", headers=h,
        json={
            "name": "SPX",
            "returns": [
                {"ts": "2026-06-18T00:00:00Z", "return_pct": "0.012000000000"},
                {"ts": "2026-06-19T00:00:00Z", "return_pct": "-0.004000000000"},
            ],
        },
    )
    assert r.status_code == 201
    assert r.json() == {"ingested": 2}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/api/test_benchmark_api.py -v`
Expected: FAIL — route missing / `ModuleNotFoundError`.

- [ ] **Step 3: Write the model** — `app/models/benchmark_return.py`

```python
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class BenchmarkReturn(Base):
    __tablename__ = "benchmark_returns"
    __table_args__ = (Index("ix_benchmark_lookup", "series_id", "name", "ts"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    return_pct: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
```

- [ ] **Step 4: Register the model** — modify `app/models/__init__.py`

```python
from app.models.benchmark_return import BenchmarkReturn  # noqa: F401
```

- [ ] **Step 5: Write the schema** — `app/schemas/benchmark.py`

```python
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class BenchmarkReturnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ts: datetime
    return_pct: Decimal


class BenchmarkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    returns: list[BenchmarkReturnIn]


class BenchmarkIngestOut(BaseModel):
    ingested: int
```

- [ ] **Step 6: Add `ingest_benchmark`** — modify `app/services/ingestion.py`

```python
from app.models.benchmark_return import BenchmarkReturn
from app.schemas.benchmark import BenchmarkIn


def ingest_benchmark(session: Session, *, series_id: int, payload: BenchmarkIn) -> int:
    for point in payload.returns:
        ensure_utc(point.ts)
        session.add(
            BenchmarkReturn(
                series_id=series_id,
                name=payload.name.strip(),
                ts=point.ts,
                return_pct=point.return_pct,
            )
        )
    session.flush()
    return len(payload.returns)
```

- [ ] **Step 7: Write the router** — `app/routers/benchmark.py`

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user
from app.db import get_db
from app.models.user import User
from app.schemas.benchmark import BenchmarkIn, BenchmarkIngestOut
from app.services.ingestion import IngestionError, ingest_benchmark
from app.services.series import SeriesNotFound, get_owned_series

router = APIRouter(tags=["benchmark"])


@router.post(
    "/series/{series_id}/benchmark",
    status_code=status.HTTP_201_CREATED,
    response_model=BenchmarkIngestOut,
)
def post_benchmark(
    series_id: int,
    body: BenchmarkIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> BenchmarkIngestOut:
    try:
        get_owned_series(db, user.id, series_id)
    except SeriesNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="series not found")
    try:
        n = ingest_benchmark(db, series_id=series_id, payload=body)
    except IngestionError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    db.commit()
    return BenchmarkIngestOut(ingested=n)
```

- [ ] **Step 8: Register the router** — modify `app/routers/__init__.py`

```python
from app.routers import benchmark as benchmark_router

api_router.include_router(benchmark_router.router)
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_benchmark_api.py -v`
Expected: PASS (1 passed).

- [ ] **Step 10: Commit**

```bash
git add app/models/benchmark_return.py app/models/__init__.py app/schemas/benchmark.py \
        app/services/ingestion.py app/routers/benchmark.py app/routers/__init__.py \
        tests/api/test_benchmark_api.py
git commit -m "feat(benchmark): BenchmarkReturn model + benchmark ingest endpoint"
```

---

### Task 6: FundMovement model + validation + endpoint

**Files:**
- Create: `app/models/fund_movement.py`
- Modify: `app/models/__init__.py`
- Modify: `app/schemas/ingestion.py` (create the module; add `FundMovementIn`, `FundIngestOut`)
- Modify: `app/schemas/series.py` (re-type `fund_movements` to `list[FundMovementIn]`)
- Modify: `app/services/ingestion.py` (add `ingest_fund_movements`)
- Modify: `app/routers/ingestion.py` (create with the fund-movements route; fills routes added in Tasks 9–10)
- Modify: `app/routers/__init__.py`
- Test: `tests/unit/test_ingestion.py` (append), `tests/api/test_ingestion_api.py` (create)

**Interfaces:**
- Consumes: `Series`, `get_owned_series`, `get_api_user`, `get_or_create_strategy`, `ensure_utc`, `Bucket` enum.
- Produces:
  - `app.models.fund_movement.FundMovement(id, series_id, ts, currency, amount NUMERIC(28,10), from_bucket, to_bucket, from_strategy_id?, to_strategy_id?, created_at, updated_at, voided_at?)`.
  - `app.schemas.ingestion.FundMovementIn(ts, currency, from_bucket: Bucket, to_bucket: Bucket, from_strategy=None, to_strategy=None, amount: Decimal)`, `FundIngestOut(ingested: int)`.
  - `app.services.ingestion.ingest_fund_movements(session, *, series_id, movements: list[FundMovementIn]) -> int` (raises `IngestionError` on first invalid row — whole request rejected per `POST /fund-movements` semantics returning `{ingested:n}`).

- [ ] **Step 1: Write the failing unit test** — append to `tests/unit/test_ingestion.py`

```python
import pytest
from app.models.fund_movement import FundMovement
from app.schemas.ingestion import FundMovementIn
from app.services.ingestion import IngestionError, ingest_fund_movements


def test_fund_movement_external_to_free_cash(db_session):
    sid = _series(db_session)
    n = ingest_fund_movements(
        db_session, series_id=sid,
        movements=[FundMovementIn(
            ts="2026-06-19T00:00:00Z", currency="USD",
            from_bucket="EXTERNAL", to_bucket="FREE_CASH", amount="100000",
        )],
    )
    assert n == 1
    mv = db_session.query(FundMovement).filter_by(series_id=sid).one()
    assert mv.from_bucket == "EXTERNAL"
    assert mv.to_bucket == "FREE_CASH"


def test_fund_movement_strategy_requires_strategy_name(db_session):
    sid = _series(db_session)
    with pytest.raises(IngestionError, match="strategy"):
        ingest_fund_movements(
            db_session, series_id=sid,
            movements=[FundMovementIn(
                ts="2026-06-19T00:00:00Z", currency="USD",
                from_bucket="FREE_CASH", to_bucket="STRATEGY", amount="5000",
            )],
        )


def test_fund_movement_same_bucket_rejected(db_session):
    sid = _series(db_session)
    with pytest.raises(IngestionError, match="from_bucket"):
        ingest_fund_movements(
            db_session, series_id=sid,
            movements=[FundMovementIn(
                ts="2026-06-19T00:00:00Z", currency="USD",
                from_bucket="FREE_CASH", to_bucket="FREE_CASH", amount="1",
            )],
        )


def test_fund_movement_nonpositive_amount_rejected(db_session):
    sid = _series(db_session)
    with pytest.raises(IngestionError, match="amount"):
        ingest_fund_movements(
            db_session, series_id=sid,
            movements=[FundMovementIn(
                ts="2026-06-19T00:00:00Z", currency="USD",
                from_bucket="EXTERNAL", to_bucket="FREE_CASH", amount="0",
            )],
        )


def test_fund_movement_strategy_transfer_auto_creates(db_session):
    sid = _series(db_session)
    n = ingest_fund_movements(
        db_session, series_id=sid,
        movements=[FundMovementIn(
            ts="2026-06-19T00:00:00Z", currency="USD",
            from_bucket="STRATEGY", to_bucket="STRATEGY",
            from_strategy="Momentum", to_strategy="MeanRev", amount="2500",
        )],
    )
    assert n == 1
    from app.models.strategy import Strategy
    assert db_session.query(Strategy).filter_by(series_id=sid).count() == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_ingestion.py -k fund_movement -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.fund_movement'`.

- [ ] **Step 3: Write the model** — `app/models/fund_movement.py`

```python
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class FundMovement(Base):
    __tablename__ = "fund_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    from_bucket: Mapped[str] = mapped_column(String(16), nullable=False)
    to_bucket: Mapped[str] = mapped_column(String(16), nullable=False)
    from_strategy_id: Mapped[int | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL")
    )
    to_strategy_id: Mapped[int | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 4: Register the model** — modify `app/models/__init__.py`

```python
from app.models.fund_movement import FundMovement  # noqa: F401
```

- [ ] **Step 5: Create the ingestion schema module** — `app/schemas/ingestion.py`

```python
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import Bucket


class FundMovementIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ts: datetime
    currency: str
    from_bucket: Bucket
    to_bucket: Bucket
    from_strategy: str | None = None
    to_strategy: str | None = None
    amount: Decimal


class FundIngestOut(BaseModel):
    ingested: int
```

- [ ] **Step 6: Re-type the series schema** — modify `app/schemas/series.py`

Replace `fund_movements: list[dict] | None = None` with:

```python
    fund_movements: list["FundMovementIn"] | None = None
```

and extend the bottom-of-module rebuild block:

```python
from app.schemas.instrument import InstrumentIn  # noqa: E402
from app.schemas.ingestion import FundMovementIn  # noqa: E402

SeriesCreateIn.model_rebuild()
```

Update `create_series` (Task 1 Step 8) to pass `FundMovementIn` objects directly:

```python
    if data.fund_movements:
        from app.services.ingestion import ingest_fund_movements

        ingest_fund_movements(session, series_id=series.id, movements=data.fund_movements)
```

- [ ] **Step 7: Add `ingest_fund_movements`** — modify `app/services/ingestion.py`

```python
from app.models.enums import Bucket
from app.models.fund_movement import FundMovement
from app.schemas.ingestion import FundMovementIn


def ingest_fund_movements(
    session: Session, *, series_id: int, movements: list[FundMovementIn]
) -> int:
    strat_cache: dict[str, int] = {}
    for m in movements:
        ensure_utc(m.ts)
        if m.from_bucket == m.to_bucket:
            raise IngestionError("from_bucket must differ from to_bucket")
        if m.amount <= 0:
            raise IngestionError("amount must be > 0")
        from_strategy_id = None
        to_strategy_id = None
        if m.from_bucket == Bucket.STRATEGY:
            if not m.from_strategy:
                raise IngestionError("from_strategy required when from_bucket is STRATEGY")
            from_strategy_id = get_or_create_strategy(session, series_id, m.from_strategy, strat_cache)
        if m.to_bucket == Bucket.STRATEGY:
            if not m.to_strategy:
                raise IngestionError("to_strategy required when to_bucket is STRATEGY")
            to_strategy_id = get_or_create_strategy(session, series_id, m.to_strategy, strat_cache)
        session.add(
            FundMovement(
                series_id=series_id,
                ts=m.ts,
                currency=m.currency.strip().upper(),
                amount=m.amount,
                from_bucket=str(m.from_bucket),
                to_bucket=str(m.to_bucket),
                from_strategy_id=from_strategy_id,
                to_strategy_id=to_strategy_id,
            )
        )
    session.flush()
    return len(movements)
```

- [ ] **Step 8: Create the ingestion router with the fund-movements route** — `app/routers/ingestion.py`

```python
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user
from app.db import get_db
from app.models.user import User
from app.schemas.ingestion import FundIngestOut, FundMovementIn
from app.services.ingestion import IngestionError, ingest_fund_movements
from app.services.series import SeriesNotFound, get_owned_series

router = APIRouter(tags=["ingestion"])


@router.post(
    "/series/{series_id}/fund-movements",
    status_code=status.HTTP_201_CREATED,
    response_model=FundIngestOut,
)
def post_fund_movements(
    series_id: int,
    body: list[FundMovementIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> FundIngestOut:
    try:
        get_owned_series(db, user.id, series_id)
    except SeriesNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="series not found")
    try:
        n = ingest_fund_movements(db, series_id=series_id, movements=body)
    except IngestionError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    db.commit()
    return FundIngestOut(ingested=n)
```

- [ ] **Step 9: Register the router** — modify `app/routers/__init__.py`

```python
from app.routers import ingestion as ingestion_router

api_router.include_router(ingestion_router.router)
```

- [ ] **Step 10: Write the failing API test** — `tests/api/test_ingestion_api.py`

```python
def test_post_fund_movements(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series", headers=h, json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]
    r = client.post(
        f"/series/{sid}/fund-movements", headers=h,
        json=[{"ts": "2026-06-19T00:00:00Z", "currency": "USD",
               "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH", "amount": "100000"}],
    )
    assert r.status_code == 201
    assert r.json() == {"ingested": 1}


def test_post_fund_movements_strategy_without_name_rejected(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series", headers=h, json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]
    r = client.post(
        f"/series/{sid}/fund-movements", headers=h,
        json=[{"ts": "2026-06-19T00:00:00Z", "currency": "USD",
               "from_bucket": "FREE_CASH", "to_bucket": "STRATEGY", "amount": "5000"}],
    )
    assert r.status_code == 422
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_ingestion.py tests/api/test_ingestion_api.py -v`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add app/models/fund_movement.py app/models/__init__.py app/schemas/ingestion.py \
        app/schemas/series.py app/services/ingestion.py app/routers/ingestion.py \
        app/routers/__init__.py tests/unit/test_ingestion.py tests/api/test_ingestion_api.py
git commit -m "feat(funds): FundMovement model + bucket/strategy validation + endpoint"
```

---

### Task 7: Fill model + FillIn schema + UTC/field validation

**Files:**
- Create: `app/models/fill.py`
- Modify: `app/models/__init__.py`
- Modify: `app/schemas/ingestion.py` (add `FillIn`, `FillBatchIn`, `BatchError`, `BatchResultOut`)
- Modify: `app/services/ingestion.py` (add `validate_fill_row` returning a normalized dict or raising `IngestionError`)
- Test: `tests/unit/test_ingestion.py` (append)

**Interfaces:**
- Consumes: `ensure_utc`, `normalize_symbol`, `Side`, `PositionEffect`.
- Produces:
  - `app.models.fill.Fill` with `unique(series_id, client_fill_id)`, qty/price/4 fees `NUMERIC(28,10)`, `created_at/updated_at/voided_at`.
  - `app.schemas.ingestion.FillIn(client_fill_id, strategy, symbol, side: Side, qty: Decimal, price: Decimal, ts: datetime, commission=Decimal("0"), exchange_fee=Decimal("0"), regulatory_fee=Decimal("0"), financing_fee=Decimal("0"), position_effect: PositionEffect|None=None, signal_id: str|None=None)`.
  - `app.schemas.ingestion.FillBatchIn(fills: list[FillIn])`, `BatchError(client_fill_id, row, reason)`, `BatchResultOut(batch_id, inserted, updated, rejected, errors)`.
  - `app.services.ingestion.validate_fill_row(fill: FillIn) -> None` (raises `IngestionError` for `qty<=0`, naive/non-UTC `ts`, far-future `ts`).
  - `app.services.ingestion.MAX_BATCH_FILLS = 10_000`, `app.services.ingestion.BatchTooLarge(Exception)`.

- [ ] **Step 1: Write the failing unit test** — append to `tests/unit/test_ingestion.py`

```python
from datetime import datetime, timezone
from app.schemas.ingestion import FillIn
from app.services.ingestion import IngestionError, validate_fill_row


def _fill(**kw):
    base = dict(
        client_fill_id="f1", strategy="Momentum", symbol="aapl", side="buy",
        qty="100", price="10", ts="2026-06-19T00:00:00Z",
    )
    base.update(kw)
    return FillIn(**base)


def test_validate_fill_ok():
    validate_fill_row(_fill())  # no raise


def test_validate_fill_rejects_nonpositive_qty():
    with pytest.raises(IngestionError, match="qty"):
        validate_fill_row(_fill(qty="0"))


def test_validate_fill_rejects_naive_ts():
    with pytest.raises(IngestionError, match="UTC"):
        validate_fill_row(_fill(ts="2026-06-19T00:00:00"))


def test_validate_fill_rejects_far_future_ts():
    with pytest.raises(IngestionError, match="future"):
        validate_fill_row(_fill(ts="2999-01-01T00:00:00Z"))


def test_fill_fee_defaults_and_negative_allowed():
    f = _fill(commission="-1.50")  # maker rebate
    assert f.commission == Decimal("-1.50")
    assert f.exchange_fee == Decimal("0")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_ingestion.py -k "validate_fill or fee_defaults" -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.fill'` (via schema import chain) or `ImportError: validate_fill_row`.

- [ ] **Step 3: Write the Fill model** — `app/models/fill.py`

```python
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Fill(Base):
    __tablename__ = "fills"
    __table_args__ = (
        UniqueConstraint("series_id", "client_fill_id", name="uq_fill_series_client_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False
    )
    strategy_id: Mapped[int] = mapped_column(
        ForeignKey("strategies.id", ondelete="CASCADE"), nullable=False
    )
    symbol: Mapped[str] = mapped_column(String(64), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    commission: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False, default=Decimal("0"))
    exchange_fee: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False, default=Decimal("0"))
    regulatory_fee: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False, default=Decimal("0"))
    financing_fee: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False, default=Decimal("0"))
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    client_fill_id: Mapped[str] = mapped_column(String(128), nullable=False)
    signal_id: Mapped[str | None] = mapped_column(String(128))
    position_effect: Mapped[str | None] = mapped_column(String(8))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 4: Register the model** — modify `app/models/__init__.py`

```python
from app.models.fill import Fill  # noqa: F401
```

- [ ] **Step 5: Add Fill schemas** — modify `app/schemas/ingestion.py`

```python
from app.models.enums import PositionEffect, Side


class FillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_fill_id: str
    strategy: str
    symbol: str
    side: Side
    qty: Decimal
    price: Decimal
    ts: datetime
    commission: Decimal = Decimal("0")
    exchange_fee: Decimal = Decimal("0")
    regulatory_fee: Decimal = Decimal("0")
    financing_fee: Decimal = Decimal("0")
    position_effect: PositionEffect | None = None
    signal_id: str | None = None


class FillBatchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fills: list[FillIn]


class BatchError(BaseModel):
    client_fill_id: str | None
    row: int
    reason: str


class BatchResultOut(BaseModel):
    batch_id: int
    inserted: int
    updated: int
    rejected: int
    errors: list[BatchError]
```

- [ ] **Step 6: Add `validate_fill_row` + constants** — modify `app/services/ingestion.py`

```python
from datetime import timedelta

from app.schemas.ingestion import FillIn

MAX_BATCH_FILLS = 10_000


class BatchTooLarge(Exception):
    pass


def validate_fill_row(fill: FillIn) -> None:
    ensure_utc(fill.ts)
    if fill.qty <= 0:
        raise IngestionError("qty must be > 0")
    # far-future guard: 2 days of clock skew tolerance
    now = datetime.now(timezone.utc)
    if fill.ts > now + timedelta(days=2):
        raise IngestionError("ts is too far in the future")
```

> `side` is validated by Pydantic against the `Side` enum (invalid → `422` at the request level for single posts; in a batch, the router parses each row defensively — see Task 9 where `FillBatchIn` parsing failures are mapped to per-row `rejected` entries). Negative fees are intentionally allowed (rebates). `price` may be negative (spreads) so it is **not** range-checked.

- [ ] **Step 7: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_ingestion.py -k "validate_fill or fee_defaults" -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/models/fill.py app/models/__init__.py app/schemas/ingestion.py \
        app/services/ingestion.py tests/unit/test_ingestion.py
git commit -m "feat(fill): Fill model + FillIn schema + UTC/qty/future validation"
```

---

### Task 8: IngestionBatch model

**Files:**
- Create: `app/models/ingestion_batch.py`
- Modify: `app/models/__init__.py`
- Test: `tests/unit/test_ingestion.py` (append)

**Interfaces:**
- Consumes: `Base`, `IngestionKind` enum.
- Produces: `app.models.ingestion_batch.IngestionBatch(id, series_id, api_key_id, received_at, kind, inserted, updated, rejected)`.

- [ ] **Step 1: Write the failing unit test** — append to `tests/unit/test_ingestion.py`

```python
def test_ingestion_batch_row_persists(db_session):
    sid = _series(db_session)
    from app.models.ingestion_batch import IngestionBatch
    b = IngestionBatch(series_id=sid, api_key_id=None, kind="fills", inserted=2, updated=1, rejected=1)
    db_session.add(b)
    db_session.flush()
    assert b.id is not None
    assert b.received_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_ingestion.py::test_ingestion_batch_row_persists -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.ingestion_batch'`.

- [ ] **Step 3: Write the model** — `app/models/ingestion_batch.py`

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class IngestionBatch(Base):
    __tablename__ = "ingestion_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False
    )
    api_key_id: Mapped[int | None] = mapped_column(
        ForeignKey("api_keys.id", ondelete="SET NULL")
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    inserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rejected: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
```

> `api_key_id` is nullable so JWT-driven frontend edits (no API key) can still write an audit row.

- [ ] **Step 4: Register the model** — modify `app/models/__init__.py`

```python
from app.models.ingestion_batch import IngestionBatch  # noqa: F401
```

- [ ] **Step 5: Run test to verify it passes**

Run: `uv run pytest tests/unit/test_ingestion.py::test_ingestion_batch_row_persists -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/models/ingestion_batch.py app/models/__init__.py tests/unit/test_ingestion.py
git commit -m "feat(audit): IngestionBatch model"
```

---

### Task 9: fills:batch — upsert by client_fill_id + partial success + 10k cap + audit

This is the core task. **Idempotency and partial-success are tested explicitly.**

**Files:**
- Modify: `app/services/ingestion.py` (add `ingest_fills_batch`)
- Modify: `app/routers/ingestion.py` (add `fills:batch` route, 413 mapping)
- Test: `tests/unit/test_ingestion.py` (append), `tests/api/test_ingestion_api.py` (append)

**Interfaces:**
- Consumes: `validate_fill_row`, `get_or_create_strategy`, `get_or_create_instrument`, `normalize_symbol`, `MAX_BATCH_FILLS`, `BatchTooLarge`, `Fill`, `IngestionBatch`, `Series`.
- Produces:
  - `app.services.ingestion.ingest_fills_batch(session, *, series_id, base_currency, api_key_id: int | None, fills: list[FillIn]) -> BatchResultOut`.
    - Raises `BatchTooLarge` if `len(fills) > MAX_BATCH_FILLS` (router → `413`, nothing written).
    - For each row: validate; on failure append `BatchError(client_fill_id, row_index, reason)` and continue.
    - For valid rows: auto-create strategy + instrument; UPSERT on `(series_id, client_fill_id)` — new id → `inserted`; existing id → `updated` (row updated in place, `created_at` preserved, `updated_at` refreshed).
    - Writes one `IngestionBatch(kind="fills", inserted, updated, rejected)`.
    - Returns `BatchResultOut`. All valid rows + the audit row commit in **one transaction** (caller/router commits).

- [ ] **Step 1: Write the failing unit tests (idempotency + partial success)** — append to `tests/unit/test_ingestion.py`

```python
from app.models.fill import Fill
from app.models.ingestion_batch import IngestionBatch
from app.services.ingestion import BatchTooLarge, ingest_fills_batch


def _batch_fill(**kw):
    base = dict(
        client_fill_id="f1", strategy="Momentum", symbol="AAPL", side="buy",
        qty="100", price="10", ts="2026-06-19T00:00:00Z",
    )
    base.update(kw)
    return FillIn(**base)


def test_batch_idempotency_same_client_fill_id_twice_one_row(db_session):
    sid = _series(db_session)
    r1 = ingest_fills_batch(
        db_session, series_id=sid, base_currency="USD", api_key_id=None,
        fills=[_batch_fill(client_fill_id="dup", price="10")],
    )
    assert r1.inserted == 1 and r1.updated == 0
    # Re-send the SAME client_fill_id (changed price) -> update in place, no new row.
    r2 = ingest_fills_batch(
        db_session, series_id=sid, base_currency="USD", api_key_id=None,
        fills=[_batch_fill(client_fill_id="dup", price="11")],
    )
    assert r2.inserted == 0 and r2.updated == 1
    rows = db_session.query(Fill).filter_by(series_id=sid, client_fill_id="dup").all()
    assert len(rows) == 1               # NO duplicate row
    assert rows[0].price == Decimal("11")  # updated in place


def test_batch_partial_success_commits_valid_rows(db_session):
    sid = _series(db_session)
    # 3 fills: 2 valid, 1 invalid (qty=0) -> inserted=2, rejected=1, errors has the bad row.
    result = ingest_fills_batch(
        db_session, series_id=sid, base_currency="USD", api_key_id=None,
        fills=[
            _batch_fill(client_fill_id="ok1", qty="100"),
            _batch_fill(client_fill_id="bad", qty="0"),
            _batch_fill(client_fill_id="ok2", qty="50"),
        ],
    )
    assert result.inserted == 2
    assert result.rejected == 1
    assert len(result.errors) == 1
    assert result.errors[0].client_fill_id == "bad"
    assert "qty" in result.errors[0].reason
    persisted = {f.client_fill_id for f in db_session.query(Fill).filter_by(series_id=sid)}
    assert persisted == {"ok1", "ok2"}   # valid rows committed; bad row absent


def test_batch_auto_creates_strategy_and_instrument(db_session):
    sid = _series(db_session)
    ingest_fills_batch(
        db_session, series_id=sid, base_currency="USD", api_key_id=None,
        fills=[_batch_fill(client_fill_id="f1", strategy="NewStrat", symbol="tsla")],
    )
    from app.models.strategy import Strategy
    from app.models.instrument import Instrument
    assert db_session.query(Strategy).filter_by(series_id=sid, name_key="newstrat").count() == 1
    inst = db_session.query(Instrument).filter_by(series_id=sid, symbol="TSLA").one()
    assert inst.inferred is True


def test_batch_writes_audit_row(db_session):
    sid = _series(db_session)
    result = ingest_fills_batch(
        db_session, series_id=sid, base_currency="USD", api_key_id=None,
        fills=[_batch_fill(client_fill_id="f1"), _batch_fill(client_fill_id="bad", qty="-1")],
    )
    batch = db_session.get(IngestionBatch, result.batch_id)
    assert batch.kind == "fills"
    assert batch.inserted == 1
    assert batch.rejected == 1


def test_batch_over_cap_raises(db_session):
    sid = _series(db_session)
    fills = [_batch_fill(client_fill_id=f"f{i}") for i in range(10_001)]
    with pytest.raises(BatchTooLarge):
        ingest_fills_batch(db_session, series_id=sid, base_currency="USD", api_key_id=None, fills=fills)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/unit/test_ingestion.py -k batch -v`
Expected: FAIL — `ImportError: cannot import name 'ingest_fills_batch'`.

- [ ] **Step 3: Implement `ingest_fills_batch`** — modify `app/services/ingestion.py`

```python
from app.models.fill import Fill
from app.models.ingestion_batch import IngestionBatch
from app.schemas.ingestion import BatchError, BatchResultOut


def ingest_fills_batch(
    session: Session,
    *,
    series_id: int,
    base_currency: str,
    api_key_id: int | None,
    fills: list[FillIn],
) -> BatchResultOut:
    if len(fills) > MAX_BATCH_FILLS:
        raise BatchTooLarge(f"batch of {len(fills)} exceeds cap of {MAX_BATCH_FILLS}")

    inserted = 0
    updated = 0
    errors: list[BatchError] = []
    strat_cache: dict[str, int] = {}
    inst_cache: set[str] = set()

    for row_index, fill in enumerate(fills):
        try:
            validate_fill_row(fill)
        except IngestionError as exc:
            errors.append(
                BatchError(client_fill_id=fill.client_fill_id, row=row_index, reason=str(exc))
            )
            continue

        symbol = normalize_symbol(fill.symbol)
        strategy_id = get_or_create_strategy(session, series_id, fill.strategy, strat_cache)
        get_or_create_instrument(session, series_id, symbol, base_currency, inst_cache)

        existing = session.scalar(
            select(Fill).where(
                Fill.series_id == series_id, Fill.client_fill_id == fill.client_fill_id
            )
        )
        if existing is None:
            session.add(
                Fill(
                    series_id=series_id,
                    strategy_id=strategy_id,
                    symbol=symbol,
                    side=str(fill.side),
                    qty=fill.qty,
                    price=fill.price,
                    commission=fill.commission,
                    exchange_fee=fill.exchange_fee,
                    regulatory_fee=fill.regulatory_fee,
                    financing_fee=fill.financing_fee,
                    ts=fill.ts,
                    client_fill_id=fill.client_fill_id,
                    signal_id=fill.signal_id,
                    position_effect=str(fill.position_effect) if fill.position_effect else None,
                )
            )
            inserted += 1
        else:
            existing.strategy_id = strategy_id
            existing.symbol = symbol
            existing.side = str(fill.side)
            existing.qty = fill.qty
            existing.price = fill.price
            existing.commission = fill.commission
            existing.exchange_fee = fill.exchange_fee
            existing.regulatory_fee = fill.regulatory_fee
            existing.financing_fee = fill.financing_fee
            existing.ts = fill.ts
            existing.signal_id = fill.signal_id
            existing.position_effect = (
                str(fill.position_effect) if fill.position_effect else None
            )
            existing.voided_at = None  # re-ingesting revives a voided row
            updated += 1
        session.flush()

    batch = IngestionBatch(
        series_id=series_id,
        api_key_id=api_key_id,
        kind="fills",
        inserted=inserted,
        updated=updated,
        rejected=len(errors),
    )
    session.add(batch)
    session.flush()

    return BatchResultOut(
        batch_id=batch.id,
        inserted=inserted,
        updated=updated,
        rejected=len(errors),
        errors=errors,
    )
```

> **Why a SELECT-then-insert/update instead of `on_conflict_do_update`?** Partial success requires per-row error capture and the `inserted` vs `updated` distinction within one transaction; the ORM read-modify-write gives both cleanly and still runs in a single tx. Duplicate `client_fill_id`s within the *same* batch are handled because each row is flushed before the next is looked up. The `unique(series_id, client_fill_id)` constraint remains the backstop guaranteeing no duplicate row (C3).

- [ ] **Step 4: Add the `fills:batch` route** — modify `app/routers/ingestion.py`

```python
from app.schemas.ingestion import BatchResultOut, FillBatchIn
from app.services.ingestion import BatchTooLarge, ingest_fills_batch


@router.post("/series/{series_id}/fills:batch", response_model=BatchResultOut)
def post_fills_batch(
    series_id: int,
    body: FillBatchIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> BatchResultOut:
    try:
        series = get_owned_series(db, user.id, series_id)
    except SeriesNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="series not found")
    try:
        result = ingest_fills_batch(
            db,
            series_id=series_id,
            base_currency=series.base_currency,
            api_key_id=getattr(user, "_api_key_id", None),
            fills=body.fills,
        )
    except BatchTooLarge as exc:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(exc)
        )
    db.commit()
    return result
```

> `getattr(user, "_api_key_id", None)`: Phase 1's `get_api_user` should attach the resolving `ApiKey.id` to the request user (e.g. via `request.state` or a lightweight attribute) so the audit row records which key ingested. If Phase 1 exposes it differently (e.g. a separate `get_api_key` dep), inject that and pass `api_key.id`. The route stays thin either way.

- [ ] **Step 5: Write the failing API tests (dedup, partial success, 413)** — append to `tests/api/test_ingestion_api.py`

```python
def _new_series(client, h):
    return client.post(
        "/series", headers=h, json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]


def test_api_batch_dedup_idempotent(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = _new_series(client, h)
    payload = {"fills": [{"client_fill_id": "dup", "strategy": "M", "symbol": "AAPL",
                          "side": "buy", "qty": "100", "price": "10", "ts": "2026-06-19T00:00:00Z"}]}
    r1 = client.post(f"/series/{sid}/fills:batch", headers=h, json=payload)
    assert r1.status_code == 200
    assert r1.json()["inserted"] == 1
    r2 = client.post(f"/series/{sid}/fills:batch", headers=h, json=payload)
    assert r2.json()["inserted"] == 0
    assert r2.json()["updated"] == 1
    # one row only
    detail = client.get(f"/series/{sid}", headers=_jwt(user, make_user)).json()
    assert detail["discovered_symbols"] == ["AAPL"]


def test_api_batch_partial_success(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = _new_series(client, h)
    r = client.post(f"/series/{sid}/fills:batch", headers=h, json={"fills": [
        {"client_fill_id": "ok1", "strategy": "M", "symbol": "AAPL", "side": "buy",
         "qty": "100", "price": "10", "ts": "2026-06-19T00:00:00Z"},
        {"client_fill_id": "bad", "strategy": "M", "symbol": "AAPL", "side": "buy",
         "qty": "0", "price": "10", "ts": "2026-06-19T00:00:00Z"},
        {"client_fill_id": "ok2", "strategy": "M", "symbol": "AAPL", "side": "sell",
         "qty": "50", "price": "12", "ts": "2026-06-19T01:00:00Z"},
    ]})
    assert r.status_code == 200
    body = r.json()
    assert body["inserted"] == 2
    assert body["rejected"] == 1
    assert body["errors"][0]["client_fill_id"] == "bad"


def test_api_batch_over_cap_returns_413(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = _new_series(client, h)
    fills = [{"client_fill_id": f"f{i}", "strategy": "M", "symbol": "AAPL", "side": "buy",
              "qty": "1", "price": "10", "ts": "2026-06-19T00:00:00Z"} for i in range(10_001)]
    r = client.post(f"/series/{sid}/fills:batch", headers=h, json={"fills": fills})
    assert r.status_code == 413


def test_api_batch_rejects_non_utc_ts(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = _new_series(client, h)
    r = client.post(f"/series/{sid}/fills:batch", headers=h, json={"fills": [
        {"client_fill_id": "naive", "strategy": "M", "symbol": "AAPL", "side": "buy",
         "qty": "1", "price": "10", "ts": "2026-06-19T00:00:00+05:00"},
    ]})
    assert r.status_code == 200
    body = r.json()
    assert body["rejected"] == 1
    assert "UTC" in body["errors"][0]["reason"]


def _jwt(user, make_user):
    # use the auth_header fixture in real code; helper kept for readability
    from app.core.security import create_access_token  # Phase 1
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}
```

> The `_jwt` helper shown calls Phase 1's token factory; if the conftest provides an `auth_header` fixture, inject and use it instead. The non-UTC test uses `+05:00` (a valid aware offset that is **not** UTC) so it reaches `ensure_utc` and is rejected per-row rather than failing Pydantic parsing.

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_ingestion.py -k batch tests/api/test_ingestion_api.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/services/ingestion.py app/routers/ingestion.py \
        tests/unit/test_ingestion.py tests/api/test_ingestion_api.py
git commit -m "feat(ingest): fills:batch upsert + partial success + 10k cap + audit"
```

---

### Task 10: fills:void — soft-delete

**Files:**
- Modify: `app/schemas/ingestion.py` (add `VoidFillsIn`, `VoidOut`)
- Modify: `app/services/ingestion.py` (add `void_fills`)
- Modify: `app/routers/ingestion.py` (add `fills:void` route)
- Test: `tests/unit/test_ingestion.py` (append), `tests/api/test_ingestion_api.py` (append)

**Interfaces:**
- Consumes: `Fill`, `get_owned_series`.
- Produces:
  - `app.schemas.ingestion.VoidFillsIn(client_fill_ids: list[str])`, `VoidOut(voided: int)`.
  - `app.services.ingestion.void_fills(session, *, series_id, client_fill_ids: list[str]) -> int` (sets `voided_at=now()`; only counts rows newly voided; idempotent on already-voided rows).

- [ ] **Step 1: Write the failing unit test** — append to `tests/unit/test_ingestion.py`

```python
from app.services.ingestion import void_fills


def test_void_soft_deletes_and_retains(db_session):
    sid = _series(db_session)
    ingest_fills_batch(
        db_session, series_id=sid, base_currency="USD", api_key_id=None,
        fills=[_batch_fill(client_fill_id="v1"), _batch_fill(client_fill_id="keep")],
    )
    n = void_fills(db_session, series_id=sid, client_fill_ids=["v1"])
    assert n == 1
    voided = db_session.query(Fill).filter_by(series_id=sid, client_fill_id="v1").one()
    assert voided.voided_at is not None        # excluded from computation
    # row RETAINED in DB for audit
    assert db_session.query(Fill).filter_by(series_id=sid).count() == 2


def test_void_idempotent_and_ignores_unknown_ids(db_session):
    sid = _series(db_session)
    ingest_fills_batch(
        db_session, series_id=sid, base_currency="USD", api_key_id=None,
        fills=[_batch_fill(client_fill_id="v1")],
    )
    assert void_fills(db_session, series_id=sid, client_fill_ids=["v1"]) == 1
    # re-voiding the same id counts 0 (already voided); unknown id ignored
    assert void_fills(db_session, series_id=sid, client_fill_ids=["v1", "nope"]) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_ingestion.py -k void -v`
Expected: FAIL — `ImportError: cannot import name 'void_fills'`.

- [ ] **Step 3: Add schemas** — modify `app/schemas/ingestion.py`

```python
class VoidFillsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_fill_ids: list[str]


class VoidOut(BaseModel):
    voided: int
```

- [ ] **Step 4: Implement `void_fills`** — modify `app/services/ingestion.py`

```python
from datetime import datetime, timezone


def void_fills(session: Session, *, series_id: int, client_fill_ids: list[str]) -> int:
    rows = session.scalars(
        select(Fill).where(
            Fill.series_id == series_id,
            Fill.client_fill_id.in_(client_fill_ids),
            Fill.voided_at.is_(None),
        )
    ).all()
    now = datetime.now(timezone.utc)
    for row in rows:
        row.voided_at = now
    session.flush()
    return len(rows)
```

> Only rows currently non-voided are counted, so re-voiding is idempotent (returns 0) and unknown ids are silently ignored. Rows are **never deleted** — `voided_at` is the soft-delete marker that all Phase 3+ computation filters on (`voided_at IS NULL`).

- [ ] **Step 5: Add the `fills:void` route** — modify `app/routers/ingestion.py`

```python
from app.schemas.ingestion import VoidFillsIn, VoidOut
from app.services.ingestion import void_fills


@router.post("/series/{series_id}/fills:void", response_model=VoidOut)
def post_fills_void(
    series_id: int,
    body: VoidFillsIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> VoidOut:
    try:
        get_owned_series(db, user.id, series_id)
    except SeriesNotFound:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="series not found")
    n = void_fills(db, series_id=series_id, client_fill_ids=body.client_fill_ids)
    db.commit()
    return VoidOut(voided=n)
```

- [ ] **Step 6: Write the failing API test** — append to `tests/api/test_ingestion_api.py`

```python
def test_api_void_soft_deletes(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = _new_series(client, h)
    client.post(f"/series/{sid}/fills:batch", headers=h, json={"fills": [
        {"client_fill_id": "v1", "strategy": "M", "symbol": "AAPL", "side": "buy",
         "qty": "100", "price": "10", "ts": "2026-06-19T00:00:00Z"},
    ]})
    r = client.post(f"/series/{sid}/fills:void", headers=h, json={"client_fill_ids": ["v1"]})
    assert r.status_code == 200
    assert r.json() == {"voided": 1}
    # voided fill no longer appears in discovered symbols (excluded from computation)
    detail = client.get(f"/series/{sid}", headers=_jwt(user, make_user)).json()
    assert detail["discovered_symbols"] == []
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_ingestion.py -k void tests/api/test_ingestion_api.py -k void -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/schemas/ingestion.py app/services/ingestion.py app/routers/ingestion.py \
        tests/unit/test_ingestion.py tests/api/test_ingestion_api.py
git commit -m "feat(ingest): fills:void soft-delete + retain-for-audit"
```

---

### Task 11: Per-user ownership enforcement across ingestion + trade-date helper

Most routes already call `get_owned_series` (added incrementally). This task adds the **explicit cross-user rejection tests** that satisfy the H1/H3 acceptance gate across every ingestion endpoint, plus the `session_tz` trade-date helper for TZ-2/TZ-3 (used by Phase 3 but defined and tested here so the boundary case is pinned).

**Files:**
- Modify: `app/services/ingestion.py` (add `trade_date`)
- Test: `tests/unit/test_ingestion.py` (append), `tests/api/test_ingestion_api.py` (append)

**Interfaces:**
- Consumes: `get_owned_series`, all ingestion routes.
- Produces: `app.services.ingestion.trade_date(ts: datetime, session_tz: str) -> date` — calendar date of `ts` in `session_tz`.

- [ ] **Step 1: Write the failing trade-date unit test (TZ-3 boundary)** — append to `tests/unit/test_ingestion.py`

```python
from datetime import date
from app.services.ingestion import trade_date


def test_trade_date_in_session_tz_crosses_day():
    # 2026-06-19T01:31:00Z is 2026-06-18 21:31 in America/New_York -> local trade day 06-18
    ts = datetime(2026, 6, 19, 1, 31, tzinfo=timezone.utc)
    assert trade_date(ts, "America/New_York") == date(2026, 6, 18)
    # same instant in UTC session_tz stays on 06-19
    assert trade_date(ts, "UTC") == date(2026, 6, 19)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/unit/test_ingestion.py::test_trade_date_in_session_tz_crosses_day -v`
Expected: FAIL — `ImportError: cannot import name 'trade_date'`.

- [ ] **Step 3: Implement `trade_date`** — modify `app/services/ingestion.py`

```python
from datetime import date
from zoneinfo import ZoneInfo


def trade_date(ts: datetime, session_tz: str) -> date:
    return ts.astimezone(ZoneInfo(session_tz)).date()
```

- [ ] **Step 4: Write the failing cross-user API test (H1/H3)** — append to `tests/api/test_ingestion_api.py`

```python
def test_cannot_append_to_another_users_series(db_session, client, make_user, make_api_key):
    owner = make_user(db_session, status="approved", email="owner@x.com")
    attacker = make_user(db_session, status="approved", email="attacker@x.com")
    _, owner_raw = make_api_key(db_session, owner)
    _, atk_raw = make_api_key(db_session, attacker)
    sid = _new_series(client, {"X-API-Key": owner_raw})

    # attacker's key cannot post fills/funds/instruments/fx/benchmark/void to owner's series
    atk_h = {"X-API-Key": atk_raw}
    assert client.post(f"/series/{sid}/fills:batch", headers=atk_h, json={"fills": [
        {"client_fill_id": "x", "strategy": "M", "symbol": "AAPL", "side": "buy",
         "qty": "1", "price": "10", "ts": "2026-06-19T00:00:00Z"}]}).status_code == 404
    assert client.post(f"/series/{sid}/fund-movements", headers=atk_h, json=[
        {"ts": "2026-06-19T00:00:00Z", "currency": "USD",
         "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH", "amount": "1"}]).status_code == 404
    assert client.post(f"/series/{sid}/instruments", headers=atk_h, json=[
        {"symbol": "AAPL", "asset_class": "equity", "currency": "USD"}]).status_code == 404
    assert client.post(f"/series/{sid}/fx-rates", headers=atk_h, json=[
        {"ccy_from": "EUR", "ccy_to": "USD", "ts": "2026-06-19T00:00:00Z", "rate": "1.0"}]).status_code == 404
    assert client.post(f"/series/{sid}/benchmark", headers=atk_h, json={
        "name": "B", "returns": [{"ts": "2026-06-19T00:00:00Z", "return_pct": "0.0"}]}).status_code == 404
    assert client.post(f"/series/{sid}/fills:void", headers=atk_h, json={
        "client_fill_ids": ["x"]}).status_code == 404
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_ingestion.py::test_trade_date_in_session_tz_crosses_day tests/api/test_ingestion_api.py::test_cannot_append_to_another_users_series -v`
Expected: PASS (all 6 endpoints return 404 for the attacker; trade-date boundary correct).

- [ ] **Step 6: Commit**

```bash
git add app/services/ingestion.py tests/unit/test_ingestion.py tests/api/test_ingestion_api.py
git commit -m "feat(ingest): trade-date in session_tz + cross-user ownership tests across endpoints"
```

---

### Task 12: Alembic migration for all Phase 2 tables (DoD-5)

Generate and verify the single migration that creates all 9 tables with their constraints. This is the DoD-5 gate: `alembic upgrade head` on an empty DB builds everything.

**Files:**
- Create: `app/alembic/versions/0002_phase2_ingestion.py`
- Test: `tests/api/test_migration.py`

**Interfaces:**
- Consumes: all Phase 2 models registered in `app/models/__init__.py`; Phase 0 Alembic env (`app/alembic/env.py`) and the Phase 0 base migration (revision `0001`).
- Produces: migration revision `0002` with `down_revision = "0001"` creating tables `series, accounts, strategies, instruments, fx_rates, benchmark_returns, fund_movements, fills, ingestion_batches`.

- [ ] **Step 1: Autogenerate the migration**

Run: `uv run alembic revision --autogenerate -m "phase2 ingestion tables"`
Expected: a new file under `app/alembic/versions/`. Rename it to `0002_phase2_ingestion.py` and set `revision = "0002"`, `down_revision = "0001"`.

- [ ] **Step 2: Review the generated migration**

Open the file and confirm it contains (autogenerate produces these from the models — verify, don't hand-write unless gaps exist):
- `op.create_table("series", ...)` with `base_currency` `sa.String(3)`, `session_tz` `sa.String(64)`, `created_at` server_default.
- `op.create_table("accounts", ...)` with `sa.UniqueConstraint("series_id")`.
- `op.create_table("strategies", ...)` with `sa.UniqueConstraint("series_id", "name", name="uq_strategy_series_name")`.
- `op.create_table("instruments", ...)` with `multiplier` `sa.Numeric(28, 12)`, `tick_size/lot_size` `sa.Numeric(28, 10)` nullable, `inferred` `sa.Boolean`, `sa.UniqueConstraint("series_id", "symbol", name="uq_instrument_series_symbol")`.
- `op.create_table("fx_rates", ...)` with `rate` `sa.Numeric(28, 12)`, the `ix_fxrate_lookup` index.
- `op.create_table("benchmark_returns", ...)` with `return_pct` `sa.Numeric(28, 12)`.
- `op.create_table("fund_movements", ...)` with `amount` `sa.Numeric(28, 10)`, `voided_at` nullable, two nullable strategy FKs.
- `op.create_table("fills", ...)` with qty/price/4 fees `sa.Numeric(28, 10)`, `voided_at` nullable, `sa.UniqueConstraint("series_id", "client_fill_id", name="uq_fill_series_client_id")`.
- `op.create_table("ingestion_batches", ...)` with nullable `api_key_id` FK, `received_at` server_default.

If autogenerate misses any unique constraint or numeric scale (a known Alembic quirk), add the missing `sa.UniqueConstraint(...)` / fix the `sa.Numeric(p, s)` by hand.

- [ ] **Step 3: Write the failing migration test** — `tests/api/test_migration.py`

```python
import sqlalchemy as sa
from alembic import command
from alembic.config import Config


def test_upgrade_head_builds_all_tables(tmp_path, monkeypatch):
    # Run migrations against a fresh empty schema on TEST_DATABASE_URL.
    from app.core.config import settings

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", settings.TEST_DATABASE_URL)
    # ensure clean slate
    engine = sa.create_engine(settings.TEST_DATABASE_URL)
    with engine.begin() as conn:
        conn.execute(sa.text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    command.upgrade(cfg, "head")

    insp = sa.inspect(engine)
    tables = set(insp.get_table_names())
    expected = {
        "series", "accounts", "strategies", "instruments", "fx_rates",
        "benchmark_returns", "fund_movements", "fills", "ingestion_batches",
    }
    assert expected.issubset(tables)

    # unique constraints present
    fill_uniques = {uc["name"] for uc in insp.get_unique_constraints("fills")}
    assert "uq_fill_series_client_id" in fill_uniques
    inst_uniques = {uc["name"] for uc in insp.get_unique_constraints("instruments")}
    assert "uq_instrument_series_symbol" in inst_uniques
    strat_uniques = {uc["name"] for uc in insp.get_unique_constraints("strategies")}
    assert "uq_strategy_series_name" in strat_uniques

    # numeric scales
    cols = {c["name"]: c["type"] for c in insp.get_columns("fills")}
    assert isinstance(cols["qty"], sa.Numeric) and cols["qty"].scale == 10
    inst_cols = {c["name"]: c["type"] for c in insp.get_columns("instruments")}
    assert inst_cols["multiplier"].scale == 12
```

> This test assumes a dedicated `TEST_DATABASE_URL` Postgres it may drop/recreate the `public` schema on. If conftest already manages schema lifecycle differently, adapt the cleanup. Keep this test in `tests/api/` (it needs a real Postgres, not SQLite).

- [ ] **Step 4: Run the migration test**

Run: `uv run pytest tests/api/test_migration.py -v`
Expected: PASS (all 9 tables + 3 unique constraints + numeric scales present).

- [ ] **Step 5: Verify a clean downgrade is not required but upgrade is idempotent on head**

Run: `uv run alembic upgrade head`
Expected: `Running upgrade 0001 -> 0002` (first run) then no-op on repeat.

- [ ] **Step 6: Run the full Phase 2 suite + ruff**

Run: `uv run ruff check app tests && uv run pytest tests/unit/test_series.py tests/unit/test_ingestion.py tests/api/test_ingestion_api.py tests/api/test_instruments_api.py tests/api/test_fx_api.py tests/api/test_benchmark_api.py tests/api/test_migration.py -v`
Expected: ruff clean; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/alembic/versions/0002_phase2_ingestion.py tests/api/test_migration.py
git commit -m "feat(db): Alembic migration for all Phase 2 ingestion tables + verification"
```

---

## Self-Review

Mapping each Phase 2 acceptance criterion to the task that satisfies it:

| Criterion | Description | Task(s) |
|-----------|-------------|---------|
| **C1** | Create series once; auto 1:1 Account; optional strategies/instruments/fund_movements; reject bad ISO-4217/IANA (`422`) | Task 1 (create + validation), Task 3/6 (nested instruments/funds) |
| **C2** | `fills:batch` returns `{batch_id, inserted, updated, rejected, errors}`; inserted rows land | Task 9 |
| **C3** | `client_fill_id` dedup/idempotency — resend = update-in-place, no dup row | Task 9 (`test_batch_idempotency_same_client_fill_id_twice_one_row`, `test_api_batch_dedup_idempotent`) |
| **C4** | Partial success in a single tx + per-row `{client_fill_id, row, reason}` | Task 9 (`test_batch_partial_success_commits_valid_rows`, `test_api_batch_partial_success`) |
| **C5** | `>10,000` fills → `413`, nothing stored | Task 7 (`MAX_BATCH_FILLS`/`BatchTooLarge`), Task 9 (`test_batch_over_cap_raises`, `test_api_batch_over_cap_returns_413`) |
| **C6** | Auto-create unknown strategy (`name_key` lower+trim) + inferred Instrument | Task 2 (strategy), Task 3 (instrument), Task 9 (`test_batch_auto_creates_strategy_and_instrument`) |
| **C7** | Fund movements: bucket enum, STRATEGY needs name, `from!=to`, `amount>0` | Task 6 |
| **C8** | `POST /instruments` upsert by `(series_id, symbol)`, sets `inferred=false`, `{upserted:n}` | Task 3 |
| **C9** | `POST /fx-rates` stores `{ccy_from, ccy_to, ts, rate}` `NUMERIC(28,12)`, `{ingested:n}` | Task 4 |
| **C10** | `POST /benchmark` stores optional `BenchmarkReturn`, `{ingested:n}` | Task 5 |
| **C11** | `fills:void` soft-delete via `voided_at`; retained, excluded | Task 10 |
| **C12** | Every ingestion call writes `IngestionBatch` audit row | Task 8 (model), Task 9 (`test_batch_writes_audit_row`) |
| **M2-2** | Unknown symbol → inferred instrument; surfaced in `GET /series/{id}`; explicit POST clears | Task 3 (`test_auto_create_instrument_is_inferred`, `test_post_instruments_upserts_and_clears_inferred`) |
| **M2-3** | `asset_class ∈ equity|future|option|fx|crypto|cfd`; tick/lot optional | Task 1 (enum), Task 3 (schema) |
| **CCY-1** | Series requires valid ISO-4217 `base_currency` | Task 1 (`test_create_series_rejects_bad_currency`) |
| **TZ-1** | Reject non-UTC `ts` (counted as rejected + reason) | Task 4 (`ensure_utc`), Task 9 (`test_api_batch_rejects_non_utc_ts`) |
| **TZ-2 / TZ-3** | Trade date derived in `session_tz`; ET boundary example | Task 11 (`test_trade_date_in_session_tz_crosses_day`) |
| **FEE-4** | Fee components default `0`, may be negative (rebates), sum correctly | Task 7 (`test_fill_fee_defaults_and_negative_allowed`) |
| **AUD-1** | Voided rows excluded from computation, retained | Task 10 (`test_void_soft_deletes_and_retains`, API discovered-symbols excludes voided) |
| **AUD-3** | Ingestion batches traceable (counts + received_at + key + kind) | Task 8, Task 9 |
| **H1 / H3** | Per-user ownership: cannot read or append to another user's series (`404`) | Task 1 (`test_get_series_detail_enforces_ownership`), Task 11 (`test_cannot_append_to_another_users_series`) |
| **DoD-5** | `alembic upgrade head` builds all tables + `unique(series_id, client_fill_id)`, `unique(series_id, symbol)`, `unique(series_id, name)`, `NUMERIC(28,10)/(28,12)`, `voided_at` | Task 12 |
| **DoD-1/DoD-2** | Unit tests (`test_series`, `test_ingestion`) + API tests (`test_ingestion_api`, `test_instruments_api`, `test_fx_api`, `test_benchmark_api`, `test_migration`) green | All tasks (TDD throughout) |
| **DoD-3** | Domain exceptions → correct HTTP codes (404/413/422); partial success via body not exception | Tasks 1, 4, 6, 9, 10, 11 (router exception mapping) |
| **DoD-8** | Logic only in `services/*`; routers thin (parse→service→serialize) | Tasks 1–11 (every router delegates to one service call) |

**Notes on scope boundaries (not in Phase 2, deliberately deferred):**
- No PnL/metrics/pairing computation — only storage. FX rates and benchmark returns are **stored** but consumed in Phase 3/4.
- `as_of_rate`/`to_base` (services/fx.py) and `pairing.py`/`capital.py`/`metrics.py` are Phase 3+; this plan only lands the tables and ingest paths they will read.
- `voided_at` exclusion is enforced here at the read surface that exists in Phase 2 (`discovered_symbols`, series counts); full computation-time exclusion is verified in later phases.

**Type-consistency check:** `IngestionError` (raised in `ensure_utc`/`validate_fill_row`/`ingest_fund_movements`) is mapped to `422` in every router; `BatchTooLarge` → `413`; `SeriesNotFound` → `404`. `get_or_create_strategy(session, series_id, name, cache: dict)` and `get_or_create_instrument(session, series_id, symbol, base_currency, cache: set)` signatures are used identically in Tasks 2/3/6/9. `BatchResultOut.errors: list[BatchError]` with `BatchError(client_fill_id, row, reason)` is consistent across schema (Task 7) and service (Task 9).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-liveboard-phase2-ingestion.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task (Tasks 1–12), review between tasks, fast iteration. REQUIRED SUB-SKILL: superpowers:subagent-driven-development.
2. **Inline Execution** — execute tasks in this session using superpowers:executing-plans, batch execution with checkpoints.

Which approach?
