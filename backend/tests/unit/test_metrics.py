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


# ---------------------------------------------------------------------------
# symbol_contribution — signed contribution using abs(denominator)
# ---------------------------------------------------------------------------


def test_symbol_contribution_negative_strategy():
    """Losing symbol in losing strategy → negative contribution."""
    assert metrics.symbol_contribution(Decimal("-1000"), Decimal("-5000")) == Decimal("-0.200000000000")


def test_symbol_contribution_winning_symbol_in_losing_strategy():
    """Winning symbol in losing strategy → positive (it offset losses)."""
    assert metrics.symbol_contribution(Decimal("1000"), Decimal("-5000")) == Decimal("0.200000000000")


def test_symbol_contribution_winning_strategy():
    """Both winning → positive."""
    assert metrics.symbol_contribution(Decimal("3000"), Decimal("10000")) == Decimal("0.300000000000")


def test_symbol_contribution_losing_symbol_in_winning_strategy():
    """Losing symbol in winning strategy → negative."""
    assert metrics.symbol_contribution(Decimal("-2000"), Decimal("10000")) == Decimal("-0.200000000000")


# ---------------------------------------------------------------------------
# drawdown_series — with and without capital_base
# ---------------------------------------------------------------------------


def test_drawdown_series_with_capital_base():
    """Drawdown pct uses (peak + capital_base) as denominator."""
    from datetime import datetime, timezone
    # Simulate: start 625K, make +5K, then lose -10K
    # Peak PnL = 5K, trough PnL = -5K, drawdown = -10K from peak
    # Denominator = 5K + 625K = 630K
    # pct = -10K / 630K ≈ -1.59%
    curve = [
        (datetime(2024, 1, 1, tzinfo=timezone.utc), Decimal("0")),
        (datetime(2024, 1, 2, tzinfo=timezone.utc), Decimal("5000")),
        (datetime(2024, 1, 3, tzinfo=timezone.utc), Decimal("-5000")),
    ]
    cap = Decimal("625000")
    dd = metrics.drawdown_series(curve, capital_base=cap)
    assert len(dd) == 3
    # Point 1: at +5K, peak=5K, dd=0, pct=0/(5K+625K)=0
    assert dd[1][2] == Decimal("0")
    # Point 2: at -5K, peak=5K, dd=-10K, pct=-10K/630K
    expected = Decimal("-10000") / (Decimal("5000") + cap)
    assert dd[2][2] == expected


def test_drawdown_series_without_capital_base():
    """Without capital_base, falls back to pct = dd / peak."""
    from datetime import datetime, timezone
    curve = [
        (datetime(2024, 1, 1, tzinfo=timezone.utc), Decimal("0")),
        (datetime(2024, 1, 2, tzinfo=timezone.utc), Decimal("100")),
        (datetime(2024, 1, 3, tzinfo=timezone.utc), Decimal("50")),
    ]
    dd = metrics.drawdown_series(curve)
    # At point 2: peak=100, dd=-50, pct=-50/100=-0.5
    assert dd[2][2] == Decimal("-0.5")


# ---------------------------------------------------------------------------
# _group_rts_by_day
# ---------------------------------------------------------------------------


def test_group_rts_by_day_merges_same_day():
    """Round-trips on the same date are merged into one synthetic RT."""
    tz = "America/New_York"
    rts = [
        _rt("2024-01-02T15:00:00+00:00", "100"),  # Jan 2
        _rt("2024-01-02T16:00:00+00:00", "-30"),  # Jan 2
        _rt("2024-01-03T15:00:00+00:00", "50"),   # Jan 3
    ]
    grouped = metrics._group_rts_by_day(rts, tz)
    assert len(grouped) == 2
    # Jan 2: net = 100 - 30 = 70
    assert grouped[0].net_pnl == Decimal("70")
    # Jan 3: net = 50
    assert grouped[1].net_pnl == Decimal("50")


def test_group_rts_by_day_single():
    """Single round-trip per day → same count."""
    tz = "America/New_York"
    rts = [
        _rt("2024-01-02T15:00:00+00:00", "100"),
        _rt("2024-01-03T15:00:00+00:00", "50"),
    ]
    grouped = metrics._group_rts_by_day(rts, tz)
    assert len(grouped) == 2
