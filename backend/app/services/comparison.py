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
    ExecutionComparisonBlock,
    ExecutionDeltaGroup,
    PnlBreakdownBlock,
    PnlBreakdownRow,
)
from app.services.metrics import compute_metrics, drawdown_series, _load_fills, realized_equity_curve, indexed_curve
from app.services.pairing import pair_fills
from app.services.capital import account_base

# ---------------------------------------------------------------------------


def _load_instruments(session: Session, series_id: int) -> dict[str, "Instrument"]:
    """Load all instruments for a series into a symbol→Instrument map."""
    from app.models.instrument import Instrument
    return {i.symbol: i for i in session.scalars(select(Instrument).where(Instrument.series_id == series_id)).all()}


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
    trade_grouping: str,
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
    trade_grouping: str,
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
                    trade_grouping=trade_grouping,
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
    trade_grouping: str,
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
                        trade_grouping=trade_grouping,
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
    trade_grouping: str = "day",
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
            trade_grouping=trade_grouping,
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
                name=name_key,
                equity_curve=[p.model_dump() for p in data.equity_curve],
                drawdown_series=[p.model_dump() for p in data.drawdown_series],
            )
        )
    return AccountBlock(series=entries), equity_curves


# ---------------------------------------------------------------------------
# PnL breakdown: shared days vs different dates, per strategy per month
# ---------------------------------------------------------------------------


def _pnl_breakdown_aggregated(
    session: Session,
    cohort: list[Series],
    matched_keys: set[str],
    date_from: datetime | None,
    date_to: datetime | None,
) -> "PnlBreakdownBlock":
    """Aggregate all strategies together — one row per month."""
    from collections import defaultdict

    from app.models.strategy import Strategy
    from app.models.instrument import Instrument
    from app.services.metrics import trade_date

    # Load all fills across all matched strategies
    # Use cohort order: first selected = first, second selected = second
    first_s = cohort[0]
    second_s = cohort[1] if len(cohort) > 1 else cohort[0]

    def load_fills(series):
        all_f = []
        for st in session.scalars(select(Strategy).where(Strategy.series_id == series.id)).all():
            if st.name_key not in matched_keys:
                continue
            fills = session.scalars(
                select(Fill).where(Fill.series_id == series.id, Fill.strategy_id == st.id, Fill.voided_at.is_(None))
            ).all()
            if date_from is not None or date_to is not None:
                df = date_from.date() if isinstance(date_from, datetime) else date_from
                dt = date_to.date() if isinstance(date_to, datetime) else date_to
                fills = [f for f in fills if (df is None or trade_date(f.ts, series.session_tz) >= df) and (dt is None or trade_date(f.ts, series.session_tz) <= dt)]
            all_f.extend(fills)
        return all_f

    f1_fills = load_fills(first_s)
    f2_fills = load_fills(second_s)

    inst_f1 = _load_instruments(session, first_s.id)
    inst_f2 = _load_instruments(session, second_s.id)

    f1_days = {f.ts.date() for f in f1_fills}
    f2_days = {f.ts.date() for f in f2_fills}
    shared = f1_days & f2_days
    f1_only = f1_days - f2_days
    f2_only = f2_days - f1_days

    pnl_f1 = defaultdict(Decimal)
    pnl_f2 = defaultdict(Decimal)
    for rt in pair_fills(f1_fills, inst_f1):
        pnl_f1[(rt.close_ts.strftime("%Y-%m"), rt.close_ts.date())] += rt.net_pnl
    for rt in pair_fills(f2_fills, inst_f2):
        pnl_f2[(rt.close_ts.strftime("%Y-%m"), rt.close_ts.date())] += rt.net_pnl

    monthly: dict[str, dict] = defaultdict(lambda: {"total_1": Decimal("0"), "total_2": Decimal("0"), "shared_1": Decimal("0"), "shared_2": Decimal("0"), "o1": Decimal("0"), "o2": Decimal("0")})
    for (m, d), v in pnl_f1.items():
        monthly[m]["total_1"] += v
        if d in shared: monthly[m]["shared_1"] += v
        elif d in f1_only: monthly[m]["o1"] += v
    for (m, d), v in pnl_f2.items():
        monthly[m]["total_2"] += v
        if d in shared: monthly[m]["shared_2"] += v
        elif d in f2_only: monthly[m]["o2"] += v

    rows = []
    for m in sorted(monthly.keys()):
        d = monthly[m]
        rows.append(PnlBreakdownRow(
            month=m, name_key="",
            first_pnl=str(d["total_1"].quantize(Decimal("0.01"))),
            second_pnl=str(d["total_2"].quantize(Decimal("0.01"))),
            total_delta=str((d["total_1"] - d["total_2"]).quantize(Decimal("0.01"))),
            shared_delta=str((d["shared_1"] - d["shared_2"]).quantize(Decimal("0.01"))),
            date_delta=str((d["o1"] - d["o2"]).quantize(Decimal("0.01"))),
        ))
    return PnlBreakdownBlock(
        first_name=cohort[0].name,
        second_name=cohort[1].name if len(cohort) > 1 else "",
        rows=rows,
    )


def _pnl_breakdown(
    session: Session,
    cohort: list[Series],
    baseline: Series,
    matched_keys: set[str],
    date_from: datetime | None,
    date_to: datetime | None,
    group_by_strategy: bool = True,
) -> PnlBreakdownBlock:
    """Break down the PnL difference per strategy/month into shared-day and date-delta."""
    from collections import defaultdict

    from app.models.strategy import Strategy
    from app.services.metrics import trade_date, filter_round_trips

    strat_map: dict[int, str] = {}
    for s in cohort:
        for st in session.scalars(select(Strategy).where(Strategy.series_id == s.id)).all():
            strat_map[st.id] = st.name_key

    rows: list[PnlBreakdownRow] = []

    if not group_by_strategy:
        # Aggregate all strategies together
        return _pnl_breakdown_aggregated(
            session, cohort, matched_keys, date_from, date_to
        )

    for nk in sorted(matched_keys):
        # Load fills for this strategy in both series
        fills_by_series: dict[int, list[Fill]] = {}
        days_by_series: dict[int, set] = {}
        for s in cohort:
            sid = None
            for st in session.scalars(select(Strategy).where(Strategy.series_id == s.id, Strategy.name_key == nk)).all():
                sid = st.id
                break
            if sid is None:
                continue
            fills = session.scalars(
                select(Fill).where(Fill.series_id == s.id, Fill.strategy_id == sid, Fill.voided_at.is_(None))
            ).all()
            if date_from is not None or date_to is not None:
                df = date_from.date() if isinstance(date_from, datetime) else date_from
                dt = date_to.date() if isinstance(date_to, datetime) else date_to
                fills = [f for f in fills if (df is None or trade_date(f.ts, s.session_tz) >= df) and (dt is None or trade_date(f.ts, s.session_tz) <= dt)]
            fills_by_series[s.id] = fills
            days_by_series[s.id] = {f.ts.date() for f in fills}

        if len(fills_by_series) < 2:
            continue

        # Use cohort order: first selected minus second selected
        first_s = cohort[0]
        second_s = cohort[1] if len(cohort) > 1 else cohort[0]
        if first_s.id == second_s.id:
            continue
        f1_fills = fills_by_series.get(first_s.id, [])
        f2_fills = fills_by_series.get(second_s.id, [])
        if not f1_fills or not f2_fills:
            continue

        # Pair and get daily PnL
        from app.models.instrument import Instrument

        inst_f1 = _load_instruments(session, first_s.id)
        inst_f2 = _load_instruments(session, second_s.id)

        pnl_f1 = defaultdict(Decimal)
        pnl_f2 = defaultdict(Decimal)
        for rt in pair_fills(f1_fills, inst_f1):
            pnl_f1[(rt.close_ts.strftime("%Y-%m"), rt.close_ts.date())] += rt.net_pnl
        for rt in pair_fills(f2_fills, inst_f2):
            pnl_f2[(rt.close_ts.strftime("%Y-%m"), rt.close_ts.date())] += rt.net_pnl

        shared_days = days_by_series[first_s.id] & days_by_series[second_s.id]
        f1_only = days_by_series[first_s.id] - days_by_series[second_s.id]
        f2_only = days_by_series[second_s.id] - days_by_series[first_s.id]

        # Aggregate by month
        monthly: dict[str, dict] = defaultdict(lambda: {"total_1": Decimal("0"), "total_2": Decimal("0"), "shared_1": Decimal("0"), "shared_2": Decimal("0"), "o1": Decimal("0"), "o2": Decimal("0")})
        for (m, d), v in pnl_f1.items():
            monthly[m]["total_1"] += v
            if d in shared_days:
                monthly[m]["shared_1"] += v
            elif d in f1_only:
                monthly[m]["o1"] += v
        for (m, d), v in pnl_f2.items():
            monthly[m]["total_2"] += v
            if d in shared_days:
                monthly[m]["shared_2"] += v
            elif d in f2_only:
                monthly[m]["o2"] += v

        for m in sorted(monthly.keys()):
            d = monthly[m]
            rows.append(PnlBreakdownRow(
                month=m,
                name_key=nk,
                first_pnl=str(d["total_1"].quantize(Decimal("0.01"))),
                second_pnl=str(d["total_2"].quantize(Decimal("0.01"))),
                total_delta=str((d["total_1"] - d["total_2"]).quantize(Decimal("0.01"))),
                shared_delta=str((d["shared_1"] - d["shared_2"]).quantize(Decimal("0.01"))),
                date_delta=str((d["o1"] - d["o2"]).quantize(Decimal("0.01"))),
            ))

    return PnlBreakdownBlock(
        first_name=cohort[0].name if cohort else "",
        second_name=cohort[1].name if len(cohort) > 1 else "",
        rows=rows,
    )


# ---------------------------------------------------------------------------
# Execution quality comparison (VWAP delta per strategy/symbol)
# ---------------------------------------------------------------------------


def _execution_comparison(
    session: Session,
    cohort: list[Series],
    baseline: Series,
    matched_keys: set[str],
    date_from: datetime | None,
    date_to: datetime | None,
    aggregate: bool = False,
) -> ExecutionComparisonBlock:
    """Compare per-trade spread (sell price - buy price) / buy price between series.

    Symbol-independent: uses round-trip returns, not absolute VWAP.
    """
    from collections import defaultdict

    from app.models.strategy import Strategy
    from app.models.instrument import Instrument
    from app.services.metrics import trade_date

    # Load strategy name_keys
    strat_map: dict[int, str] = {}
    for s in cohort:
        for st in session.scalars(select(Strategy).where(Strategy.series_id == s.id)).all():
            strat_map[st.id] = st.name_key

    # Load instruments for each series
    instruments_by_series: dict[int, dict[str, Instrument]] = {}
    for s in cohort:
        instruments_by_series[s.id] = _load_instruments(session, s.id)

    groups_out: list[ExecutionDeltaGroup] = []

    for nk in sorted(matched_keys):
        # Load fills for this strategy in both series
        rt_by_series: dict[int, list] = {}
        for s in cohort:
            sid = None
            for st in session.scalars(select(Strategy).where(Strategy.series_id == s.id, Strategy.name_key == nk)).all():
                sid = st.id
                break
            if sid is None:
                continue
            fills = session.scalars(
                select(Fill).where(Fill.series_id == s.id, Fill.strategy_id == sid, Fill.voided_at.is_(None))
            ).all()
            if date_from is not None or date_to is not None:
                df = date_from.date() if isinstance(date_from, datetime) else date_from
                dt = date_to.date() if isinstance(date_to, datetime) else date_to
                fills = [f for f in fills if (df is None or trade_date(f.ts, s.session_tz) >= df) and (dt is None or trade_date(f.ts, s.session_tz) <= dt)]
            if not fills:
                continue
            rts = pair_fills(fills, instruments_by_series[s.id])
            # Filter to only complete round-trips (not open positions)
            rt_by_series[s.id] = rts

        if len(rt_by_series) < 2:
            continue

        # Compute per-trade spread for each series
        # spread = (sell_price - buy_price) / buy_price → gross_pnl / (entry_price * qty * mult)
        spreads: dict[int, list[Decimal]] = {}
        notional_by_series: dict[int, Decimal] = {}
        for s_id, rts in rt_by_series.items():
            s_spreads = []
            total_notional = Decimal("0")
            sym_spreads: dict[str, list[Decimal]] = defaultdict(list)
            sym_notional: dict[str, Decimal] = defaultdict(Decimal)
            for rt in rts:
                entry_notional = rt.entry_price * rt.qty * rt.multiplier
                if entry_notional == 0:
                    continue
                spread = rt.gross_pnl / entry_notional
                s_spreads.append(spread)
                total_notional += entry_notional
                sym_spreads[rt.symbol].append(spread)
                sym_notional[rt.symbol] += entry_notional
            spreads[s_id] = s_spreads
            notional_by_series[s_id] = total_notional
            # Also store per-symbol for non-aggregated mode
            if not aggregate:
                if not hasattr(rt_by_series, '_sym'):
                    # hack: store on the dict
                    pass

        other_s_id = next(s.id for s in cohort if s.id != baseline.id)
        if not spreads[baseline.id] or not spreads.get(other_s_id, []):
            continue

        other_s = next(s for s in cohort if s.id != baseline.id)

        if aggregate:
            # One row per strategy
            avg_b = sum(spreads[baseline.id], Decimal("0")) / len(spreads[baseline.id])
            avg_o = sum(spreads[other_s.id], Decimal("0")) / len(spreads[other_s.id])
            diff_bps = (avg_b - avg_o) * Decimal("10000")
            min_total_notional = min(notional_by_series[baseline.id], notional_by_series[other_s.id])
            impact = diff_bps * min_total_notional / Decimal("10000")
            groups_out.append(ExecutionDeltaGroup(
                name_key=nk, symbol="",
                baseline_series_id=baseline.id, other_series_id=other_s.id,
                daily_groups=len(spreads[baseline.id]),
                weighted_avg_bps=str(diff_bps.quantize(Decimal("0.1"))),
                estimated_pnl_impact=str(impact.quantize(Decimal("0.01"))),
                total_notional=str(min_total_notional.quantize(Decimal("0"))),
            ))
        else:
            # Per-symbol rows
            # Recompute with per-symbol grouping
            sym_pairs = set()
            for s_id, rts in rt_by_series.items():
                for rt in rts:
                    sym_pairs.add((nk, rt.symbol))
            
            for nk2, sym in sorted(sym_pairs):
                # Get per-symbol spreads
                b_sym_spreads = []
                o_sym_spreads = []
                b_sym_notional = Decimal("0")
                o_sym_notional = Decimal("0")
                
                for rt in rt_by_series[baseline.id]:
                    if rt.symbol == sym:
                        en = rt.entry_price * rt.qty * rt.multiplier
                        if en:
                            b_sym_spreads.append(rt.gross_pnl / en)
                            b_sym_notional += en
                
                for rt in rt_by_series[other_s.id]:
                    if rt.symbol == sym:
                        en = rt.entry_price * rt.qty * rt.multiplier
                        if en:
                            o_sym_spreads.append(rt.gross_pnl / en)
                            o_sym_notional += en
                
                if not b_sym_spreads or not o_sym_spreads:
                    continue
                
                avg_b = sum(b_sym_spreads, Decimal("0")) / len(b_sym_spreads)
                avg_o = sum(o_sym_spreads, Decimal("0")) / len(o_sym_spreads)
                diff_bps = (avg_b - avg_o) * Decimal("10000")
                min_notional = min(b_sym_notional, o_sym_notional)
                impact = diff_bps * min_notional / Decimal("10000")
                
                groups_out.append(ExecutionDeltaGroup(
                    name_key=nk2, symbol=sym,
                    baseline_series_id=baseline.id, other_series_id=other_s.id,
                    daily_groups=len(b_sym_spreads),
                    weighted_avg_bps=str(diff_bps.quantize(Decimal("0.1"))),
                    estimated_pnl_impact=str(impact.quantize(Decimal("0.01"))),
                    total_notional=str(b_sym_notional.quantize(Decimal("0"))),
                ))

    # Aggregate per strategy (merge symbols) if aggregate=True
    if aggregate and groups_out:
        from collections import defaultdict
        agg: dict[str, dict] = defaultdict(lambda: {"total_notional": Decimal("0"), "total_impact": Decimal("0"), "daily_groups": 0, "weighted_sum": Decimal("0")})
        for g in groups_out:
            if g.weighted_avg_bps == "—":
                continue
            key = g.name_key
            n = Decimal(g.total_notional)
            agg[key]["total_notional"] += n
            agg[key]["total_impact"] += Decimal(g.estimated_pnl_impact)
            agg[key]["daily_groups"] += g.daily_groups
            agg[key]["weighted_sum"] += Decimal(g.weighted_avg_bps) * n

        groups_out = []
        for nk in sorted(agg.keys()):
            a = agg[nk]
            if a["total_notional"]:
                wavg = a["weighted_sum"] / a["total_notional"]
            else:
                wavg = Decimal("0")
            groups_out.append(ExecutionDeltaGroup(
                name_key=nk,
                symbol="",
                baseline_series_id=baseline.id,
                other_series_id=next(s.id for s in cohort if s.id != baseline.id),
                daily_groups=a["daily_groups"],
                weighted_avg_bps=str(wavg.quantize(Decimal("0.1"))),
                estimated_pnl_impact=str(a["total_impact"].quantize(Decimal("0.01"))),
                total_notional=str(a["total_notional"].quantize(Decimal("0"))),
            ))

    return ExecutionComparisonBlock(groups=groups_out)


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
    trade_grouping: str = "day",
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
        account_block, equity_curves = _strategy_entity_block(session, st_keys, date_from, date_to, trade_grouping)

        # Execution comparison for strategy level
        strat_matched_keys = {sk["name_key"] for sk in strategy_keys}
        execution_block = _execution_comparison(
            session, series, baseline, strat_matched_keys, date_from, date_to
        )
        pnl_breakdown_block = _pnl_breakdown(
            session, series, baseline, strat_matched_keys, date_from, date_to
        )

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
            execution=execution_block,
            pnl_breakdown=pnl_breakdown_block,
        )

    # 4. Account block (all series, including mismatched)
    account = _account_block(session, series, date_from, date_to, trade_view, trade_grouping)

    # 5. Compute matched strategy keys (lightweight — no metrics)
    keys_by_series = _strategy_keys_by_series(session, diff_cohort)
    if len(diff_cohort) >= 2:
        all_keys_sets = list(keys_by_series.values())
        matched_keys = all_keys_sets[0].copy()
        for ks in all_keys_sets[1:]:
            matched_keys &= ks
    else:
        matched_keys = set()

    # 6-7. Strategy, symbol, and per-trade blocks — only computed on demand
    strategy: dict[str, StrategyBlock] = {}
    symbol: dict[str, SymbolBlock] = {}
    per_trade = PerTradeBlock(page=1, page_size=500, total=0, rows=[], unmatched={})

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

    # 9. PnL breakdown by shared vs different dates (account-level: all strategies aggregated)
    pnl_breakdown_block = _pnl_breakdown(
        session, diff_cohort, baseline, matched_keys, date_from, date_to,
        group_by_strategy=False,
    )

    # 10. Execution quality comparison (VWAP deltas)
    execution_block = _execution_comparison(
        session, diff_cohort, baseline, matched_keys, date_from, date_to,
        aggregate=True,  # merge symbols, show per-strategy rows
    )

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
        per_trade=per_trade,
        equity_curves=equity_curves,
        execution=execution_block,
        pnl_breakdown=pnl_breakdown_block,
    )
