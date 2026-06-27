from decimal import Decimal

from app.models.strategy import Strategy
from app.services import pairing

from tests.unit.conftest import make_fill, make_instrument, utc

# ---------------------------------------------------------------------------
# Task 2 — D1: long full pair
# ---------------------------------------------------------------------------


def test_d1_long_full_pair(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="100",
            price="10",
            at=utc(2026, 6, 19, 14, 0),
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="sell",
            qty="100",
            price="12",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert len(rts) == 1
    rt = rts[0]
    assert rt.direction == "long"
    assert rt.qty == Decimal("100")
    assert rt.entry_price == Decimal("10")
    assert rt.exit_price == Decimal("12")
    assert rt.gross_pnl == Decimal("200")  # (12-10)*100*1 in instrument ccy
    assert rt.total_fees == Decimal("0")
    assert rt.net_pnl == Decimal("200")
    assert rt.open_ts == utc(2026, 6, 19, 14, 0)
    assert rt.close_ts == utc(2026, 6, 19, 15, 0)
    assert rt.fx_missing is False
    assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")


# ---------------------------------------------------------------------------
# Task 3 — D2: short full pair
# ---------------------------------------------------------------------------


def test_d2_short_full_pair(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="sell",
            qty="50",
            price="20",
            at=utc(2026, 6, 19, 14, 0),
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="buy",
            qty="50",
            price="18",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert len(rts) == 1
    rt = rts[0]
    assert rt.direction == "short"
    assert rt.qty == Decimal("50")
    assert rt.entry_price == Decimal("20")
    assert rt.exit_price == Decimal("18")
    assert rt.gross_pnl == Decimal("100")  # (20-18)*50*1, short sign-adjusted
    assert rt.net_pnl == Decimal("100")
    assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")


# ---------------------------------------------------------------------------
# Task 4 — D3: one close many opens + D8: ts/client_fill_id tiebreak
# ---------------------------------------------------------------------------


def test_d3_one_close_many_opens_fifo(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="100",
            price="10",
            at=utc(2026, 6, 19, 14, 0),
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o2",
            side="buy",
            qty="100",
            price="11",
            at=utc(2026, 6, 19, 14, 30),
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="sell",
            qty="150",
            price="12",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert len(rts) == 2
    assert rts[0].qty == Decimal("100")  # first lot 100@10 closed in full
    assert rts[0].entry_price == Decimal("10")
    assert rts[0].gross_pnl == Decimal("200")  # (12-10)*100
    assert rts[1].qty == Decimal("50")  # then 50 of the 100@11 lot
    assert rts[1].entry_price == Decimal("11")
    assert rts[1].gross_pnl == Decimal("50")  # (12-11)*50
    assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")


def test_d8_same_ts_tiebreak_by_client_fill_id(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    t = utc(2026, 6, 19, 14, 0)
    fills = [  # insert higher-id lot FIRST: ordering must be by client_fill_id
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="bbb",
            side="buy",
            qty="10",
            price="11",
            at=t,
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="aaa",
            side="buy",
            qty="10",
            price="10",
            at=t,
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="ccc",
            side="sell",
            qty="10",
            price="12",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert len(rts) == 1
    assert rts[0].entry_price == Decimal("10")  # "aaa" sorts first at equal ts
    assert rts[0].gross_pnl == Decimal("20")  # (12-10)*10


# ---------------------------------------------------------------------------
# Task 5 — D4: many closes one open + D6: isolation + D7: open-only
# ---------------------------------------------------------------------------


def test_d4_many_closes_one_open(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="100",
            price="10",
            at=utc(2026, 6, 19, 14, 0),
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="sell",
            qty="40",
            price="12",
            at=utc(2026, 6, 19, 15, 0),
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c2",
            side="sell",
            qty="60",
            price="13",
            at=utc(2026, 6, 19, 16, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert len(rts) == 2
    assert rts[0].qty == Decimal("40")
    assert rts[0].gross_pnl == Decimal("80")  # (12-10)*40
    assert rts[1].qty == Decimal("60")
    assert rts[1].gross_pnl == Decimal("180")  # (13-10)*60
    assert pairing.fees_on_open_positions(fills, instruments) == Decimal("0")


def test_d6_strategy_symbol_isolation(db, series, strategy):
    other = Strategy(series_id=series.id, name="beta", name_key="beta")
    db.add(other)
    db.flush()
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="a1",
            side="buy",
            qty="100",
            price="10",
            at=utc(2026, 6, 19, 14, 0),
        ),
        make_fill(
            db,
            series,
            other,
            client_fill_id="b1",
            side="sell",
            qty="100",
            price="12",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert rts == []  # alpha open-long, beta open-short; nothing closes


def test_d7_open_only_no_round_trip_fees_reconciled(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="100",
            price="10",
            at=utc(2026, 6, 19, 14, 0),
            commission="7",
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert rts == []
    assert pairing.fees_on_open_positions(fills, instruments) == Decimal("7")


# ---------------------------------------------------------------------------
# Task 6 — M2-1: multiplier scaling (futures ×50, options ×100)
# ---------------------------------------------------------------------------


def test_m2_futures_multiplier_50(db, series, strategy):
    ins = make_instrument(
        db,
        series,
        symbol="ES",
        asset_class="future",
        multiplier="50",
    )
    instruments = {"ES": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="2",
            price="4000",
            symbol="ES",
            at=utc(2026, 6, 19, 14, 0),
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="sell",
            qty="2",
            price="4012",
            symbol="ES",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert rts[0].multiplier == Decimal("50")
    assert rts[0].gross_pnl == Decimal("1200")  # (4012-4000)*2*50


def test_m2_options_multiplier_100(db, series, strategy):
    ins = make_instrument(
        db,
        series,
        symbol="AAPL240621C",
        asset_class="option",
        multiplier="100",
    )
    instruments = {"AAPL240621C": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="1",
            price="5.00",
            symbol="AAPL240621C",
            at=utc(2026, 6, 19, 14, 0),
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="sell",
            qty="1",
            price="5.50",
            symbol="AAPL240621C",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert rts[0].gross_pnl == Decimal("50.00")  # (5.50-5.00)*1*100


# ---------------------------------------------------------------------------
# Task 7 — D5: fee pro-rata split + FEE tests
# ---------------------------------------------------------------------------


def test_d5_fee_pro_rata_on_partial_close(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="100",
            price="10",
            at=utc(2026, 6, 19, 14, 0),
            commission="10",
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="sell",
            qty="40",
            price="12",
            at=utc(2026, 6, 19, 15, 0),
            commission="5",
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert len(rts) == 1
    rt = rts[0]
    assert rt.entry_fees == Decimal("4.0")  # 10 * (40/100)
    assert rt.exit_fees == Decimal("5.0")  # full exit fee
    assert rt.total_fees == Decimal("9.0")


def test_fee_negative_rebate_sums_correctly(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="100",
            price="10",
            at=utc(2026, 6, 19, 14, 0),
            commission="-2",
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="sell",
            qty="100",
            price="12",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert rts[0].entry_fees == Decimal("-2.0")
    assert rts[0].total_fees == Decimal("-2.0")
    assert rts[0].net_pnl == Decimal("202.0")  # 200 + 2 rebate


def test_fees_on_open_correct_after_partial_close(db, series, strategy):
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="o1",
            side="buy",
            qty="100",
            price="10",
            at=utc(2026, 6, 19, 14, 0),
            commission="20",
        ),
        make_fill(
            db,
            series,
            strategy,
            client_fill_id="c1",
            side="sell",
            qty="30",
            price="12",
            at=utc(2026, 6, 19, 15, 0),
        ),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert rts[0].entry_fees == Decimal("6.0")  # 20 * 30/100
    # remaining 70 lots still open → 20 * 70/100 = 14
    assert pairing.fees_on_open_positions(fills, instruments) == Decimal("14.0")


def test_fee_pro_rata_two_partial_closes_no_drift(db, series, strategy):
    """Bug 1b: two partial closes of one open lot — each should get pro-rata fee of the ORIGINAL qty."""
    ins = make_instrument(db, series, symbol="AAPL", multiplier="1")
    instruments = {"AAPL": ins}
    fills = [
        make_fill(db, series, strategy, client_fill_id="o1", side="buy", qty="100", price="10",
                  at=utc(2026, 6, 19, 14, 0), commission="50"),
        make_fill(db, series, strategy, client_fill_id="c1", side="sell", qty="30", price="12",
                  at=utc(2026, 6, 19, 15, 0)),
        make_fill(db, series, strategy, client_fill_id="c2", side="sell", qty="20", price="13",
                  at=utc(2026, 6, 19, 16, 0)),
    ]
    rts = pairing.pair_fills(fills, instruments)
    assert len(rts) == 2
    # First close: 30/100 of the 50 entry fee = 15
    assert rts[0].entry_fees == Decimal("15.0")
    # Second close: 20/100 of the 50 entry fee = 10  (NOT 20/70 of the remaining fee!)
    assert rts[1].entry_fees == Decimal("10.0")
    # Remaining 50 open: 50 * 50/100 = 25
    assert pairing.fees_on_open_positions(fills, instruments) == Decimal("25.0")
