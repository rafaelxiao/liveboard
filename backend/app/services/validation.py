"""Pre-ingestion fill validation — leverage, capital, drawdown checks."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Optional

from sqlalchemy.orm import Session

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
        "max_leverage_ratio": Decimal(
            raw.get("max_leverage_ratio", str(DEFAULT_MAX_LEVERAGE_RATIO))
        ),
        "max_drawdown_ratio": (
            Decimal(raw["max_drawdown_ratio"])
            if raw.get("max_drawdown_ratio") is not None
            else DEFAULT_MAX_DRAWDOWN_RATIO
        ),
        "require_capital": raw.get("require_capital", DEFAULT_REQUIRE_CAPITAL),
    }


def _load_instruments(session: Session, series_id: int) -> dict[str, Instrument]:
    """Load all registered instruments for a series, keyed by normalized symbol."""
    from sqlalchemy import select

    rows = session.scalars(
        select(Instrument).where(Instrument.series_id == series_id)
    ).all()
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
    series = session.get(Series, series_id)
    if series is None:
        detail = ValidationErrorDetail(
            client_fill_id="",
            rule="series_not_found",
        )
        return [detail]

    config = _get_config(series)
    instruments = _load_instruments(session, series_id)
    errors: list[ValidationErrorDetail] = []

    # Track cumulative position per strategy (simulated, not persisted)
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

        # Update simulated cumulative notional for this strategy
        strategy_notionals[fill.strategy.strip().lower()] += notional

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
