"""Unit tests for fill validation rules."""

from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
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

    def test_round_trip_nets_to_zero_no_leverage_violation(self, db_session, _user):
        """Buy + sell of same size nets to zero, so never exceeds leverage."""
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

        # Round-trip: buy 1, sell 1, repeat 1000x — net exposure never exceeds 1 contract
        # Without netting, this would look like cumulative 1000*250K*2 = 500M notional
        fills = []
        for i in range(1000):
            fills.append(_fill(f"buy{i}", qty="1", price="5000", side="buy"))
            fills.append(_fill(f"sell{i}", qty="1", price="5000", side="sell"))

        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0

    def test_net_leverage_drops_after_sells(self, db_session, _user):
        """Buy 2 (5.0x), sell 1 → net 1 (2.5x) — no violation."""
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

        # Buy 2 (500K → 5.0x, OK), then sell 1 (—250K → net 250K → 2.5x)
        # All pass because leverage never exceeds 5.0
        fills = [
            _fill("b1", qty="1", price="5000", side="buy"),
            _fill("b2", qty="1", price="5000", side="buy"),
            _fill("s1", qty="1", price="5000", side="sell"),
        ]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0

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


class TestCrossCallStatefulLeverage:
    """Verify that leverage tracks net position across separate API calls.

    Previous fills are already in the DB (as if ingested by earlier POSTs).
    The new batch should see the cumulative net notional.
    """

    @staticmethod
    def _setup(db_session, _user):
        """Create a series with capital and an ES instrument."""
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
        return s

    @staticmethod
    def _seed_fill(db_session, series_id, client_fill_id, strategy_name, side, qty, price, ts):
        """Insert a fill and its strategy directly — simulates a previous ingestion."""
        from app.models.fill import Fill
        from app.models.strategy import Strategy

        key = strategy_name.strip().lower()
        strat = db_session.scalar(
            select(Strategy).where(
                Strategy.series_id == series_id,
                Strategy.name_key == key,
            )
        )
        if strat is None:
            strat = Strategy(series_id=series_id, name=strategy_name, name_key=key)
            db_session.add(strat)
            db_session.flush()

        db_session.add(Fill(
            series_id=series_id,
            strategy_id=strat.id,
            symbol="ES",
            side=side,
            qty=Decimal(qty),
            price=Decimal(price),
            ts=ts,
            client_fill_id=client_fill_id,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        ))
        db_session.flush()

    def test_existing_long_sell_nets_down_no_violation(self, db_session, _user):
        """Previous call bought 2 contracts (5.0x). New call sells 1 → net 1 (2.5x)."""
        s = self._setup(db_session, _user)
        t1 = datetime(2024, 1, 2, 10, 0, tzinfo=UTC)
        t2 = datetime(2024, 1, 2, 11, 0, tzinfo=UTC)
        t3 = datetime(2024, 1, 2, 12, 0, tzinfo=UTC)

        # Simulate previous ingestion: buy 2 @ 5000 → 500K notional (5.0x)
        self._seed_fill(db_session, s.id, "prev_b1", "alpha", "buy", "1", "5000", t1)
        self._seed_fill(db_session, s.id, "prev_b2", "alpha", "buy", "1", "5000", t2)

        # New batch: sell 1 @ 5000 → net = 250K → 2.5x — no violation
        fills = [_fill("new_s1", qty="1", price="5000", side="sell", ts=t3)]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0

    def test_existing_long_buy_more_triggers_leverage(self, db_session, _user):
        """Previous call bought 2 (5.0x). New call buys 1 more → 7.5x → rejected."""
        s = self._setup(db_session, _user)
        t1 = datetime(2024, 1, 2, 10, 0, tzinfo=UTC)
        t2 = datetime(2024, 1, 2, 11, 0, tzinfo=UTC)
        t3 = datetime(2024, 1, 2, 12, 0, tzinfo=UTC)

        self._seed_fill(db_session, s.id, "prev_b1", "alpha", "buy", "1", "5000", t1)
        self._seed_fill(db_session, s.id, "prev_b2", "alpha", "buy", "1", "5000", t2)

        # New batch: buy 1 more → 750K → 7.5x
        fills = [_fill("new_b3", qty="1", price="5000", side="buy", ts=t3)]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 1
        assert errors[0].rule == "leverage"
        assert errors[0].client_fill_id == "new_b3"

    def test_existing_sells_make_room_for_new_buys(self, db_session, _user):
        """Previous call bought 3 (7.5x — was rejected before?), already in DB.
        Then another call sold 2 (net 1 = 2.5x).
        New call buys 1 more → net 2 = 5.0x — OK."""
        s = self._setup(db_session, _user)
        t1 = datetime(2024, 1, 2, 10, 0, tzinfo=UTC)
        t2 = datetime(2024, 1, 2, 11, 0, tzinfo=UTC)
        t3 = datetime(2024, 1, 2, 12, 0, tzinfo=UTC)
        t4 = datetime(2024, 1, 2, 13, 0, tzinfo=UTC)
        t5 = datetime(2024, 1, 2, 14, 0, tzinfo=UTC)
        t6 = datetime(2024, 1, 2, 15, 0, tzinfo=UTC)

        # Previous calls: buy 3, then later sold 2 → net = 1 (2.5x) in DB
        self._seed_fill(db_session, s.id, "prev_b1", "alpha", "buy", "1", "5000", t1)
        self._seed_fill(db_session, s.id, "prev_b2", "alpha", "buy", "1", "5000", t2)
        self._seed_fill(db_session, s.id, "prev_b3", "alpha", "buy", "1", "5000", t3)
        self._seed_fill(db_session, s.id, "prev_s1", "alpha", "sell", "1", "5000", t4)
        self._seed_fill(db_session, s.id, "prev_s2", "alpha", "sell", "1", "5000", t5)

        # New batch: buy 1 → net = 2 contracts = 500K → 5.0x — OK
        fills = [_fill("new_b4", qty="1", price="5000", side="buy", ts=t6)]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0

    def test_existing_fills_before_batch_ignored_after_batch_start(self, db_session, _user):
        """Existing fills AFTER the batch's earliest ts are excluded from the seed.
        This prevents double-counting during idempotent retries."""
        s = self._setup(db_session, _user)
        t1 = datetime(2024, 1, 2, 10, 0, tzinfo=UTC)
        t2 = datetime(2024, 1, 2, 11, 0, tzinfo=UTC)

        # Existing fill at t2 (same as or after batch start)
        self._seed_fill(db_session, s.id, "prev_b1", "alpha", "buy", "1", "5000", t2)

        # New batch with earliest_ts = t1 (which is before the existing fill)
        # The existing fill at t2 should NOT be counted (ts < t1 is false)
        # So the batch starts from 0 and sees only its own fill
        fills = [_fill("new_b1", qty="1", price="5000", side="buy", ts=t1)]
        errors = validate_fills_batch(db_session, s.id, fills)
        assert len(errors) == 0  # 250K → 2.5x, OK

    def test_separate_strategies_dont_interfere(self, db_session, _user):
        """A long position in 'alpha' should not block buys in 'beta'."""
        s = self._setup(db_session, _user)
        t1 = datetime(2024, 1, 2, 10, 0, tzinfo=UTC)
        t2 = datetime(2024, 1, 2, 11, 0, tzinfo=UTC)
        t3 = datetime(2024, 1, 2, 12, 0, tzinfo=UTC)

        # Alpha: already bought 2 (5.0x)
        self._seed_fill(db_session, s.id, "a_b1", "alpha", "buy", "1", "5000", t1)
        self._seed_fill(db_session, s.id, "a_b2", "alpha", "buy", "1", "5000", t2)

        # New batch: beta buys 2 → beta starts from 0 → 2.5x then 5.0x → OK
        fills = [
            _fill("b_b1", strategy="beta", qty="1", price="5000", side="buy", ts=t3),
            _fill("b_b2", strategy="beta", qty="1", price="5000", side="buy", ts=t3),
        ]
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
