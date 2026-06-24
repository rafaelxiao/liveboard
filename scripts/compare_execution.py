"""Compare execution prices between two series (e.g. live vs sim).

Groups fills by (strategy, symbol, side, date), computes VWAP for each group,
then shows the price difference in basis points.

Usage:
  cd backend && uv run python ../scripts/compare_execution.py
"""

from collections import defaultdict
from decimal import Decimal

from app.db import SessionLocal
from app.models.fill import Fill
from app.models.strategy import Strategy


def daily_vwap(fills, strats):
    """Group fills by (strategy_key, symbol, side, date) and compute VWAP."""
    groups: dict[tuple, dict] = defaultdict(
        lambda: {"qty": Decimal("0"), "notional": Decimal("0")}
    )
    for f in fills:
        sk = strats.get(f.strategy_id, f"sid_{f.strategy_id}")
        d = f.ts.date().isoformat()
        key = (sk, f.symbol, f.side, d)
        qty = abs(f.qty)
        groups[key]["qty"] += qty
        groups[key]["notional"] += f.price * qty
    return groups


def main():
    session = SessionLocal()
    strats = {s.id: s.name_key for s in session.query(Strategy).all()}

    # Load both series
    fills_a = (
        session.query(Fill)
        .filter(Fill.series_id == 3, Fill.voided_at.is_(None))
        .all()
    )
    fills_b = (
        session.query(Fill)
        .filter(Fill.series_id == 4, Fill.voided_at.is_(None))
        .all()
    )

    da = daily_vwap(fills_a, strats)
    db = daily_vwap(fills_b, strats)

    common = set(da.keys()) & set(db.keys())
    # Filter for vwap strategies
    vwap_keys = sorted(
        [k for k in common if "vwap" in k[0]],
        key=lambda k: (k[0], k[1], k[3], k[2]),
    )

    if not vwap_keys:
        print("No overlapping (strategy, symbol, side, date) groups found.")
        # Show sample keys from each to help debug
        print("\nSample apex groups:")
        for k in sorted(da.keys(), key=lambda x: (x[0], x[1], x[3]))[:5]:
            print(f"  {k}")
        print("\nSample apex_sim groups:")
        for k in sorted(db.keys(), key=lambda x: (x[0], x[1], x[3]))[:5]:
            print(f"  {k}")
        session.close()
        return

    print(
        f"{'strategy':22} {'sym':10} {'date':12} {'side':5} "
        f"{'live qty':>10} {'sim qty':>10} {'live VWAP':>10} {'sim VWAP':>10} {'Δ bps':>8}"
    )
    print("-" * 100)

    total_diff_sum = Decimal("0")
    total_qty = Decimal("0")

    for k in vwap_keys:
        sk, sym, side, d = k
        va = da[k]
        vb = db[k]

        vwap_a = va["notional"] / va["qty"]
        vwap_b = vb["notional"] / vb["qty"]

        if vwap_a == 0:
            continue

        diff_bps = (vwap_b - vwap_a) / vwap_a * 10_000
        min_qty = min(va["qty"], vb["qty"])
        total_diff_sum += diff_bps * min_qty
        total_qty += min_qty

        print(
            f"{sk:22} {sym:10} {d:12} {side:5} "
            f"{int(va['qty']):>10} {int(vb['qty']):>10} "
            f"{float(vwap_a):>10.4f} {float(vwap_b):>10.4f} {float(diff_bps):>+8.1f}"
        )

    if total_qty:
        wavg = total_diff_sum / total_qty
        print(f"\nWeighted avg Δ: {float(wavg):+.1f} bps ({len(vwap_keys)} daily groups)")
        print("Positive = sim worse (higher buy / lower sell)")

    session.close()


if __name__ == "__main__":
    main()
