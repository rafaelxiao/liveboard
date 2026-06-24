"""Day-by-day PnL comparison for a specific strategy between live and sim."""

from collections import defaultdict
from decimal import Decimal

from app.db import SessionLocal
from app.models.fill import Fill
from app.models.instrument import Instrument
from app.models.strategy import Strategy
from app.services.pairing import pair_fills


def daily_pnl(fills, instruments):
    """Pair fills and sum net PnL by date."""
    if not fills:
        return {}
    rts = pair_fills(fills, instruments)
    by_day: dict[str, Decimal] = defaultdict(Decimal)
    for rt in rts:
        d = rt.close_ts.date().isoformat()
        by_day[d] += rt.net_pnl
    return dict(by_day)


def main():
    session = SessionLocal()

    # Find strategy ID for vwap_intra_day_2 in both series
    strats = {
        (s.series_id, s.name_key): s.id
        for s in session.query(Strategy).all()
    }

    strat_live_id = strats.get((3, "vwap_intra_day_2"))
    strat_sim_id = strats.get((4, "vwap_intra_day_2"))

    if not strat_live_id or not strat_sim_id:
        print("Could not find vwap_intra_day_2 in both series")
        session.close()
        return

    # Load fills
    fills_live = (
        session.query(Fill)
        .filter(
            Fill.series_id == 3,
            Fill.strategy_id == strat_live_id,
            Fill.voided_at.is_(None),
        )
        .all()
    )
    fills_sim = (
        session.query(Fill)
        .filter(
            Fill.series_id == 4,
            Fill.strategy_id == strat_sim_id,
            Fill.voided_at.is_(None),
        )
        .all()
    )

    inst_live = {
        i.symbol: i
        for i in session.query(Instrument).filter(Instrument.series_id == 3).all()
    }
    inst_sim = {
        i.symbol: i
        for i in session.query(Instrument).filter(Instrument.series_id == 4).all()
    }

    pnl_live = daily_pnl(fills_live, inst_live)
    pnl_sim = daily_pnl(fills_sim, inst_sim)

    # Also count fills per day
    fills_live_day = defaultdict(int)
    for f in fills_live:
        fills_live_day[f.ts.date().isoformat()] += 1
    fills_sim_day = defaultdict(int)
    for f in fills_sim:
        fills_sim_day[f.ts.date().isoformat()] += 1

    # Also track per-symbol info
    sym_pnl_live = defaultdict(Decimal)
    sym_pnl_sim = defaultdict(Decimal)
    for rt in pair_fills(fills_live, inst_live):
        sym_pnl_live[rt.symbol] += rt.net_pnl
    for rt in pair_fills(fills_sim, inst_sim):
        sym_pnl_sim[rt.symbol] += rt.net_pnl

    all_dates = sorted(set(list(pnl_live.keys()) + list(pnl_sim.keys())))

    total_live = Decimal("0")
    total_sim = Decimal("0")

    print(f"{'Date':12} {'Live PnL':>12} {'Sim PnL':>12} {'Δ PnL':>12} {'Live fills':>11} {'Sim fills':>10}")
    print("-" * 72)

    for d in all_dates:
        lp = pnl_live.get(d, Decimal("0"))
        sp = pnl_sim.get(d, Decimal("0"))
        diff = lp - sp
        total_live += lp
        total_sim += sp

        lf = fills_live_day.get(d, 0)
        sf = fills_sim_day.get(d, 0)

        marker = ""
        if abs(float(diff)) > 200:
            marker = " ⚠"
        elif abs(float(diff)) > 50:
            marker = " ·"

        print(
            f"{d:12} {float(lp):>12.2f} {float(sp):>12.2f} "
            f"{float(diff):>12.2f}{marker} {lf:>11} {sf:>10}"
        )

    print("-" * 72)
    print(
        f"{'TOTAL':12} {float(total_live):>12.2f} {float(total_sim):>12.2f} "
        f"{float(total_live - total_sim):>12.2f}"
    )

    # Per-symbol breakdown
    print(f"\n--- Per Symbol ---")
    all_syms = sorted(set(list(sym_pnl_live.keys()) + list(sym_pnl_sim.keys())))
    for sym in all_syms:
        sl = sym_pnl_live.get(sym, Decimal("0"))
        ss = sym_pnl_sim.get(sym, Decimal("0"))
        print(f"  {sym:12}  live: {float(sl):>12.2f}  sim: {float(ss):>12.2f}  Δ: {float(sl - ss):>12.2f}")

    # By side for biggest diff days
    print(f"\n--- Top 10 Δ days (live - sim) ---")
    diffs = [(d, pnl_live.get(d, Decimal("0")) - pnl_sim.get(d, Decimal("0"))) for d in all_dates]
    diffs.sort(key=lambda x: abs(x[1]), reverse=True)
    for d, diff in diffs[:10]:
        lp = pnl_live.get(d, Decimal("0"))
        sp = pnl_sim.get(d, Decimal("0"))
        # Show which symbol contributed on this day
        rts_live = [rt for rt in pair_fills(fills_live, inst_live) if rt.close_ts.date().isoformat() == d]
        rts_sim = [rt for rt in pair_fills(fills_sim, inst_sim) if rt.close_ts.date().isoformat() == d]
        live_syms = defaultdict(Decimal)
        sim_syms = defaultdict(Decimal)
        for rt in rts_live:
            live_syms[rt.symbol] += rt.net_pnl
        for rt in rts_sim:
            sim_syms[rt.symbol] += rt.net_pnl
        all_s = set(list(live_syms.keys()) + list(sim_syms.keys()))
        sym_detail = ", ".join(
            f"{s}: L={float(live_syms.get(s, 0)):.0f} S={float(sim_syms.get(s, 0)):.0f}"
            for s in sorted(all_s)
        )
        print(f"  {d}: Δ={float(diff):.1f}  live={float(lp):.1f} sim={float(sp):.1f}  [{sym_detail}]")

    session.close()


if __name__ == "__main__":
    main()
