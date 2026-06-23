"""Unit tests for fill validation rules."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from app.core.security import hash_password
from app.models.enums import Bucket
from app.models.fund_movement import FundMovement
from app.models.instrument import Instrument
from app.models.series import Series
from app.models.user import User
from app.schemas.ingestion import FillIn
from app.services.validation import validate_fills_batch


@pytest.fixture
def _user(db_session):
    u = User(email="val@test.com", password_hash=hash_password("test"), role="user", status="approved")
    db_session.add(u)
    db_session.flush()
    return u


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
    def test_rejects_fills_with_no_capital(self, db_session, _user):
        s = Series(user_id=_user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.flush()
        db_session.flush()

        fills = [_fill("f1")]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 1
        assert errors[0].rule == "no_capital"

    def test_allows_fills_when_capital_exists(self, db_session, _user):
        s = Series(user_id=_user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.flush()
        db_session.add(FundMovement(
            series_id=s.id, ts=datetime(2024, 1, 1, tzinfo=UTC),
            from_bucket=Bucket.EXTERNAL, to_bucket=Bucket.FREE_CASH,
            amount=Decimal("100000"), currency="USD",
            created_at=datetime.now(UTC), updated_at=datetime.now(UTC),
        ))
        db_session.flush()

        fills = [_fill("f1", ts=datetime(2024, 1, 2, tzinfo=UTC))]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0


class TestLeverageCheck:
    def test_rejects_when_strategy_exceeds_max_leverage(self, db_session, _user):
        s = Series(user_id=_user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.flush()
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

        # ES at 5000 * 50 multiplier = 250K per contract
        # 3 contracts = 750K / 100K capital = 7.5x > 5.0 max
        fills = [
            _fill("f1", qty="1", price="5000"),
            _fill("f2", qty="1", price="5000"),
            _fill("f3", qty="1", price="5000"),
        ]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 1
        assert errors[0].rule == "leverage"
        assert errors[0].strategy == "alpha"
        assert errors[0].client_fill_id == "f3"

    def test_allows_within_leverage_limit(self, db_session, _user):
        s = Series(user_id=_user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.flush()
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

        # 1 contract = 250K / 100K capital = 2.5x < 5.0 max
        fills = [_fill("f1", qty="1", price="5000")]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0


class TestEmptyBatch:
    def test_empty_batch_passes(self, db_session, _user):
        s = Series(user_id=_user.id, name="test", base_currency="USD", session_tz="UTC")
        db_session.add(s)
        db_session.flush()
        db_session.flush()

        errors = validate_fills_batch(db_session, s.id, [])
        assert len(errors) == 0
