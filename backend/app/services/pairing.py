from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass
class RoundTrip:
    strategy_id: int
    symbol: str
    open_ts: datetime
    close_ts: datetime
    qty: Decimal  # closed qty of this lot↔close portion
    direction: str  # "long" | "short"
    multiplier: Decimal  # instrument contract/point value
    currency: str  # instrument currency (pre-conversion)
    entry_price: Decimal
    exit_price: Decimal
    gross_pnl: Decimal  # instrument ccy: (exit-entry)*qty*multiplier, sign-adjusted
    entry_fees: Decimal  # entry fill fees pro-rata by closed qty
    exit_fees: Decimal  # exit fill fees pro-rata by closed qty
    total_fees: Decimal  # entry_fees + exit_fees
    net_pnl: Decimal  # gross_pnl - total_fees (instrument ccy)
    fx_missing: bool  # always False from pairing; Phase 4 sets True when to_base fails


@dataclass
class _Lot:
    qty: Decimal  # signed: +long / -short
    original: Decimal  # signed original qty (for fee pro-rata)
    price: Decimal
    ts: datetime
    fee: Decimal  # total entry fee of the opening fill


def _total_fee(f):
    return f.commission + f.exchange_fee + f.regulatory_fee + f.financing_fee


def _signed(f):
    return f.qty if f.side == "buy" else -f.qty


def _batch(fills, instruments):
    live = [f for f in fills if f.voided_at is None]
    groups = defaultdict(list)
    for f in live:
        groups[(f.strategy_id, f.symbol)].append(f)

    round_trips = []
    open_fee_total = Decimal("0")

    for (strat_id, symbol), gfills in groups.items():
        gfills.sort(key=lambda f: (f.ts, f.client_fill_id))
        lots: deque[_Lot] = deque()
        net = Decimal("0")
        ins = instruments[symbol]
        mult = ins.multiplier
        ccy = ins.currency

        for f in gfills:
            s = _signed(f)
            if net == 0 or (net > 0) == (s > 0):
                lots.append(_Lot(qty=s, original=s, price=f.price, ts=f.ts, fee=_total_fee(f)))
                net += s
                continue
            # opposite sign -> close FIFO
            close_remaining = abs(s)
            exit_fee_total = _total_fee(f)
            exit_qty_total = f.qty
            while close_remaining > 0 and lots:
                lot = lots[0]
                lot_remaining = abs(lot.qty)
                closed = min(close_remaining, lot_remaining)
                direction = "long" if lot.qty > 0 else "short"
                if direction == "long":
                    gross = (f.price - lot.price) * closed * mult
                else:
                    gross = (lot.price - f.price) * closed * mult
                entry_fee = lot.fee * (closed / abs(lot.original))
                exit_fee = exit_fee_total * (closed / exit_qty_total)
                total_fee = entry_fee + exit_fee
                round_trips.append(
                    RoundTrip(
                        strategy_id=strat_id,
                        symbol=symbol,
                        open_ts=lot.ts,
                        close_ts=f.ts,
                        qty=closed,
                        direction=direction,
                        multiplier=mult,
                        currency=ccy,
                        entry_price=lot.price,
                        exit_price=f.price,
                        gross_pnl=gross,
                        entry_fees=entry_fee,
                        exit_fees=exit_fee,
                        total_fees=total_fee,
                        net_pnl=gross - total_fee,
                        fx_missing=False,
                    )
                )
                if lot.qty > 0:
                    lot.qty -= closed
                else:
                    lot.qty += closed
                if lot.qty == 0:
                    lots.popleft()
                close_remaining -= closed
                net += closed if s > 0 else -closed
            # leftover close qty flips into a new opposite-direction lot
            if close_remaining > 0:
                signed_left = close_remaining if s > 0 else -close_remaining
                lots.append(
                    _Lot(
                        qty=signed_left,
                        original=signed_left,
                        price=f.price,
                        ts=f.ts,
                        fee=Decimal("0"),
                    )
                )
                net += signed_left

        # fees on still-open lots, pro-rata by remaining qty
        for lot in lots:
            open_fee_total += lot.fee * (abs(lot.qty) / abs(lot.original))

    return round_trips, open_fee_total


def pair_fills(fills, instruments):
    rts, _ = _batch(fills, instruments)
    return rts


def fees_on_open_positions(fills, instruments):
    _, fee = _batch(fills, instruments)
    return fee


def to_positions(round_trips):
    # group flat-to-flat lots into per-position trades (Task 9)
    return round_trips
