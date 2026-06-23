# Fill Validation — Design Spec

**Date**: 2026-06-20
**Status**: Approved

## Motivation

LiveBoard is a historical analytics platform. Fills represent facts that happened on an exchange or broker. However, data ingestion errors (wrong decimal place for price, wrong account, script bugs) can silently corrupt all metrics — a $100M fill on a $100K account makes Sharpe, drawdown, PnL, and equity curves meaningless.

We need a **pre-ingestion validation layer** that catches obviously-wrong data before it hits the database, without blocking legitimate fills.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Validation timing | Pre-ingestion (before DB writes) | Clean separation, no rollback complexity |
| Failed batch behavior | Reject entire batch (all-or-nothing) | Avoids partial state, simpler for callers |
| Configurability | Global defaults + per-series overrides | Safe defaults for most users, power users can tune |
| Violated fills | Never stored | No voided-fill cleanup needed |

## Architecture

```
POST /series/{id}/fills:batch
        │
        ▼
┌───────────────────────────┐
│  validate_fills_batch()   │  ◄── NEW layer
│  1. Load capital timeline │
│  2. Simulate cumulative   │
│     position per strategy  │
│  3. Check each fill vs    │
│     max_leverage_ratio     │
│  4. All pass → continue    │
│  5. Any fail → 422 reject  │
└───────────┬───────────────┘
            │ (pass)
            ▼
┌───────────────────────────┐
│  ingest_fills_batch()      │  ◄── Existing logic (unchanged)
└───────────────────────────┘
```

- **Stateless**: validation takes fills + series_id, returns pass/fail
- **Same transaction**: runs in the same DB session as ingestion
- **Capital source**: `capital.account_base()` (already optimized, single query)

## Validation Rules

Three checks in order. If any fails → entire batch rejected with 422.

### Rule 1: Capital Existence
```
capital_base = account_base(session, series_id, fill.ts)
if capital_base == 0:
    REJECT "No capital base at {ts} — post fund movements first"
```
Config: `require_capital: bool = True`

### Rule 2: Strategy Leverage
Simulate cumulative position per strategy after each fill:
```
strategy_leverage = cumulative_notional / capital_base
if strategy_leverage > max_leverage_ratio:
    REJECT "Strategy {strategy} exceeds leverage limit ({actual}x > {limit}x)"
```
Config: `max_leverage_ratio: Decimal = "5.0"`

### Rule 3: Aggregate Drawdown
Cumulative realized PnL across all strategies:
```
if realized_loss > capital_base × max_drawdown_ratio:
    REJECT "Cumulative loss exceeds max drawdown threshold"
```
Config: `max_drawdown_ratio: Decimal | None = None` (disabled by default)

## Per-Series Configuration

### Series model extension
Add `validation_config` JSON column to `series` table:
```python
# app/models/series.py
validation_config = Column(JSONB, nullable=True)
```

### Default configuration
```python
DEFAULT_VALIDATION_CONFIG = {
    "max_leverage_ratio": "5.0",
    "max_drawdown_ratio": None,
    "require_capital": True,
}
```

### API to update config
```python
# PATCH /series/{id}/validation-config
# Body: { "max_leverage_ratio": "3.0" }
```

- If `validation_config` is NULL on a series, use defaults
- Partial updates allowed — only changed fields need to be sent

## Error Response

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Batch rejected: 3 fills violate limits",
    "details": [
      {
        "client_fill_id": "f-001",
        "rule": "leverage",
        "strategy": "momentum-equity",
        "current": "6.2",
        "limit": "5.0"
      },
      {
        "client_fill_id": "f-003",
        "rule": "no_capital",
        "ts": "2024-01-01T09:00:00Z"
      }
    ]
  }
}
```

## Files to Modify

| File | Change |
|------|--------|
| `backend/app/models/series.py` | Add `validation_config` column |
| `backend/app/services/validation.py` | **NEW** — `validate_fills_batch()` |
| `backend/app/routers/ingestion.py` | Call validation before ingestion |
| `backend/app/schemas/ingestion.py` | Add `ValidationError` schema |
| `backend/app/schemas/series.py` | Add `ValidationConfig` schema |
| `backend/app/routers/series.py` | Add `PATCH /series/{id}/validation-config` |
| `backend/tests/unit/test_validation.py` | **NEW** — validation tests |

## Key Design Properties

1. **No false positives**: Default thresholds are generous (500% leverage). Users should only see rejections for genuinely suspicious data.
2. **Capital base is net EXTERNAL**: Only deposits/withdrawals count, not internal transfers. Consistent with metrics calculation.
3. **Simulation isolates from DB state**: Validation simulates positions in memory. If it passes, actual ingestion proceeds. No partial state.
4. **Instrument multipliers are respected**: `cumulative_notional = sum(qty × price × multiplier)` per strategy, using the registered instrument multiplier.
5. **Backward compatible**: Old fills without validation pass through. New fills get validation. Voided fills are already excluded from capital calculation.

## Testing Strategy

- Unit tests for each validation rule (capital missing, leverage exceeded, drawdown breached)
- Rounding edge cases (Decimal precision)
- Batch with 0 fills
- Per-series config override — null config → defaults, partial config → merged
- All 130 existing backend tests must pass
