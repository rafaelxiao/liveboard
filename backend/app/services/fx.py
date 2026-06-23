"""As-of FX conversion: instrument/movement currency -> series base_currency."""

from sqlalchemy import select

from app.models.fx_rate import FxRate
from app.models.series import Series


def as_of_rate(session, series_id, ccy_from, ccy_to, at):
    if ccy_from == ccy_to:
        return None  # same-ccy returns None; callers should short-circuit
    stmt = (
        select(FxRate.rate)
        .where(
            FxRate.series_id == series_id,
            FxRate.ccy_from == ccy_from,
            FxRate.ccy_to == ccy_to,
            FxRate.ts <= at,
        )
        .order_by(FxRate.ts.desc())
        .limit(1)
    )
    return session.execute(stmt).scalar_one_or_none()


def to_base(session, series_id, amount, ccy, at):
    base = session.get(Series, series_id).base_currency
    if ccy == base:
        return amount  # identity — no lookup
    rate = as_of_rate(session, series_id, ccy, base, at)
    if rate is None:
        return None  # missing rate — caller excludes
    return amount * rate
