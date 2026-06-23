from datetime import date
from decimal import Decimal

from app.services import capital

from tests.unit.conftest import make_fill, make_fund, make_instrument, utc

# ---------------------------------------------------------------------------
# Task 10 — account_base (E1, E6)
# ---------------------------------------------------------------------------


def test_e1_account_base_is_net_external(db, series, strategy):
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 2),
        amount="60000",
        from_bucket="FREE_CASH",
        to_bucket="STRATEGY",
        to_strategy_id=strategy.id,
    )  # internal -> no effect on account base
    assert capital.account_base(db, series.id, None) == Decimal("100000")


def test_e1_withdrawal_reduces_account_base(db, series):
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 3),
        amount="30000",
        from_bucket="FREE_CASH",
        to_bucket="EXTERNAL",
    )
    assert capital.account_base(db, series.id, None) == Decimal("70000")


def test_e6_trading_pnl_does_not_change_base(db, series, strategy):
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_instrument(db, series, symbol="AAPL", multiplier="1")
    make_fill(
        db,
        series,
        strategy,
        client_fill_id="o1",
        side="buy",
        qty="100",
        price="10",
        at=utc(2026, 6, 2, 14, 0),
    )
    make_fill(
        db,
        series,
        strategy,
        client_fill_id="c1",
        side="sell",
        qty="100",
        price="2000",
        at=utc(2026, 6, 2, 15, 0),
    )  # huge profit
    # base reads FundMovements only -> unchanged
    assert capital.account_base(db, series.id, None) == Decimal("100000")


def test_e1_voided_excluded_and_asof_cutoff(db, series):
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 5),
        amount="50000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
        voided=True,
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 10),
        amount="20000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    # as-of 06-07: only the first (non-voided) deposit counts
    assert capital.account_base(db, series.id, utc(2026, 6, 7)) == Decimal("100000")
    # all time: voided still excluded -> 100k + 20k
    assert capital.account_base(db, series.id, None) == Decimal("120000")


# ---------------------------------------------------------------------------
# Task 11 — strategy_base + free_cash (E2, E3, E4)
# ---------------------------------------------------------------------------


def test_e3_strategy_base_net_inflow(db, series, strategy):
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 2),
        amount="60000",
        from_bucket="FREE_CASH",
        to_bucket="STRATEGY",
        to_strategy_id=strategy.id,
    )
    assert capital.strategy_base(db, series.id, strategy.id, None) == Decimal("60000")


def test_e4_free_cash_net(db, series, strategy):
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 2),
        amount="60000",
        from_bucket="FREE_CASH",
        to_bucket="STRATEGY",
        to_strategy_id=strategy.id,
    )
    assert capital.free_cash(db, series.id, None) == Decimal("40000")


def test_e2_inter_strategy_transfer_net_zero(db, series, strategy):
    from app.models.strategy import Strategy

    strat_b = Strategy(series_id=series.id, name="beta", name_key="beta")
    db.add(strat_b)
    db.flush()
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 2),
        amount="50000",
        from_bucket="FREE_CASH",
        to_bucket="STRATEGY",
        to_strategy_id=strategy.id,
    )  # a = 50k
    make_fund(
        db,
        series,
        at=utc(2026, 6, 3),
        amount="20000",
        from_bucket="STRATEGY",
        to_bucket="STRATEGY",
        from_strategy_id=strategy.id,
        to_strategy_id=strat_b.id,
    )
    # account base unchanged by the internal transfer
    assert capital.account_base(db, series.id, None) == Decimal("100000")
    # a lost 20k, b gained 20k (net zero across the two strategies)
    assert capital.strategy_base(db, series.id, strategy.id, None) == Decimal("30000")
    assert capital.strategy_base(db, series.id, strat_b.id, None) == Decimal("20000")


# ---------------------------------------------------------------------------
# Task 12 — base_series (E5)
# ---------------------------------------------------------------------------


def test_e5_base_series_steps_with_movements(db, series):
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 10),
        amount="50000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    days = [date(2026, 6, 1), date(2026, 6, 5), date(2026, 6, 10)]
    result = capital.base_series(db, series.id, "account", None, days)
    assert result[date(2026, 6, 1)] == Decimal("100000")  # first deposit included
    assert result[date(2026, 6, 5)] == Decimal("100000")  # no change yet
    assert result[date(2026, 6, 10)] == Decimal("150000")  # second deposit included


def test_e5_base_series_strategy_level(db, series, strategy):
    make_fund(
        db,
        series,
        at=utc(2026, 6, 1),
        amount="100000",
        from_bucket="EXTERNAL",
        to_bucket="FREE_CASH",
    )
    make_fund(
        db,
        series,
        at=utc(2026, 6, 3),
        amount="40000",
        from_bucket="FREE_CASH",
        to_bucket="STRATEGY",
        to_strategy_id=strategy.id,
    )
    days = [date(2026, 6, 1), date(2026, 6, 3)]
    result = capital.base_series(db, series.id, "strategy", strategy.id, days)
    assert result[date(2026, 6, 1)] == Decimal("0")  # not yet allocated
    assert result[date(2026, 6, 3)] == Decimal("40000")
