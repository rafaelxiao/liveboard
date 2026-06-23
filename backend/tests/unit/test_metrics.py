"""Unit tests for metrics.py — trade stats, symbols, flags, envelope."""

from datetime import datetime
from decimal import Decimal

from app.services import metrics


def _rt(close_iso, net, open_iso=None):
    """Minimal RoundTrip-like object for testing trade_stats."""
    net_dec = Decimal(net)
    open_ts = (
        datetime.fromisoformat(open_iso)
        if open_iso
        else datetime.fromisoformat(close_iso.replace("T15:", "T13:"))
    )
    close_ts = datetime.fromisoformat(close_iso)

    class RT:
        pass

    obj = RT()
    obj.gross_pnl = net_dec
    obj.net_pnl = net_dec
    obj.total_fees = Decimal("0")
    obj.multiplier = Decimal("1")
    obj.currency = "USD"
    obj.open_ts = open_ts
    obj.close_ts = close_ts
    obj.fx_missing = False
    obj.strategy_id = 1
    obj.symbol = "AAPL"
    obj.direction = "long"
    obj.entry_price = Decimal("100")
    obj.exit_price = Decimal("101")
    obj.entry_fees = Decimal("0")
    obj.exit_fees = Decimal("0")
    return obj


# ---------------------------------------------------------------------------
# Task 10 — trade_stats
# ---------------------------------------------------------------------------


def test_trade_stats_three_known_round_trips():
    rts = [
        _rt("2026-06-18T15:00:00+00:00", "100", open_iso="2026-06-18T13:00:00+00:00"),
        _rt("2026-06-19T15:00:00+00:00", "50", open_iso="2026-06-19T14:00:00+00:00"),
        _rt("2026-06-20T15:00:00+00:00", "-30", open_iso="2026-06-20T12:00:00+00:00"),
    ]
    s = metrics.trade_stats(rts)
    assert s["trade_count"] == 3
    assert s["net_pnl"] == Decimal("120")
    assert s["win_rate"] == Decimal("0.666666666667")
    assert s["avg_win"] == Decimal("75")
    assert s["avg_loss"] == Decimal("-30")
    assert s["profit_factor"] == Decimal("5")
    assert s["payoff_ratio"] == Decimal("2.5")
    # expectancy is a weighted average; quantize matches _RATIO_Q precision
    assert s["expectancy"] == Decimal("40.000000000025")
    assert s["avg_holding_secs"] == 7200


def test_trade_stats_profit_factor_none_without_losses():
    rts = [
        _rt("2026-06-18T15:00:00+00:00", "100"),
        _rt("2026-06-19T15:00:00+00:00", "50"),
    ]
    s = metrics.trade_stats(rts)
    assert s["profit_factor"] is None
    assert s["payoff_ratio"] is None


def test_trade_stats_empty():
    s = metrics.trade_stats([])
    assert s["trade_count"] == 0
    assert s["win_rate"] == Decimal("0")
    assert s["net_pnl"] == Decimal("0")


# ---------------------------------------------------------------------------
# Task 12 — consec + largest
# ---------------------------------------------------------------------------


def test_consecutive_and_largest():
    rts = [
        _rt("2026-06-18T10:00:00+00:00", "10"),
        _rt("2026-06-18T11:00:00+00:00", "20"),
        _rt("2026-06-18T12:00:00+00:00", "-5"),
        _rt("2026-06-18T13:00:00+00:00", "-3"),
        _rt("2026-06-18T14:00:00+00:00", "-1"),
        _rt("2026-06-18T15:00:00+00:00", "40"),
    ]
    s = metrics.trade_stats(rts)
    assert s["max_consec_wins"] == 2
    assert s["max_consec_losses"] == 3
    assert s["largest_win"] == Decimal("40")
    assert s["largest_loss"] == Decimal("-5")


def test_consecutive_flat_resets_streaks():
    rts = [
        _rt("2026-06-18T10:00:00+00:00", "10"),
        _rt("2026-06-18T11:00:00+00:00", "0"),
        _rt("2026-06-18T12:00:00+00:00", "10"),
    ]
    s = metrics.trade_stats(rts)
    assert s["max_consec_wins"] == 1


# ---------------------------------------------------------------------------
# Task 13 — symbol contribution
# ---------------------------------------------------------------------------


def test_symbol_contribution_ratio():
    assert metrics.symbol_contribution(Decimal("30"), Decimal("120")) == Decimal("0.250000000000")


def test_symbol_contribution_none_when_strategy_flat():
    assert metrics.symbol_contribution(Decimal("30"), Decimal("0")) is None


# ---------------------------------------------------------------------------
# Task 14 — flags + suppression
# ---------------------------------------------------------------------------


def test_flags_low_sample_at_thresholds():
    f = metrics.build_flags(
        round_trip_count=19, active_days=40, fx_missing=False, open_positions_exist=False
    )
    assert f["low_sample"] is True
    assert f["sharpe_suppressed"] is False
    assert f["realized_only"] is True

    f2 = metrics.build_flags(
        round_trip_count=20, active_days=30, fx_missing=False, open_positions_exist=False
    )
    assert f2["low_sample"] is False

    f3 = metrics.build_flags(
        round_trip_count=25, active_days=29, fx_missing=False, open_positions_exist=False
    )
    assert f3["low_sample"] is True


def test_flags_suppression_below_five():
    f = metrics.build_flags(
        round_trip_count=4, active_days=10, fx_missing=True, open_positions_exist=True
    )
    assert f["sharpe_suppressed"] is True
    assert f["fx_missing"] is True
    assert f["open_positions_exist"] is True


def test_apply_suppression_nulls_value():
    assert metrics.apply_suppression(1.23, True) is None
    assert metrics.apply_suppression(1.23, False) == 1.23
