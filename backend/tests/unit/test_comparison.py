"""Unit tests for comparison engine — tasks 1-7."""

from datetime import UTC, datetime
from datetime import timezone as tzinfo

import pytest
from app.core.errors import NotFoundError
from app.schemas.comparison import (
    ComparisonIn,
    ComparisonMeta,
    ComparisonOut,
    PerTradeBlock,
    PerTradeDiff,
    PerTradeRow,
    PerTradeValue,
)
from app.services.comparison import (
    _account_block,
    _load_owned_series,
    _partition_by_currency,
    _resolve_baseline,
    _strategy_block,
    _symbol_block,
    compare,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def user(db_session):
    """Test user fixture for comparison tests."""
    from app.core.security import hash_password
    from app.models.user import User

    u = User(email="test@example.com", password_hash=hash_password("test"), role="user", status="approved")
    db_session.add(u)
    db_session.flush()
    return u


def _make_other_user(db_session):
    """Create a second user for cross-user tests."""
    from app.core.security import hash_password
    from app.models.user import User

    u = User(email="other@example.com", password_hash=hash_password("test"), role="user", status="approved")
    db_session.add(u)
    db_session.flush()
    return u

# ---------------------------------------------------------------------------
# Task 1: Schemas
# ---------------------------------------------------------------------------


def test_comparison_in_defaults():
    body = ComparisonIn(series_ids=[1, 2])
    assert body.baseline_series_id is None
    assert body.trade_view == "lot"
    assert body.per_trade_page == 1
    assert body.per_trade_page_size == 500


def test_comparison_out_serializes_numbers_as_strings():
    row = PerTradeRow(
        ts="2026-06-19T13:30:00+00:00",
        symbol="ETH",
        side="buy",
        name_key="momo-eth",
        values={
            "1": PerTradeValue(
                price="100.00",
                qty="1.0",
                total_fee="0.50",
                ts="2026-06-19T13:30:00+00:00",
            ),
            "2": PerTradeValue(
                price="100.10",
                qty="1.0",
                total_fee="0.60",
                ts="2026-06-19T13:30:03+00:00",
            ),
        },
        diff=PerTradeDiff(
            price_slippage="0.10",
            price_slippage_pct="0.1",
            timing_sec=3,
            qty_diff="0.0",
            fee_diff="0.10",
        ),
    )
    out = ComparisonOut(
        meta=ComparisonMeta(
            base_currency="USD",
            baseline_series_id=1,
            date_range={"from": None, "to": None},
            currency_mismatch_series=[],
        ),
        account={"series": []},
        strategy={},
        symbol={},
        per_trade=PerTradeBlock(page=1, page_size=500, total=1, rows=[row], unmatched={}),
        equity_curves=[],
    )
    dumped = out.model_dump()
    assert dumped["per_trade"]["rows"][0]["diff"]["timing_sec"] == 3
    assert dumped["per_trade"]["rows"][0]["values"]["2"]["price"] == "100.10"
    assert isinstance(dumped["per_trade"]["rows"][0]["values"]["2"]["price"], str)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_series(db_session, user_id, base_currency="USD", name="s", tz="America/New_York"):
    from app.models.series import Series

    s = Series(
        user_id=user_id,
        name=name,
        tag="real",
        notes=None,
        base_currency=base_currency,
        session_tz=tz,
    )
    db_session.add(s)
    db_session.flush()
    return s


def _add_strategy(db_session, series, name):
    from app.models.strategy import Strategy

    st = Strategy(series_id=series.id, name=name, name_key=name.strip().lower())
    db_session.add(st)
    db_session.flush()
    return st


def _add_fill(
    db_session,
    series,
    strategy,
    symbol,
    side,
    qty,
    price,
    ts,
    cfid,
    commission="0",
    exchange_fee="0",
    regulatory_fee="0",
    financing_fee="0",
):
    from decimal import Decimal

    from app.models.fill import Fill
    from app.models.instrument import Instrument

    # Auto-create instrument so pair_fills() can look it up
    if db_session.query(Instrument).filter_by(series_id=series.id, symbol=symbol).first() is None:
        db_session.add(
            Instrument(
                series_id=series.id, symbol=symbol,
                asset_class="crypto", currency="USD",
                multiplier=Decimal("1"), inferred=True,
            )
        )
        db_session.flush()

    f = Fill(
        series_id=series.id,
        strategy_id=strategy.id,
        symbol=symbol,
        side=side,
        qty=Decimal(str(qty)),
        price=Decimal(str(price)),
        ts=ts,
        client_fill_id=cfid,
        commission=Decimal(commission),
        exchange_fee=Decimal(exchange_fee),
        regulatory_fee=Decimal(regulatory_fee),
        financing_fee=Decimal(financing_fee),
        created_at=datetime(2026, 6, 19, tzinfo=UTC),
        updated_at=datetime(2026, 6, 19, tzinfo=UTC),
    )
    db_session.add(f)
    db_session.flush()
    return f


# ---------------------------------------------------------------------------
# Task 2: Ownership validation
# ---------------------------------------------------------------------------


def test_load_owned_series_preserves_input_order(db_session, user):
    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    loaded = _load_owned_series(db_session, user_id=user.id, series_ids=[b.id, a.id])
    assert [s.id for s in loaded] == [b.id, a.id]


def test_compare_rejects_unowned_series_with_notfound(db_session, user):
    other = _make_other_user(db_session)
    mine = _make_series(db_session, user_id=user.id, name="mine")
    theirs = _make_series(db_session, user_id=other.id, name="theirs")
    with pytest.raises(NotFoundError):
        compare(db_session, user_id=user.id, series_ids=[mine.id, theirs.id])


def test_compare_rejects_missing_series_with_notfound(db_session, user):
    mine = _make_series(db_session, user_id=user.id, name="mine")
    with pytest.raises(NotFoundError):
        compare(db_session, user_id=user.id, series_ids=[mine.id, 999_999])


# ---------------------------------------------------------------------------
# Task 3: Currency guard
# ---------------------------------------------------------------------------


def test_partition_by_currency_splits_on_base_currency(db_session, user):
    usd1 = _make_series(db_session, user_id=user.id, base_currency="USD", name="usd1")
    usd2 = _make_series(db_session, user_id=user.id, base_currency="USD", name="usd2")
    eur = _make_series(db_session, user_id=user.id, base_currency="EUR", name="eur")
    cohort, mismatched = _partition_by_currency([usd1, usd2, eur], baseline=usd1)
    assert {s.id for s in cohort} == {usd1.id, usd2.id}
    assert mismatched == [eur.id]


def test_compare_meta_flags_currency_mismatch(db_session, user):
    usd = _make_series(db_session, user_id=user.id, base_currency="USD", name="usd")
    eur = _make_series(db_session, user_id=user.id, base_currency="EUR", name="eur")
    out = compare(db_session, user_id=user.id, series_ids=[usd.id, eur.id])
    assert out.meta.base_currency == "USD"
    assert out.meta.currency_mismatch_series == [eur.id]


# ---------------------------------------------------------------------------
# Task 4: Baseline resolution
# ---------------------------------------------------------------------------


def test_resolve_baseline_defaults_to_first_picked(db_session, user):
    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    baseline = _resolve_baseline([b, a], baseline_series_id=None)
    assert baseline.id == b.id


def test_resolve_baseline_honours_explicit_choice(db_session, user):
    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    c = _make_series(db_session, user_id=user.id, name="c")
    baseline = _resolve_baseline([a, b, c], baseline_series_id=b.id)
    assert baseline.id == b.id


def test_resolve_baseline_rejects_baseline_not_in_set(db_session, user):
    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    with pytest.raises(NotFoundError):
        _resolve_baseline([a, b], baseline_series_id=999_999)


def test_compare_baseline_id_reflected_in_meta(db_session, user):
    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    out = compare(db_session, user_id=user.id, series_ids=[a.id, b.id], baseline_series_id=b.id)
    assert out.meta.baseline_series_id == b.id


# ---------------------------------------------------------------------------
# Task 5: Account block
# ---------------------------------------------------------------------------


def test_account_block_has_one_entry_per_series(db_session, user):
    from datetime import datetime

    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    sa = _add_strategy(db_session, a, "momo")
    sb = _add_strategy(db_session, b, "momo")
    t = datetime(2026, 6, 19, 13, 30, tzinfo=UTC)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=UTC)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, t, "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, t, "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 105, t2, "b2")
    block = _account_block(db_session, [a, b], None, None, "lot")
    assert [e.series_id for e in block.series] == [a.id, b.id]
    assert "net_pnl" in block.series[0].metrics
    assert "units" in block.series[0].metrics


def test_compare_populates_account_block_including_mismatch(db_session, user):
    from datetime import datetime

    usd = _make_series(db_session, user_id=user.id, base_currency="USD", name="usd")
    eur = _make_series(db_session, user_id=user.id, base_currency="EUR", name="eur")
    su = _add_strategy(db_session, usd, "momo")
    se = _add_strategy(db_session, eur, "momo")
    t = datetime(2026, 6, 19, 13, 30, tzinfo=UTC)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=UTC)
    _add_fill(db_session, usd, su, "ETH", "buy", 1, 100, t, "u1")
    _add_fill(db_session, usd, su, "ETH", "sell", 1, 110, t2, "u2")
    _add_fill(db_session, eur, se, "ETH", "buy", 1, 100, t, "e1")
    _add_fill(db_session, eur, se, "ETH", "sell", 1, 110, t2, "e2")
    out = compare(db_session, user_id=user.id, series_ids=[usd.id, eur.id])
    assert {e.series_id for e in out.account.series} == {usd.id, eur.id}
    assert out.meta.currency_mismatch_series == [eur.id]


# ---------------------------------------------------------------------------
# Task 6: Strategy block
# ---------------------------------------------------------------------------


def test_strategy_block_matches_shared_name_key(db_session, user):
    from datetime import datetime

    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    sa = _add_strategy(db_session, a, "momo-eth")
    sb = _add_strategy(db_session, b, "MOMO_ETH")
    sb.name_key = "momo-eth"
    db_session.flush()
    t = datetime(2026, 6, 19, 13, 30, tzinfo=UTC)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=UTC)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, t, "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, t, "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 105, t2, "b2")
    block = _strategy_block(db_session, [a, b], None, None, "lot")
    assert "momo-eth" in block
    assert block["momo-eth"].matched is True
    assert {e["series_id"] for e in block["momo-eth"].series} == {a.id, b.id}


def test_strategy_block_unmatched_is_side_by_side(db_session, user):
    from datetime import datetime

    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    sa = _add_strategy(db_session, a, "only-in-a")
    sb = _add_strategy(db_session, b, "only-in-b")
    t = datetime(2026, 6, 19, 13, 30, tzinfo=UTC)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=UTC)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, t, "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, t, "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 105, t2, "b2")
    block = _strategy_block(db_session, [a, b], None, None, "lot")
    assert block["only-in-a"].matched is False
    assert block["only-in-b"].matched is False
    assert {e["series_id"] for e in block["only-in-a"].series} == {a.id}


# ---------------------------------------------------------------------------
# Task 7: Symbol block
# ---------------------------------------------------------------------------


def test_symbol_block_matches_symbol_within_matched_strategy(db_session, user):
    from datetime import datetime

    a = _make_series(db_session, user_id=user.id, name="a")
    b = _make_series(db_session, user_id=user.id, name="b")
    sa = _add_strategy(db_session, a, "momo")
    sb = _add_strategy(db_session, b, "momo")
    t = datetime(2026, 6, 19, 13, 30, tzinfo=UTC)
    t2 = datetime(2026, 6, 19, 14, 30, tzinfo=UTC)
    _add_fill(db_session, a, sa, "ETH", "buy", 1, 100, t, "a1")
    _add_fill(db_session, a, sa, "ETH", "sell", 1, 110, t2, "a2")
    _add_fill(db_session, b, sb, "ETH", "buy", 1, 100, t, "b1")
    _add_fill(db_session, b, sb, "ETH", "sell", 1, 105, t2, "b2")
    _add_fill(db_session, a, sa, "BTC", "buy", 1, 100, t, "a3")
    _add_fill(db_session, a, sa, "BTC", "sell", 1, 120, t2, "a4")
    block = _symbol_block(
        db_session,
        [a, b],
        matched_keys={"momo"},
        date_from=None,
        date_to=None,
        trade_view="lot",
    )
    assert "momo/ETH" in block
    assert "momo/BTC" not in block
    assert {e["series_id"] for e in block["momo/ETH"].series} == {a.id, b.id}
