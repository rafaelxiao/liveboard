from datetime import UTC, datetime
from decimal import Decimal

import pytest
from app.models.fill import Fill
from app.models.fund_movement import FundMovement
from app.models.fx_rate import FxRate
from app.models.instrument import Instrument
from app.models.series import Series
from app.models.strategy import Strategy
from app.models.user import User
from app.core.security import hash_password


@pytest.fixture
def db(db_session):
    return db_session


@pytest.fixture
def user(db_session):
    u = User(
        email="test@example.com",
        password_hash=hash_password("test"),
        role="user",
        status="approved",
    )
    db_session.add(u)
    db_session.flush()
    return u


def utc(y, mo, d, h=0, mi=0, s=0):
    """Aware UTC datetime (all ts are UTC per Global Constraints)."""
    return datetime(y, mo, d, h, mi, s, tzinfo=UTC)


@pytest.fixture
def series(db_session, user):
    s = Series(
        user_id=user.id,
        name="t",
        tag="real",
        notes=None,
        base_currency="USD",
        session_tz="America/New_York",
    )
    db_session.add(s)
    db_session.flush()
    return s


@pytest.fixture
def strategy(db_session, series):
    st = Strategy(series_id=series.id, name="alpha", name_key="alpha")
    db_session.add(st)
    db_session.flush()
    return st


def make_instrument(
    db_session,
    series,
    symbol="AAPL",
    asset_class="equity",
    currency="USD",
    multiplier="1",
    inferred=False,
):
    ins = Instrument(
        series_id=series.id,
        symbol=symbol,
        asset_class=asset_class,
        currency=currency,
        multiplier=Decimal(multiplier),
        inferred=inferred,
    )
    db_session.add(ins)
    db_session.flush()
    return ins


def make_fill(
    db_session,
    series,
    strategy,
    *,
    client_fill_id,
    side,
    qty,
    price,
    symbol="AAPL",
    at=None,
    commission="0",
    exchange_fee="0",
    regulatory_fee="0",
    financing_fee="0",
    position_effect=None,
    voided=False,
):
    f = Fill(
        series_id=series.id,
        strategy_id=strategy.id,
        symbol=symbol,
        side=side,
        qty=Decimal(qty),
        price=Decimal(price),
        commission=Decimal(commission),
        exchange_fee=Decimal(exchange_fee),
        regulatory_fee=Decimal(regulatory_fee),
        financing_fee=Decimal(financing_fee),
        ts=at or utc(2026, 6, 19, 14, 30),
        client_fill_id=client_fill_id,
        position_effect=position_effect,
        voided_at=utc(2026, 6, 19) if voided else None,
        created_at=utc(2026, 6, 19),
        updated_at=utc(2026, 6, 19),
    )
    db_session.add(f)
    db_session.flush()
    return f


def make_fx(db_session, series, *, ccy_from, ccy_to, at, rate):
    r = FxRate(
        series_id=series.id,
        ccy_from=ccy_from,
        ccy_to=ccy_to,
        ts=at,
        rate=Decimal(rate),
    )
    db_session.add(r)
    db_session.flush()
    return r


def make_fund(
    db_session,
    series,
    *,
    at,
    amount,
    from_bucket,
    to_bucket,
    currency="USD",
    from_strategy_id=None,
    to_strategy_id=None,
    voided=False,
):
    m = FundMovement(
        series_id=series.id,
        ts=at,
        currency=currency,
        amount=Decimal(amount),
        from_bucket=from_bucket,
        to_bucket=to_bucket,
        from_strategy_id=from_strategy_id,
        to_strategy_id=to_strategy_id,
        voided_at=utc(2026, 6, 19) if voided else None,
        created_at=utc(2026, 6, 19),
        updated_at=utc(2026, 6, 19),
    )
    db_session.add(m)
    db_session.flush()
    return m
