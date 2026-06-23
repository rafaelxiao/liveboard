"""Multi-series comparison engine — stateless, idempotent.

Ownership guard, currency guard, baseline resolution, per-trade deterministic matcher.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.models.fill import Fill
from app.models.series import Series
from app.models.strategy import Strategy
from app.schemas.comparison import (
    AccountBlock,
    AccountSeriesEntry,
    ComparisonMeta,
    ComparisonOut,
    PerTradeBlock,
    PerTradeDiff,
    PerTradeRow,
    PerTradeValue,
    SeriesEquityCurve,
    StrategyBlock,
    SymbolBlock,
    UnmatchedFill,
)
from app.services.metrics import compute_metrics, drawdown_series, _load_fills, realized_equity_curve, indexed_curve
from app.services.pairing import pair_fills
from app.services.capital import account_base

# ---------------------------------------------------------------------------


def _load_owned_series(session: Session, user_id: int, series_ids: list[int]) -> list[Series]:
    rows = (
        session.execute(select(Series).where(Series.user_id == user_id, Series.id.in_(series_ids)))
        .scalars()
        .all()
    )
    by_id = {s.id: s for s in rows}
    missing = [sid for sid in series_ids if sid not in by_id]
    if missing:
        raise NotFoundError(f"series not found: {missing}")
    return [by_id[sid] for sid in series_ids]


# ---------------------------------------------------------------------------


def _partition_by_currency(
    series: list[Series], baseline: Series
) -> tuple[list[Series], list[int]]:
    base_ccy = baseline.base_currency
    cohort: list[Series] = []
    mismatched: list[int] = []
    for s in series:
        if s.base_currency == base_ccy:
            cohort.append(s)
        else:
            mismatched.append(s.id)
    return cohort, mismatched


# ---------------------------------------------------------------------------


def _resolve_baseline(series: list[Series], baseline_series_id: int | None) -> Series:
    if baseline_series_id is None:
        return series[0]
    for s in series:
        if s.id == baseline_series_id:
            return s
    raise NotFoundError(f"baseline_series_id not in series_ids: {baseline_series_id}")


# ---------------------------------------------------------------------------


def _account_block(
    session: Session,
    series: list[Series],
    date_from: datetime | None,
    date_to: datetime | None,
    trade_view: str,
) -> AccountBlock:
    entries: list[AccountSeriesEntry] = []
    for s in series:
        # Convert datetime → date to avoid comparison errors in filter_round_trips
        df = date_from.date() if isinstance(date_from, datetime) else date_from
        dt = date_to.date() if isinstance(date_to, datetime) else date_to
        env = compute_metrics(
            session,
            s.id,
            "account",
            date_from=df,
            date_to=dt,
            trade_view=trade_view,
        )
        entries.append(
            AccountSeriesEntry(
                series_id=s.id,
                meta=env.meta.model_dump(),
                metrics=env.metrics.model_dump(),
            )
        )
    return AccountBlock(series=entries)


# ---------------------------------------------------------------------------


def _strategy_keys_by_series(session: Session, cohort: list[Series]) -> dict[int, set[str]]:
    out: dict[int, set[str]] = {}
    for s in cohort:
        keys = (
            session.execute(select(Strategy.name_key).where(Strategy.series_id == s.id))
            .scalars()
            .all()
        )
        out[s.id] = set(keys)
    return out


def _strategy_block(
    session: Session,
    cohort: list[Series],
    date_from: datetime | None,
    date_to: datetime | None,
    trade_view: str,
) -> dict[str, StrategyBlock]:
    keys_by_series = _strategy_keys_by_series(session, cohort)
    all_keys: dict[str, int] = {}
    for keys in keys_by_series.values():
        for k in keys:
            all_keys[k] = all_keys.get(k, 0) + 1

    block: dict[str, StrategyBlock] = {}
    for name_key, count in sorted(all_keys.items()):
        matched = count >= 2
        entries: list[dict] = []
        for s in cohort:
            if name_key in keys_by_series[s.id]:
                env = compute_metrics(
                    session,
                    s.id,
                    "strategy",
                    strategy=name_key,
                    date_from=date_from,
                    date_to=date_to,
                    trade_view=trade_view,
                )
                entries.append({"series_id": s.id, "metrics": env.metrics.model_dump()})
        block[name_key] = StrategyBlock(matched=matched, series=entries)
    return block


# ---------------------------------------------------------------------------


def _symbols_for_strategy(session: Session, series_id: int, strategy_name_key: str) -> set[str]:
    strat = session.scalar(
        select(Strategy.id).where(
            Strategy.series_id == series_id, Strategy.name_key == strategy_name_key
        )
    )
    if strat is None:
        return set()
    symbols = (
        session.execute(
            select(Fill.symbol)
            .where(
                Fill.series_id == series_id,
                Fill.strategy_id == strat,
                Fill.voided_at.is_(None),
            )
            .distinct()
        )
        .scalars()
        .all()
    )
    return set(symbols)


def _symbol_block(
    session: Session,
    cohort: list[Series],
    matched_keys: set[str],
    date_from: datetime | None,
    date_to: datetime | None,
    trade_view: str,
) -> dict[str, SymbolBlock]:
    block: dict[str, SymbolBlock] = {}
    for name_key in sorted(matched_keys):
        # collect symbols across cohort within this matched strategy
        all_syms: dict[str, int] = {}
        syms_by_series: dict[int, set[str]] = {}
        for s in cohort:
            syms = _symbols_for_strategy(session, s.id, name_key)
            syms_by_series[s.id] = syms
            for sym in syms:
                all_syms[sym] = all_syms.get(sym, 0) + 1

        for symbol, count in sorted(all_syms.items()):
            if count < 2:
                continue
            key = f"{name_key}/{symbol}"
            entries: list[dict] = []
            for s in cohort:
                if symbol in syms_by_series[s.id]:
                    env = compute_metrics(
                        session,
                        s.id,
                        "symbol",
                        strategy=name_key,
                        symbol=symbol,
                        date_from=date_from,
                        date_to=date_to,
                        trade_view=trade_view,
                    )
                    entries.append({"series_id": s.id, "pnl_metrics": env.metrics.model_dump()})
            block[key] = SymbolBlock(series=entries)
    return block


# ---------------------------------------------------------------------------


def _collect_fills(
    session: Session,
    cohort: list[Series],
    matched_keys: set[str],
    date_from: datetime | None,
    date_to: datetime | None,
    session_tz: str,
) -> tuple[
    dict[tuple[str, str], list[tuple[int, Fill]]],
    dict[int, dict[tuple[str, str], list[Fill]]],
]:
    """Collect non-voided fills for aligned (name_key, symbol) groups in cohort.

    Returns:
      aligned: (name_key, symbol) -> [(series_index, Fill), ...] (time-sorted)
    """
    from app.services.metrics import trade_date

    # Convert datetime → date to avoid comparison errors
    if isinstance(date_from, datetime):
        date_from = date_from.date()
    if isinstance(date_to, datetime):
        date_to = date_to.date()

    aligned: dict[tuple[str, str], list[tuple[int, Fill]]] = defaultdict(list)
    all_by_series: dict[int, dict[tuple[str, str], list[Fill]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for idx, s in enumerate(cohort):
        strats = {
            st.id: st.name_key
            for st in session.scalars(select(Strategy).where(Strategy.series_id == s.id)).all()
        }
        fills = session.scalars(
            select(Fill).where(
                Fill.series_id == s.id,
                Fill.voided_at.is_(None),
            )
        ).all()

        for f in fills:
            nk = strats.get(f.strategy_id)
            if nk is None or nk not in matched_keys:
                continue
            if date_from is not None or date_to is not None:
                td = trade_date(f.ts, session_tz)
                if date_from is not None and td < date_from:
                    continue
                if date_to is not None and td > date_to:
                    continue
            key = (nk, f.symbol)
            all_by_series[idx][key].append(f)
            aligned[key].append((idx, f))

    for k in aligned:
        aligned[k].sort(key=lambda x: x[1].ts)

    return dict(aligned), {idx: dict(d) for idx, d in all_by_series.items()}


def _match_fills(
    aligned: dict[tuple[str, str], list[tuple[int, Fill]]],
    baseline_idx: int,
    tolerance_sec: int,
) -> tuple[list[dict], dict[str, list[dict]]]:
    """Greedy same-side nearest-timestamp matching within aligned groups.

    Returns (rows, unmatched_by_series).
    """
    rows: list[dict] = []
    unmatched: dict[str, list[dict]] = defaultdict(list)

    for (nk, symbol), fills in sorted(aligned.items()):
        # split by side
        by_side: dict[str, list[tuple[int, Fill]]] = defaultdict(list)
        for idx, f in fills:
            by_side[f.side].append((idx, f))

        for side, side_fills in by_side.items():
            baseline_fills = [f for idx, f in side_fills if idx == baseline_idx]
            other_fills = [f for idx, f in side_fills if idx != baseline_idx]

            if not baseline_fills:
                for _, f in side_fills:
                    unmatched[str(f.series_id)].append(
                        {
                            "client_fill_id": f.client_fill_id,
                            "symbol": f.symbol,
                            "side": f.side,
                            "ts": f.ts.isoformat(),
                        }
                    )
                continue

            baseline_fills.sort(key=lambda f: f.ts)
            used = set()

            for bf in baseline_fills:
                # find nearest other fill by timestamp
                best = None
                best_delta = None
                for of in other_fills:
                    if of.client_fill_id in used:
                        continue
                    delta = abs((of.ts - bf.ts).total_seconds())
                    if delta <= tolerance_sec and (best is None or delta < best_delta):
                        best = of
                        best_delta = delta

                if best is not None:
                    used.add(best.client_fill_id)
                    # Compute diff: other - baseline
                    price_slip = best.price - bf.price
                    price_slip_pct_val = (
                        (price_slip / bf.price * Decimal("100")) if bf.price != 0 else Decimal("0")
                    )
                    timing = int((best.ts - bf.ts).total_seconds())
                    qty_diff = best.qty - bf.qty
                    bfee = bf.commission + bf.exchange_fee + bf.regulatory_fee + bf.financing_fee
                    ofee = (
                        best.commission
                        + best.exchange_fee
                        + best.regulatory_fee
                        + best.financing_fee
                    )
                    fee_diff = ofee - bfee

                    rows.append(
                        {
                            "ts": bf.ts.isoformat(),
                            "symbol": symbol,
                            "side": side,
                            "name_key": nk,
                            "baseline_fill": bf,
                            "other_fill": best,
                            "other_series_id": best.series_id,
                            "diff": {
                                "price_slippage": str(price_slip),
                                "price_slippage_pct": str(
                                    price_slip_pct_val.quantize(Decimal("0.000001"))
                                ),
                                "timing_sec": timing,
                                "qty_diff": str(qty_diff),
                                "fee_diff": str(fee_diff),
                            },
                        }
                    )

            # Remaining unmatched other fills
            for of in other_fills:
                if of.client_fill_id not in used:
                    sid = find_series_id_for_fill(of, fills) or of.series_id
                    unmatched[str(sid)].append(
                        {
                            "client_fill_id": of.client_fill_id,
                            "symbol": of.symbol,
                            "side": of.side,
                            "ts": of.ts.isoformat(),
                        }
                    )

    return rows, dict(unmatched)


def find_series_id_for_fill(fill, fills):
    """Look up the series_id for a fill in the aligned list."""
    for _idx, f in fills:
        if f.id == fill.id:
            return f.series_id
    return fill.series_id


def _paginate(rows: list[dict], page: int, page_size: int) -> tuple[list[PerTradeRow], int]:
    total = len(rows)
    rows.sort(key=lambda r: r["ts"])
    start = (page - 1) * page_size
    end = start + page_size
    page_rows = rows[start:end]

    out: list[PerTradeRow] = []
    for r in page_rows:
        bl = r["baseline_fill"]
        ot = r["other_fill"]
        out.append(
            PerTradeRow(
                ts=r["ts"],
                symbol=r["symbol"],
                side=r["side"],
                name_key=r["name_key"],
                values={
                    str(bl.series_id): PerTradeValue(
                        price=str(bl.price),
                        qty=str(bl.qty),
                        total_fee=str(
                            bl.commission + bl.exchange_fee + bl.regulatory_fee + bl.financing_fee
                        ),
                        ts=bl.ts.isoformat(),
                    ),
                    str(ot.series_id): PerTradeValue(
                        price=str(ot.price),
                        qty=str(ot.qty),
                        total_fee=str(
                            ot.commission + ot.exchange_fee + ot.regulatory_fee + ot.financing_fee
                        ),
                        ts=ot.ts.isoformat(),
                    ),
                },
                diff=PerTradeDiff(
                    price_slippage=r["diff"]["price_slippage"],
                    price_slippage_pct=r["diff"]["price_slippage_pct"],
                    timing_sec=r["diff"]["timing_sec"],
                    qty_diff=r["diff"]["qty_diff"],
                    fee_diff=r["diff"]["fee_diff"],
                ),
            )
        )
    return out, total


# ---------------------------------------------------------------------------


def _strategy_entity_block(
    session: Session,
    strategy_keys: list[tuple[int, str]],
    date_from: datetime | None,
    date_to: datetime | None,
) -> tuple[AccountBlock, list[SeriesEquityCurve]]:
    """Compute account-level metrics + equity curves scoped to a specific (series_id, name_key) entity."""
    from app.services.metrics import compute_metrics

    entries: list[AccountSeriesEntry] = []
    equity_curves: list[SeriesEquityCurve] = []
    for series_id, name_key in strategy_keys:
        data = compute_metrics(
            session=session,
            series_id=series_id,
            level="strategy",
            strategy=name_key,
            date_from=date_from,
            date_to=date_to,
        )
        entries.append(
            AccountSeriesEntry(
                series_id=series_id,
                meta={"entity_type": "strategy", "name_key": name_key},
                metrics=data.metrics.model_dump(),
            )
        )
        equity_curves.append(
            SeriesEquityCurve(
                series_id=series_id,
                name=f"S{series_id}/{name_key}",
                equity_curve=[p.model_dump() for p in data.equity_curve],
                drawdown_series=[p.model_dump() for p in data.drawdown_series],
            )
        )
    return AccountBlock(series=entries), equity_curves


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------


def compare(
    session: Session,
    user_id: int,
    series_ids: list[int],
    *,
    level: str = "account",
    strategy_keys: list[dict] | None = None,
    baseline_entity_index: int = 0,
    baseline_series_id: int | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    trade_view: str = "lot",
    per_trade_page: int = 1,
    per_trade_page_size: int = 500,
) -> ComparisonOut:
    # 1. Ownership validation
    series = _load_owned_series(session, user_id, series_ids)

    # 2. Baseline resolution
    baseline = _resolve_baseline(series, baseline_series_id)

    # 3. Currency partition
    diff_cohort, mismatched = _partition_by_currency(series, baseline)

    if level == "strategy" and strategy_keys:
        # Strategy-level comparison: entity-keyed results
        st_keys = [(sk["series_id"], sk["name_key"]) for sk in strategy_keys]
        account_block, equity_curves = _strategy_entity_block(session, st_keys, date_from, date_to)

        return ComparisonOut(
            meta=ComparisonMeta(
                base_currency=baseline.base_currency,
                baseline_series_id=series_ids[baseline_entity_index],
                date_range={"from": str(date_from) if date_from else None, "to": str(date_to) if date_to else None},
                currency_mismatch_series=[],
            ),
            account=account_block,
            strategy={},
            symbol={},
            per_trade=PerTradeBlock(page=1, page_size=500, total=0, rows=[], unmatched={}),
            equity_curves=equity_curves,
        )

    # 4. Account block (all series, including mismatched)
    account = _account_block(session, series, date_from, date_to, trade_view)

    # 5. Strategy block (diff cohort only)
    strategy = _strategy_block(session, diff_cohort, date_from, date_to, trade_view)

    # 6. Symbol block (matched strategies only)
    matched_keys = {nk for nk, sb in strategy.items() if sb.matched}
    symbol = _symbol_block(session, diff_cohort, matched_keys, date_from, date_to, trade_view)

    # 7. Per-trade matcher
    from app.core.config import settings

    tolerance = settings.PER_TRADE_MATCH_TOLERANCE
    baseline_idx = next(i for i, s in enumerate(diff_cohort) if s.id == baseline.id)

    aligned_groups, _ = _collect_fills(
        session, diff_cohort, matched_keys, date_from, date_to, baseline.session_tz
    )
    matched_rows, unmatched_raw = _match_fills(aligned_groups, baseline_idx, tolerance)
    page_rows, total = _paginate(matched_rows, per_trade_page, per_trade_page_size)

    per_trade_unmatched: dict[str, list[UnmatchedFill]] = {}
    for sid, fills in unmatched_raw.items():
        per_trade_unmatched[sid] = [
            UnmatchedFill(
                client_fill_id=f["client_fill_id"],
                symbol=f["symbol"],
                side=f["side"],
                ts=f["ts"],
            )
            for f in fills
        ]

    # 8. Equity curves (per series)
    equity_curves = []
    for s in series:
        fills, instruments, _ = _load_fills(session, s.id)
        if not fills:
            equity_curves.append(SeriesEquityCurve(
                series_id=s.id,
                name=s.name,
                equity_curve=[],
                drawdown_series=[],
            ))
            continue
        rts = pair_fills(fills, instruments)
        if date_from is not None or date_to is not None:
            from app.services.metrics import filter_round_trips
            rts = filter_round_trips(rts, s.session_tz, date_from, date_to)
        curve = realized_equity_curve(rts)
        cb = account_base(session, s.id, at=date_from) if date_from else account_base(session, s.id, at=None)
        idx = indexed_curve(curve, cb)
        dd = drawdown_series(curve)
        equity_curves.append(SeriesEquityCurve(
            series_id=s.id,
            name=s.name,
            equity_curve=[
                {"ts": ts.isoformat(), "realized_pnl": str(cum), "indexed_return": str(idx[i]) if idx[i] is not None else "0"}
                for i, (ts, cum) in enumerate(curve)
            ],
            drawdown_series=[{"ts": ts.isoformat(), "drawdown": str(d), "drawdown_pct": str(p)} for ts, d, p in dd],
        ))

    return ComparisonOut(
        meta=ComparisonMeta(
            base_currency=baseline.base_currency,
            baseline_series_id=baseline.id,
            date_range={
                "from": date_from.isoformat() if date_from else None,
                "to": date_to.isoformat() if date_to else None,
            },
            currency_mismatch_series=mismatched,
        ),
        account=account,
        strategy=strategy,
        symbol=symbol,
        per_trade=PerTradeBlock(
            page=per_trade_page,
            page_size=per_trade_page_size,
            total=total,
            rows=page_rows,
            unmatched=per_trade_unmatched,
        ),
        equity_curves=equity_curves,
    )
