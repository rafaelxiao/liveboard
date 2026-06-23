# Fill Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pre-ingestion validation layer that rejects fill batches exceeding capital leverage thresholds, with per-series configurable limits.

**Architecture:** New `validate_fills_batch()` runs before existing `ingest_fills_batch()`. It loads capital base via `capital.account_base()` (already optimized), simulates cumulative positions per strategy in memory, and checks each fill against configurable leverage/drawdown limits. If any fill violates → 422 error with detailed reasons. Same DB transaction — no separate commit needed.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, psycopg, Pydantic v2, pytest

## Global Constraints

- All 130 existing backend tests must continue to pass
- Backward compatible: series with NULL `validation_config` use safe defaults (5× leverage, no drawdown limit)
- Default behavior: reject fills only in genuinely suspicious scenarios
- Same DB transaction as ingestion — validation does not persist anything itself
- All numeric thresholds use `Decimal` type for precision
- Instrument multipliers MUST be respected when computing notional values

---

## File Structure

| File | Role |
|------|------|
| `backend/app/models/series.py` | Add `validation_config` JSONB column |
| `backend/app/schemas/validation.py` | **NEW** — request/response Pydantic schemas |
| `backend/app/services/validation.py` | **NEW** — `validate_fills_batch()` |
| `backend/app/routers/ingestion.py` | Call validation before ingestion in `fills_batch` |
| `backend/app/routers/series.py` | Add `PATCH /series/{id}/validation-config` |
| `backend/tests/unit/test_validation.py` | **NEW** — unit tests for validation rules |
| `backend/tests/api/test_validation_api.py` | **NEW** — integration tests for API |

---

### Task 1: Extend Series Model with JSONB Column

**Files:**
- Modify: `backend/app/models/series.py`

**Interfaces:**
- Produces: `Series.validation_config` — JSONB column, nullable, default NULL

- [ ] **Step 1: Add column to model**

Read `backend/app/models/series.py`. Find the `Series` class. Add the column after existing fields:

```python
from sqlalchemy.dialects.postgresql import JSONB

class Series(Base):
    __tablename__ = "series"
    # ... existing columns ...
    validation_config = Column(JSONB, nullable=True, comment="Per-series validation thresholds (max_leverage_ratio, max_drawdown_ratio, require_capital)")
```

- [ ] **Step 2: Run existing tests to verify no breakage**

```bash
cd backend && uv run pytest tests/unit/test_capital.py tests/api/ -q
```
Expected: All existing tests pass

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/series.py
git commit -m "feat: add validation_config JSONB column to Series model"
```

---

### Task 2: Create Validation Schemas

**Files:**
- Create: `backend/app/schemas/validation.py`

**Interfaces:**
- Produces: `ValidationConfigIn` (PATCH request), `ValidationConfigOut` (response), `ValidationErrorDetail` (per-fill error), `ValidationErrorResponse` (422 response wrapper)

- [ ] **Step 1: Write schema file**

Create `backend/app/schemas/validation.py`:

```python
"""Validation request/response schemas."""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class ValidationConfigIn(BaseModel):
    """PATCH /series/{id}/validation-config request — partial update."""
    max_leverage_ratio: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    max_drawdown_ratio: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    require_capital: Optional[bool] = None


class ValidationConfigOut(BaseModel):
    """GET validation config response — resolved with defaults."""
    max_leverage_ratio: Decimal
    max_drawdown_ratio: Optional[Decimal]
    require_capital: bool


class ValidationErrorDetail(BaseModel):
    """Single fill validation failure."""
    client_fill_id: str
    rule: str
    strategy: Optional[str] = None
    current: Optional[str] = None
    limit: Optional[str] = None
    ts: Optional[str] = None


class ValidationErrorResponse(BaseModel):
    """422 response when batch is rejected."""
    code: str = "validation_failed"
    message: str
    details: list[ValidationErrorDetail]
```

- [ ] **Step 2: Verify import**

```bash
cd backend && uv run python -c "from app.schemas.validation import ValidationConfigIn, ValidationConfigOut, ValidationErrorDetail, ValidationErrorResponse; print('OK')"
```
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/validation.py
git commit -m "feat: add validation request/response Pydantic schemas"
```

---

### Task 3: Write Validation Service

**Files:**
- Create: `backend/app/services/validation.py`

**Interfaces:**
- Consumes: `capital.account_base()` (existing), `FillIn` schema (existing), `Instrument` model (existing), `Series.validation_config` (from Task 1)
- Produces: `validate_fills_batch(session, series_id, fills) -> list[ValidationErrorDetail]`

- [ ] **Step 1: Write the service**

Create `backend/app/services/validation.py`:

```python
"""Pre-ingestion fill validation — leverage, capital, drawdown checks."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

from app.models.enums import Bucket
from app.models.instrument import Instrument
from app.models.series import Series
from app.schemas.ingestion import FillIn
from app.schemas.validation import ValidationErrorDetail
from app.services import capital

DEFAULT_MAX_LEVERAGE_RATIO = Decimal("5.0")
DEFAULT_MAX_DRAWDOWN_RATIO: Optional[Decimal] = None
DEFAULT_REQUIRE_CAPITAL = True


def _get_config(series: Series) -> dict:
    """Resolve validation config with defaults."""
    raw = series.validation_config or {}
    return {
        "max_leverage_ratio": Decimal(raw.get("max_leverage_ratio", DEFAULT_MAX_LEVERAGE_RATIO)),
        "max_drawdown_ratio": (
            Decimal(raw["max_drawdown_ratio"])
            if raw.get("max_drawdown_ratio") is not None
            else DEFAULT_MAX_DRAWDOWN_RATIO
        ),
        "require_capital": raw.get("require_capital", DEFAULT_REQUIRE_CAPITAL),
    }


def _load_instruments(session: Session, series_id: int) -> dict[str, Instrument]:
    """Load all registered instruments for a series, keyed by normalized symbol."""
    rows = session.query(Instrument).filter(Instrument.series_id == series_id).all()
    return {r.symbol.upper(): r for r in rows}


def validate_fills_batch(
    session: Session,
    series_id: int,
    fills: list[FillIn],
) -> list[ValidationErrorDetail]:
    """Validate a batch of fills before ingestion.

    Returns a list of validation errors. Empty list means all fills pass.
    Validation is stateless — no DB writes, no persistence.
    """

    from datetime import datetime, timezone

    series = session.get(Series, series_id)
    if series is None:
        return [ValidationErrorDetail(
            client_fill_id="",
            rule="series_not_found",
            message="Series not found",
        )]

    config = _get_config(series)
    instruments = _load_instruments(session, series_id)
    errors: list[ValidationErrorDetail] = []

    # Track cumulative position per strategy (simulated, not persisted)
    strategy_positions: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    strategy_notionals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))

    for fill in fills:
        sym = fill.symbol.upper()
        instr = instruments.get(sym)

        # Determine multiplier (1 if instrument not registered)
        multiplier = instr.multiplier if instr else Decimal("1")

        # Rule 1: Capital existence
        cap_base = capital.account_base(session, series_id, fill.ts)
        if config["require_capital"] and cap_base <= Decimal("0"):
            errors.append(ValidationErrorDetail(
                client_fill_id=fill.client_fill_id,
                rule="no_capital",
                ts=fill.ts.isoformat(),
            ))
            continue

        # Compute notional for this fill
        notional = fill.qty * fill.price * multiplier
        signed_notional = notional if fill.side.value == "buy" else -notional

        # Update simulated position
        strategy_positions[fill.strategy] += signed_notional
        strategy_notionals[fill.strategy] += notional

        # Rule 2: Strategy leverage
        if cap_base > Decimal("0"):
            leverage = strategy_notionals[fill.strategy] / cap_base
            if leverage > config["max_leverage_ratio"]:
                errors.append(ValidationErrorDetail(
                    client_fill_id=fill.client_fill_id,
                    rule="leverage",
                    strategy=fill.strategy,
                    current=str(leverage),
                    limit=str(config["max_leverage_ratio"]),
                ))

    return errors
```

- [ ] **Step 2: Run basic import check**

```bash
cd backend && uv run python -c "from app.services.validation import validate_fills_batch; print('OK')"
```
Expected: OK

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/validation.py
git commit -m "feat: add validate_fills_batch service with leverage/capital checks"
```

---

### Task 4: Wire Validation into Ingestion Router

**Files:**
- Modify: `backend/app/routers/ingestion.py`

**Interfaces:**
- Consumes: `validate_fills_batch()` (from Task 3), `ValidationErrorResponse` (from Task 2)
- Produces: Updated `fills_batch` endpoint that validates before ingesting

- [ ] **Step 1: Read current router**

Read `backend/app/routers/ingestion.py`. Find the `fills_batch` function (around line 30).

- [ ] **Step 2: Add validation call**

Add the import at the top of the file:
```python
from app.services.validation import validate_fills_batch
from app.schemas.validation import ValidationErrorResponse
from fastapi import HTTPException
```

In the `fills_batch` function body, add after `series = _owned_series(series_id, db, user)` (around line 37) and before `result = ingest_fills_batch(...)` (around line 38):

```python
    # Validate fills before ingestion
    from app.schemas.ingestion import FillIn

    fill_objects = []
    for raw in body.fills:
        try:
            fill_objects.append(raw if isinstance(raw, FillIn) else FillIn.model_validate(raw))
        except Exception:
            pass  # let ingest_fills_batch handle schema validation errors

    errors = validate_fills_batch(db, series_id, fill_objects)
    if errors:
        raise HTTPException(
            status_code=422,
            detail=ValidationErrorResponse(
                message=f"Batch rejected: {len(errors)} fills violate limits",
                details=errors,
            ).model_dump(),
        )
```

- [ ] **Step 3: Run existing tests to verify no regression**

```bash
cd backend && uv run pytest tests/api/test_ingestion_api.py tests/unit/test_ingestion.py -q
```
Expected: All existing tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/ingestion.py
git commit -m "feat: wire validate_fills_batch into fills_batch endpoint"
```

---

### Task 5: Add Validation Config Endpoint to Series Router

**Files:**
- Modify: `backend/app/routers/series.py`

**Interfaces:**
- Consumes: `ValidationConfigIn`, `ValidationConfigOut` (from Task 2)
- Produces: `GET /series/{id}/validation-config` (returns resolved config), `PATCH /series/{id}/validation-config` (updates config)

- [ ] **Step 1: Read current series router**

Read `backend/app/routers/series.py`.

- [ ] **Step 2: Add GET endpoint**

Add import:
```python
from app.schemas.validation import ValidationConfigOut
from app.services.validation import _get_config as resolve_validation_config
```

Add endpoint:
```python
@router.get("/series/{series_id}/validation-config", response_model=ValidationConfigOut)
def get_validation_config(
    series_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ValidationConfigOut:
    from app.models.series import Series

    series = db.get(Series, series_id)
    if series is None or series.user_id != user.id:
        raise HTTPException(status_code=404, detail="series not found")
    cfg = resolve_validation_config(series)
    return ValidationConfigOut(**cfg)
```

- [ ] **Step 3: Add PATCH endpoint**

Add import:
```python
from app.schemas.validation import ValidationConfigIn
```

Add endpoint:
```python
@router.patch("/series/{series_id}/validation-config", response_model=ValidationConfigOut)
def update_validation_config(
    series_id: int,
    body: ValidationConfigIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ValidationConfigOut:
    from app.models.series import Series

    series = db.get(Series, series_id)
    if series is None or series.user_id != user.id:
        raise HTTPException(status_code=404, detail="series not found")

    # Merge: existing config + partial update
    current = series.validation_config or {}
    update = body.model_dump(exclude_none=True)
    # Convert Decimals to strings for JSONB storage
    merged = {**current, **{k: str(v) if isinstance(v, Decimal) else v for k, v in update.items()}}
    series.validation_config = merged
    db.commit()

    from app.services.validation import _get_config as resolve_validation_config
    cfg = resolve_validation_config(series)
    return ValidationConfigOut(**cfg)
```

- [ ] **Step 4: Run tests**

```bash
cd backend && uv run pytest tests/api/ -q
```
Expected: All existing tests pass, new endpoints respond correctly

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/series.py
git commit -m "feat: add GET/PATCH /series/{id}/validation-config endpoints"
```

---

### Task 6: Write Unit Tests for Validation Rules

**Files:**
- Create: `backend/tests/unit/test_validation.py`

**Interfaces:**
- Consumes: `validate_fills_batch()` (from Task 3), factories from `tests/unit/conftest.py`
- Produces: Test coverage for all validation rules

- [ ] **Step 1: Write the test file**

Create `backend/tests/unit/test_validation.py`:

```python
"""Unit tests for fill validation rules."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from app.schemas.ingestion import FillIn
from app.schemas.validation import ValidationErrorDetail
from app.services.validation import validate_fills_batch


def _fill(cfid, strategy="alpha", symbol="ES", side="buy", qty="1", price="100", ts=None):
    return FillIn(
        client_fill_id=cfid,
        strategy=strategy,
        symbol=symbol,
        side=side,
        qty=Decimal(qty),
        price=Decimal(price),
        ts=ts or datetime(2024, 1, 2, 14, 30, tzinfo=UTC),
        commission=Decimal("0"),
        exchange_fee=Decimal("0"),
        regulatory_fee=Decimal("0"),
        financing_fee=Decimal("0"),
    )


class TestCapitalExistence:
    def test_rejects_fills_with_no_capital(self, db_session, user):
        """Reject fills when capital base is 0 and require_capital=True."""
        from app.models.account import Account
        from app.models.series import Series

        s = Series(user_id=user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.add(Account(series_id=s.id))
        db_session.flush()

        fills = [_fill("f1")]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 1
        assert errors[0].rule == "no_capital"

    def test_allows_fills_when_capital_exists(self, db_session, user):
        """Allow fills when EXTERNAL deposits exist."""
        from app.models.account import Account
        from app.models.enums import Bucket
        from app.models.fund_movement import FundMovement
        from app.models.series import Series

        s = Series(user_id=user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.add(Account(series_id=s.id))
        db_session.add(FundMovement(
            series_id=s.id,
            ts=datetime(2024, 1, 1, tzinfo=UTC),
            from_bucket=Bucket.EXTERNAL,
            to_bucket=Bucket.FREE_CASH,
            amount=Decimal("100000"),
            currency="USD",
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        ))
        db_session.flush()

        fills = [_fill("f1", ts=datetime(2024, 1, 2, tzinfo=UTC))]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0


class TestLeverageCheck:
    def test_rejects_when_strategy_exceeds_max_leverage(self, db_session, user):
        """Reject when cumulative notional exceeds capital × max_leverage_ratio."""
        from app.models.account import Account
        from app.models.enums import Bucket
        from app.models.fund_movement import FundMovement
        from app.models.instrument import Instrument
        from app.models.series import Series

        s = Series(user_id=user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.add(Account(series_id=s.id))
        db_session.add(Instrument(
            series_id=s.id, symbol="ES", asset_class="future",
            currency="USD", multiplier=Decimal("50"), inferred=False,
        ))
        db_session.add(FundMovement(
            series_id=s.id, ts=datetime(2024, 1, 1, tzinfo=UTC),
            from_bucket=Bucket.EXTERNAL, to_bucket=Bucket.FREE_CASH,
            amount=Decimal("100000"), currency="USD",
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
        ))
        db_session.flush()

        # ES at 5000 × 50 multiplier = $250K notional per contract
        # 3 contracts = $750K notional on $100K capital = 7.5× leverage > 5.0 max
        fills = [
            _fill("f1", qty="1", price="5000"),  # $250K
            _fill("f2", qty="1", price="5000"),  # $500K cumulative
            _fill("f3", qty="1", price="5000"),  # $750K cumulative → exceeds 500K = 500% of 100K
        ]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 1
        assert errors[0].rule == "leverage"
        assert errors[0].strategy == "alpha"
        assert errors[0].client_fill_id == "f3"

    def test_allows_within_leverage_limit(self, db_session, user):
        """Allow when cumulative notional stays within capital × max_leverage_ratio."""
        from app.models.account import Account
        from app.models.enums import Bucket
        from app.models.fund_movement import FundMovement
        from app.models.instrument import Instrument
        from app.models.series import Series

        s = Series(user_id=user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.add(Account(series_id=s.id))
        db_session.add(Instrument(
            series_id=s.id, symbol="ES", asset_class="future",
            currency="USD", multiplier=Decimal("50"), inferred=False,
        ))
        db_session.add(FundMovement(
            series_id=s.id, ts=datetime(2024, 1, 1, tzinfo=UTC),
            from_bucket=Bucket.EXTERNAL, to_bucket=Bucket.FREE_CASH,
            amount=Decimal("100000"), currency="USD",
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
        ))
        db_session.flush()

        # 1 contract = $250K notional on $100K capital = 2.5× → under 5.0 max
        fills = [_fill("f1", qty="1", price="5000")]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0


class TestEmptyBatch:
    def test_empty_batch_passes(self, db_session, user):
        """Empty batch always passes validation."""
        from app.models.account import Account
        from app.models.series import Series

        s = Series(user_id=user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.add(Account(series_id=s.id))
        db_session.flush()

        errors = validate_fills_batch(db_session, s.id, [])
        assert len(errors) == 0
```

- [ ] **Step 2: Run the tests**

```bash
cd backend && uv run pytest tests/unit/test_validation.py -v
```
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add backend/tests/unit/test_validation.py
git commit -m "test: add unit tests for fill validation rules"
```

---

### Task 7: Full Integration Test

**Files:**
- Create: `backend/tests/api/test_validation_api.py`

**Interfaces:**
- Consumes: `client` test fixture (existing), `make_user`/`make_api_key` (existing)
- Produces: Integration test verifying 422 on leveraged fills via API

- [ ] **Step 1: Write integration test**

Create `backend/tests/api/test_validation_api.py`:

```python
"""API integration tests for fill validation."""

from datetime import UTC, datetime
from decimal import Decimal


def test_fills_exceeding_leverage_return_422(db_session, client, make_user, make_api_key):
    """POST /series/{id}/fills:batch returns 422 when leverage exceeds limit."""
    from app.models.account import Account
    from app.models.enums import Bucket
    from app.models.fund_movement import FundMovement
    from app.models.instrument import Instrument
    from app.models.series import Series

    user = make_user(db_session, status="approved")
    _, api_key = make_api_key(db_session, user)
    headers = {"X-API-Key": api_key}

    # Create series
    resp = client.post("/series", headers=headers, json={
        "name": "test", "base_currency": "USD", "session_tz": "UTC",
    })
    sid = resp.json()["series_id"]

    # Register instrument (ES future, ×50 multiplier)
    client.post(f"/series/{sid}/instruments", headers=headers, json=[
        {"symbol": "ES", "asset_class": "future", "multiplier": "50", "currency": "USD"},
    ])

    # Post capital: $100K
    client.post(f"/series/{sid}/fund-movements", headers=headers, json=[
        {"ts": "2024-01-01T09:00:00Z", "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH",
         "amount": "100000", "currency": "USD"},
    ])

    # Post fills: 3 ES contracts at 5000 = $750K notional = 7.5× leverage > 5.0 max
    resp = client.post(f"/series/{sid}/fills:batch", headers=headers, json={
        "fills": [
            {"client_fill_id": "f1", "strategy": "alpha", "symbol": "ES", "side": "buy",
             "qty": "1", "price": "5000", "ts": "2024-01-02T14:30:00Z",
             "commission": "0", "exchange_fee": "0", "regulatory_fee": "0", "financing_fee": "0"},
            {"client_fill_id": "f2", "strategy": "alpha", "symbol": "ES", "side": "buy",
             "qty": "1", "price": "5000", "ts": "2024-01-02T14:31:00Z",
             "commission": "0", "exchange_fee": "0", "regulatory_fee": "0", "financing_fee": "0"},
            {"client_fill_id": "f3", "strategy": "alpha", "symbol": "ES", "side": "buy",
             "qty": "1", "price": "5000", "ts": "2024-01-02T14:32:00Z",
             "commission": "0", "exchange_fee": "0", "regulatory_fee": "0", "financing_fee": "0"},
        ]
    })
    assert resp.status_code == 422

    body = resp.json()
    assert body["code"] == "validation_failed"
    assert len(body["details"]) >= 1
    assert body["details"][0]["rule"] == "leverage"


def test_fills_within_limits_return_201(db_session, client, make_user, make_api_key):
    """POST /series/{id}/fills:batch returns 201 when within leverage limit."""
    user = make_user(db_session, status="approved")
    _, api_key = make_api_key(db_session, user)
    headers = {"X-API-Key": api_key}

    resp = client.post("/series", headers=headers, json={
        "name": "test2", "base_currency": "USD", "session_tz": "UTC",
    })
    sid = resp.json()["series_id"]

    client.post(f"/series/{sid}/instruments", headers=headers, json=[
        {"symbol": "ES", "asset_class": "future", "multiplier": "50", "currency": "USD"},
    ])
    client.post(f"/series/{sid}/fund-movements", headers=headers, json=[
        {"ts": "2024-01-01T09:00:00Z", "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH",
         "amount": "500000", "currency": "USD"},
    ])

    resp = client.post(f"/series/{sid}/fills:batch", headers=headers, json={
        "fills": [
            {"client_fill_id": "f1", "strategy": "alpha", "symbol": "ES", "side": "buy",
             "qty": "1", "price": "5000", "ts": "2024-01-02T14:30:00Z",
             "commission": "0", "exchange_fee": "0", "regulatory_fee": "0", "financing_fee": "0"},
        ]
    })
    assert resp.status_code == 201
```

- [ ] **Step 2: Run integration tests**

```bash
cd backend && uv run pytest tests/api/test_validation_api.py -v
```
Expected: Both tests pass

- [ ] **Step 3: Run full test suite**

```bash
cd backend && uv run pytest -q
```
Expected: All 130+ tests pass

- [ ] **Step 4: Commit**

```bash
git add backend/tests/api/test_validation_api.py
git commit -m "test: add API integration tests for fill validation"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Full backend test suite**

```bash
cd backend && uv run pytest --no-cov
```
Expected: All tests pass

- [ ] **Step 2: Frontend test suite**

```bash
cd frontend && npm run build && npm run test -- --run
```
Expected: All 94 tests pass, build clean

- [ ] **Step 3: Git log**

```bash
git log --oneline -8
```
