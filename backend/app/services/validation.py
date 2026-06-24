"""Pre-ingestion fill validation — leverage, capital, drawdown checks."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.fill import Fill
from app.models.instrument import Instrument
from app.models.series import Series
from app.models.strategy import Strategy
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
    rows = session.scalars(
        select(Instrument).where(Instrument.series_id == series_id)
    ).all()
    return {r.symbol.upper(): r for r in rows}


def _existing_net_notional(
    session: Session,
    series_id: int,
    before: datetime,
    instruments: dict[str, Instrument],
) -> dict[str, Decimal]:
    """Load existing (non-voided) fills up to *before* and compute
    net notional per strategy so validation is stateful across calls.

    For each fill:   signed_notional = qty × price × multiplier
      - BUY  → positive
      - SELL → negative
    The result is a dict of cumulative net notional per strategy name.
    """
    rows = session.execute(
        select(
            Strategy.name,
            Fill.side,
            Fill.symbol,
            Fill.qty,
            Fill.price,
        )
        .join(Strategy, Fill.strategy_id == Strategy.id)
        .where(
            Fill.series_id == series_id,
            Fill.voided_at.is_(None),
            Fill.ts < before,
        )
        .order_by(Fill.ts)
    ).all()

    net: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for name, side, symbol, qty, price in rows:
        instr = instruments.get(symbol.upper())
        multiplier = instr.multiplier if instr else Decimal("1")
        notional = qty * price * multiplier
        if side == "sell":
            notional = -notional
        net[name.strip().lower()] += notional
    return net


def validate_fills_batch(
    session: Session,
    series_id: int,
    fills: list[FillIn],
) -> list[ValidationErrorDetail]:
    """Validate a batch of fills before ingestion.

    Returns a list of validation errors. Empty list means all fills pass.

    The validation is stateful across calls: it loads existing fills from
    the DB up to the earliest fill timestamp in the batch and seeds the
    running net-notional counter, so leverage tracks net position across
    multiple POST requests.
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

    # Seed cumulative net notional from fills already in the DB
    if fills:
        earliest_ts = min(f.ts for f in fills)
        strategy_notionals = _existing_net_notional(
            session, series_id, earliest_ts, instruments
        )
    else:
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

        # Compute notional for this fill (signed: buy positive, sell negative)
        notional = fill.qty * fill.price * multiplier
        if fill.side == "sell":
            notional = -notional

        # Update simulated cumulative net notional for this strategy
        strategy_notionals[fill.strategy.strip().lower()] += notional

        # Rule 2: Strategy leverage (based on absolute net notional)
        net = strategy_notionals[fill.strategy]
        if cap_base > Decimal("0"):
            leverage = abs(net) / cap_base
            if leverage > config["max_leverage_ratio"]:
                errors.append(ValidationErrorDetail(
                    client_fill_id=fill.client_fill_id,
                    rule="leverage",
                    strategy=fill.strategy,
                    current=str(leverage),
                    limit=str(config["max_leverage_ratio"]),
                ))

    return errors
