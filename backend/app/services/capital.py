"""Double-entry, external-only, base-currency capital base from FundMovements."""

import datetime as dt
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import Bucket
from app.models.fund_movement import FundMovement
from app.models.series import Series


def _net_flow(
    session: Session,
    series_id: int,
    bucket: Bucket | None,
    at: dt.datetime | None,
    strategy_id: int | None = None,
) -> Decimal:
    """Net flow (inflows - outflows) for a bucket up to timestamp *at*.

    Voided movements are excluded.  Internal transfers (FREE_CASH ↔ STRATEGY)
    cancel out at the account level because they are double-entry inside the
    series; only EXTERNAL movements change the account base.
    """
    stmt = select(FundMovement).where(
        FundMovement.series_id == series_id,
        FundMovement.voided_at.is_(None),
    )
    if at is not None:
        stmt = stmt.where(FundMovement.ts <= at)

    rows = session.scalars(stmt).all()

    inflow = Decimal("0")
    outflow = Decimal("0")
    for row in rows:
        if bucket is not None:
            # Strategy-level: only count flows into/out of this bucket
            if row.to_bucket == bucket:
                if strategy_id is None or row.to_strategy_id == strategy_id:
                    inflow += row.amount  # money enters this bucket
            if row.from_bucket == bucket:
                if strategy_id is None or row.from_strategy_id == strategy_id:
                    outflow += row.amount  # money leaves this bucket
        else:
            # Account-level: net of EXTERNAL only (internal cancels)
            if row.from_bucket == Bucket.EXTERNAL:
                # Money flows from EXTERNAL into the account → inflow
                inflow += row.amount
            elif row.to_bucket == Bucket.EXTERNAL:
                # Money flows out of the account to EXTERNAL → outflow
                outflow += row.amount
            # Internal transfers (FREE_CASH ↔ STRATEGY) are ignored

    return inflow - outflow


def account_base(
    session: Session,
    series_id: int,
    at: dt.datetime | None,
) -> Decimal:
    """Capital base at the account level — net of EXTERNAL movements only."""
    return _net_flow(session, series_id, bucket=None, at=at)


def strategy_base(
    session: Session,
    series_id: int,
    strategy_id: int,
    at: dt.datetime | None,
) -> Decimal:
    """Capital base for a single strategy bucket."""
    return _net_flow(
        session, series_id, bucket=Bucket.STRATEGY,
        at=at, strategy_id=strategy_id,
    )


def free_cash(
    session: Session,
    series_id: int,
    at: dt.datetime | None,
) -> Decimal:
    """Capital base for the FREE_CASH bucket."""
    return _net_flow(session, series_id, bucket=Bucket.FREE_CASH, at=at)


def base_series(
    session: Session,
    series_id: int,
    level: str,
    ref_id: int | None,
    days: list[dt.date],
) -> dict[dt.date, Decimal]:
    """Precompute capital base for all days in a single pass.

    *level* is one of ``"account"``, ``"strategy"``, ``"free_cash"``.
    *ref_id* is the strategy id when *level* is ``"strategy"``, ignored otherwise.

    Each day's value is the capital base as of end-of-day (23:59:59 UTC).
    """
    result: dict[dt.date, Decimal] = {}
    days_sorted = sorted(days)

    if level == "free_cash":
        # free_cash still uses the per-day approach for simplicity
        for day in days_sorted:
            at = dt.datetime.combine(day, dt.time(23, 59, 59), tzinfo=dt.timezone.utc)
            result[day] = free_cash(session, series_id, at)
        return result

    # Load all movements once
    stmt = select(FundMovement).where(
        FundMovement.series_id == series_id,
        FundMovement.voided_at.is_(None),
    )
    rows = session.scalars(stmt).all()

    if level == "account":
        # Single pass: accumulate and snapshot at each day end
        cum = Decimal("0")
        row_idx = 0
        rows_by_ts = sorted(rows, key=lambda r: r.ts)
        for day in days_sorted:
            day_end = dt.datetime.combine(day, dt.time(23, 59, 59), tzinfo=dt.timezone.utc)
            while row_idx < len(rows_by_ts) and rows_by_ts[row_idx].ts <= day_end:
                m = rows_by_ts[row_idx]
                if m.from_bucket == Bucket.EXTERNAL:
                    cum += m.amount
                elif m.to_bucket == Bucket.EXTERNAL:
                    cum -= m.amount
                row_idx += 1
            result[day] = cum
    elif level == "strategy" and ref_id is not None:
        # Single pass: accumulate and snapshot at each day end
        cum = Decimal("0")
        row_idx = 0
        rows_by_ts = sorted(rows, key=lambda r: r.ts)
        for day in days_sorted:
            day_end = dt.datetime.combine(day, dt.time(23, 59, 59), tzinfo=dt.timezone.utc)
            while row_idx < len(rows_by_ts) and rows_by_ts[row_idx].ts <= day_end:
                m = rows_by_ts[row_idx]
                if m.to_bucket == Bucket.STRATEGY and m.to_strategy_id == ref_id:
                    cum += m.amount
                if m.from_bucket == Bucket.STRATEGY and m.from_strategy_id == ref_id:
                    cum -= m.amount
                row_idx += 1
            result[day] = cum
    else:
        result = {day: Decimal("0") for day in days_sorted}

    return result
