# backend/tests/unit/test_ingestion.py
from decimal import Decimal

import pytest
from app.models.fund_movement import FundMovement
from app.models.instrument import Instrument
from app.schemas.ingestion import FundMovementIn
from app.schemas.instrument import InstrumentIn
from app.services.ingestion import (
    IngestionError,
    get_or_create_instrument,
    ingest_fund_movements,
    upsert_instruments,
)


@pytest.fixture
def user(db_session):
    from app.core.security import hash_password
    from app.models.user import User

    u = User(email="test@example.com", password_hash=hash_password("test"), role="user", status="approved")
    db_session.add(u)
    db_session.flush()
    return u


def _series(db_session, user_id):
    from app.models.series import Series

    s = Series(user_id=user_id, name="t", base_currency="USD", session_tz="UTC")
    db_session.add(s)
    db_session.flush()
    return s.id


# --- Instrument (Task 3) ---


def test_auto_create_instrument_is_inferred(db_session, user):
    sid = _series(db_session, user.id)
    cache: set[str] = set()
    get_or_create_instrument(db_session, sid, "AAPL", "USD", cache)
    inst = db_session.query(Instrument).filter_by(series_id=sid, symbol="AAPL").one()
    assert inst.inferred is True
    assert inst.asset_class == "equity"
    assert inst.multiplier == Decimal("1")
    assert inst.currency == "USD"


def test_upsert_instruments_sets_inferred_false(db_session, user):
    sid = _series(db_session, user.id)
    cache: set[str] = set()
    get_or_create_instrument(db_session, sid, "ES", "USD", cache)
    n = upsert_instruments(
        db_session,
        series_id=sid,
        instruments=[
            InstrumentIn(
                symbol="es",
                asset_class="future",
                currency="USD",
                multiplier=Decimal("50"),
            )
        ],
    )
    assert n == 1
    inst = db_session.query(Instrument).filter_by(series_id=sid, symbol="ES").one()
    assert inst.inferred is False
    assert inst.multiplier == Decimal("50")


# --- Fund Movement (Task 6) ---


def test_fund_movement_external_to_free_cash(db_session, user):
    sid = _series(db_session, user.id)
    n = ingest_fund_movements(
        db_session,
        series_id=sid,
        movements=[
            FundMovementIn(
                ts="2026-06-19T00:00:00Z",
                currency="USD",
                from_bucket="EXTERNAL",
                to_bucket="FREE_CASH",
                amount="100000",
            )
        ],
    )
    assert n == 1
    mv = db_session.query(FundMovement).filter_by(series_id=sid).one()
    assert mv.from_bucket == "EXTERNAL"
    assert mv.to_bucket == "FREE_CASH"


def test_fund_movement_strategy_requires_strategy_name(db_session, user):
    sid = _series(db_session, user.id)
    with pytest.raises(IngestionError, match="strategy"):
        ingest_fund_movements(
            db_session,
            series_id=sid,
            movements=[
                FundMovementIn(
                    ts="2026-06-19T00:00:00Z",
                    currency="USD",
                    from_bucket="FREE_CASH",
                    to_bucket="STRATEGY",
                    amount="5000",
                )
            ],
        )


def test_fund_movement_same_bucket_rejected(db_session, user):
    sid = _series(db_session, user.id)
    with pytest.raises(IngestionError, match="from_bucket"):
        ingest_fund_movements(
            db_session,
            series_id=sid,
            movements=[
                FundMovementIn(
                    ts="2026-06-19T00:00:00Z",
                    currency="USD",
                    from_bucket="FREE_CASH",
                    to_bucket="FREE_CASH",
                    amount="1",
                )
            ],
        )


def test_fund_movement_nonpositive_amount_rejected(db_session, user):
    sid = _series(db_session, user.id)
    with pytest.raises(IngestionError, match="amount"):
        ingest_fund_movements(
            db_session,
            series_id=sid,
            movements=[
                FundMovementIn(
                    ts="2026-06-19T00:00:00Z",
                    currency="USD",
                    from_bucket="EXTERNAL",
                    to_bucket="FREE_CASH",
                    amount="0",
                )
            ],
        )


def test_fund_movement_strategy_transfer_auto_creates(db_session, user):
    sid = _series(db_session, user.id)
    n = ingest_fund_movements(
        db_session,
        series_id=sid,
        movements=[
            FundMovementIn(
                ts="2026-06-19T00:00:00Z",
                currency="USD",
                from_bucket="STRATEGY",
                to_bucket="STRATEGY",
                from_strategy="Momentum",
                to_strategy="MeanRev",
                amount="2500",
            )
        ],
    )
    assert n == 1
    from app.models.strategy import Strategy

    assert db_session.query(Strategy).filter_by(series_id=sid).count() == 2
