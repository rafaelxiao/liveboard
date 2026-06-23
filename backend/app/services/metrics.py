"""Metrics engine: trade stats, envelope assembly, coordination of Phase 3 services.

Phase-4 consumer of pairing.py, capital.py, fx.py.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal
import math
import statistics
from typing import TYPE_CHECKING

from sqlalchemy import select

from app.core.config import settings

if TYPE_CHECKING:
    from app.services.pairing import RoundTrip

_RATIO_Q = Decimal("0.000000000001")


# ---------------------------------------------------------------------------


def trade_date(ts: datetime, session_tz: str) -> date:
    """Calendar date of *ts* in *session_tz*."""
    from zoneinfo import ZoneInfo

    return ts.astimezone(ZoneInfo(session_tz)).date()


# ---------------------------------------------------------------------------


def trade_stats(rts: list[RoundTrip]) -> dict:
    n = len(rts)
    gross = sum((rt.gross_pnl for rt in rts), Decimal("0"))
    net = sum((rt.net_pnl for rt in rts), Decimal("0"))
    fees = sum((rt.total_fees for rt in rts), Decimal("0"))

    wins = [rt.net_pnl for rt in rts if rt.net_pnl > 0]
    losses = [rt.net_pnl for rt in rts if rt.net_pnl < 0]

    win_rate = (Decimal(len(wins)) / n).quantize(_RATIO_Q) if n else Decimal("0")
    loss_rate = (Decimal(len(losses)) / n) if n else Decimal("0")
    avg_win = (sum(wins, Decimal("0")) / len(wins)) if wins else Decimal("0")
    avg_loss = (sum(losses, Decimal("0")) / len(losses)) if losses else Decimal("0")

    gross_win = sum(wins, Decimal("0"))
    gross_loss = sum(losses, Decimal("0"))
    profit_factor = (gross_win / abs(gross_loss)) if gross_loss != 0 else None
    payoff_ratio = (avg_win / abs(avg_loss)) if avg_loss != 0 else None
    expectancy = (
        (win_rate * avg_win - loss_rate * abs(avg_loss)).quantize(_RATIO_Q) if n else Decimal("0")
    )

    if rts:
        avg_hold = int(sum((rt.close_ts - rt.open_ts).total_seconds() for rt in rts) / n)
    else:
        avg_hold = 0

    # consec + largest (Task 12)
    ordered = sorted(rts, key=lambda rt: (rt.close_ts, rt.open_ts))
    max_w = max_l = cur_w = cur_l = 0
    for rt in ordered:
        if rt.net_pnl > 0:
            cur_w += 1
            cur_l = 0
        elif rt.net_pnl < 0:
            cur_l += 1
            cur_w = 0
        else:
            cur_w = cur_l = 0
        max_w = max(max_w, cur_w)
        max_l = max(max_l, cur_l)

    return {
        "gross_pnl": gross,
        "net_pnl": net,
        "total_fees": fees,
        "win_rate": win_rate,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "payoff_ratio": payoff_ratio,
        "expectancy": expectancy,
        "avg_holding_secs": avg_hold,
        "trade_count": n,
        "max_consec_wins": max_w,
        "max_consec_losses": max_l,
        "largest_win": max((rt.net_pnl for rt in rts), default=Decimal("0")),
        "largest_loss": min((rt.net_pnl for rt in rts), default=Decimal("0")),
    }




# ---------------------------------------------------------------------------


def symbol_contribution(symbol_net: Decimal, strategy_net: Decimal) -> Decimal | None:
    if strategy_net == 0:
        return None
    return (symbol_net / strategy_net).quantize(_RATIO_Q)


# ---------------------------------------------------------------------------


def build_flags(
    *,
    round_trip_count: int,
    active_days: int,
    fx_missing: bool,
    open_positions_exist: bool,
) -> dict:
    low_sample = (
        round_trip_count < settings.SHARPE_MIN_SAMPLE_TRADES
        or active_days < settings.SHARPE_MIN_ACTIVE_DAYS
    )
    suppressed = round_trip_count < settings.SHARPE_SUPPRESS_BELOW
    return {
        "realized_only": True,
        "low_sample": low_sample,
        "sharpe_suppressed": suppressed,
        "fx_missing": fx_missing,
        "open_positions_exist": open_positions_exist,
    }


def apply_suppression(value: float | None, suppressed: bool) -> float | None:
    return None if suppressed else value


# ---------------------------------------------------------------------------


def units_map(level: str, base_currency: str) -> dict[str, str]:
    units = {
        "net_pnl": base_currency,
        "gross_pnl": base_currency,
        "total_fees": base_currency,
        "fees_on_open_positions": base_currency,
        "largest_win": base_currency,
        "largest_loss": base_currency,
        "avg_win": base_currency,
        "avg_loss": base_currency,
        "expectancy": base_currency,
        "win_rate": "ratio",
        "profit_factor": "ratio",
        "payoff_ratio": "ratio",
        "max_consec_wins": "count",
        "max_consec_losses": "count",
        "trade_count": "count",
        "avg_holding_secs": "seconds",
        "twr": "ratio",
        "cagr": "annualized_ratio",
        "calmar": "ratio",
        "max_drawdown": base_currency,
        "volatility": "annualized_ratio",
        "sharpe": "annualized_ratio",
        "sortino": "annualized_ratio",
        "alpha": "annualized_ratio",
        "beta": "ratio",
        "information_ratio": "annualized_ratio",
    }
    if level == "symbol":
        units["contribution_pct"] = "ratio"
    return units


# ---------------------------------------------------------------------------


def _fmt(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, float):
        return str(v)
    return str(v)


def _calendar_days(rts, tz):
    if not rts:
        return []
    dates = sorted({trade_date(rt.close_ts, tz) for rt in rts})
    start, end = dates[0], dates[-1]
    out, d = [], start
    while d <= end:
        out.append(d)
        d += timedelta(days=1)
    return out


def _has_close_on(rts, tz, d) -> bool:
    return any(trade_date(rt.close_ts, tz) == d for rt in rts)


def _has_open_positions(fills, instruments) -> bool:
    net = defaultdict(Decimal)
    for f in fills:
        if f.voided_at is not None:
            continue
        sign = Decimal("1") if f.side == "buy" else Decimal("-1")
        net[(f.strategy_id, f.symbol)] += sign * f.qty
    return any(v != 0 for v in net.values())


def _load_fx_batch(session, series_id: int):
    """Load all FX rates for a series into an in-memory lookup.

    Returns a callable that takes (ccy_from, ccy_to, at) and returns the
    applicable rate (or None) without further DB access.
    """
    from app.models.fx_rate import FxRate

    rows = session.scalars(
        select(FxRate).where(FxRate.series_id == series_id).order_by(FxRate.ts)
    ).all()

    by_pair: dict[tuple[str, str], list[tuple[datetime, Decimal]]] = defaultdict(list)
    for r in rows:
        by_pair[(r.ccy_from, r.ccy_to)].append((r.ts, r.rate))

    def get_rate(ccy_from: str, ccy_to: str, at: datetime) -> Decimal | None:
        if ccy_from == ccy_to:
            return Decimal("1")
        pair_rates = by_pair.get((ccy_from, ccy_to), [])
        if not pair_rates:
            pair_rates = by_pair.get((ccy_to, ccy_from), [])
            if not pair_rates:
                return None
            # Inverse rates
            for ts, rate in reversed(pair_rates):
                if ts <= at:
                    return Decimal("1") / rate
            return None
        for ts, rate in reversed(pair_rates):
            if ts <= at:
                return rate
        return None

    return get_rate


def _convert_to_base_ccy(rts, session, series_id, base_ccy):
    """Convert round-trip PnL to base currency using batched FX lookup."""
    if not rts:
        return rts

    rate_lookup = _load_fx_batch(session, series_id)

    for rt in rts:
        if rt.currency == base_ccy:
            continue
        rate = rate_lookup(rt.currency, base_ccy, rt.close_ts)
        if rate is not None:
            rt.gross_pnl = rt.gross_pnl * rate
            rt.total_fees = rt.total_fees * rate
            rt.entry_fees = rt.entry_fees * rate
            rt.exit_fees = rt.exit_fees * rate
            # Recompute net from converted gross/fees to avoid Decimal quantization drift
            rt.net_pnl = rt.gross_pnl - rt.total_fees
        else:
            rt.fx_missing = True
    return rts


def compute_metrics(
    session,
    series_id,
    level,
    *,
    strategy=None,
    symbol=None,
    date_from=None,
    date_to=None,
    trade_view="lot",
    active_days_only=False,
):
    from app.models.benchmark_return import BenchmarkReturn
    from app.models.series import Series
    from app.schemas.metrics import (
        DateRange,
        DrawdownPoint,
        EquityPoint,
        FlagsBlock,
        MetaBlock,
        MetricsBlock,
        MetricsEnvelope,
        SampleBlock,
    )
    from app.services import capital
    from app.services.pairing import fees_on_open_positions, pair_fills

    series = session.get(Series, series_id)
    tz = series.session_tz
    base_ccy = series.base_currency

    # 1. fills -> round-trips (instrument ccy)
    fills, instruments, strat_id = _load_fills(session, series_id, strategy, symbol)
    all_rts = pair_fills(fills, instruments)
    rts = filter_round_trips(all_rts, tz, date_from, date_to)
    fees_open = fees_on_open_positions(fills, instruments)

    # 2. convert to base currency
    rts = _convert_to_base_ccy(rts, session, series_id, base_ccy)
    fx_missing = any(rt.fx_missing for rt in rts)
    open_positions_exist = fees_open != Decimal("0") or _has_open_positions(fills, instruments)

    # 3. capital base
    if level == "symbol":
        capital_base = None
    elif level == "strategy":
        last_ts = max((rt.close_ts for rt in rts), default=None)
        capital_base = capital.strategy_base(session, series_id, strat_id, last_ts)
    else:
        last_ts = max((rt.close_ts for rt in rts), default=None)
        capital_base = capital.account_base(session, series_id, last_ts)

    # 4. equity + indexed + drawdown
    curve = realized_equity_curve(rts)
    idx = indexed_curve(curve, capital_base)
    dd = drawdown_series(curve)
    max_dd = max_drawdown(dd)

    # 5. risk metrics (account/strategy only)
    if level == "symbol" or not curve:
        twr_val = cagr_val = vol_val = sharpe_val = sortino_val = calmar_val = None
        active_days = 0
        max_dd_out = None if level == "symbol" else max_dd
    else:
        days = _calendar_days(rts, tz)
        base_by_day = capital.base_series(session, series_id, level, strat_id, days)
        rets = daily_returns(rts, base_by_day, tz, active_days_only=active_days_only)
        active_days = sum(1 for d in days if _has_close_on(rts, tz, d))
        vol_val = volatility(rets)
        sharpe_val = sharpe(rets)
        sortino_val = sortino(rets)
        n_days = max((days[-1] - days[0]).days + 1, 1) if days else 1
        cagr_val = cagr(curve, capital_base, n_days)
        calmar_val = calmar(cagr_val, max_dd, capital_base)
        twr_val = twr(session, series_id, level, strat_id, rts, tz)
        max_dd_out = max_dd

    # 6. suppression
    flags = build_flags(
        round_trip_count=len(rts),
        active_days=active_days,
        fx_missing=fx_missing,
        open_positions_exist=open_positions_exist,
    )
    if level != "symbol":
        sharpe_val = apply_suppression(sharpe_val, flags["sharpe_suppressed"])
        sortino_val = apply_suppression(sortino_val, flags["sharpe_suppressed"])

    # 7. trade stats
    stats = trade_stats(rts)

    # 8. symbol contribution
    contribution = None
    if level == "symbol":
        strat_fills, strat_instr, _ = _load_fills(session, series_id, strategy, None)
        strat_rts = _convert_to_base_ccy(
            filter_round_trips(pair_fills(strat_fills, strat_instr), tz, date_from, date_to),
            session,
            series_id,
            base_ccy,
        )
        strat_net = sum((rt.net_pnl for rt in strat_rts), Decimal("0"))
        contribution = symbol_contribution(stats["net_pnl"], strat_net)

    # 9. benchmark
    alpha = beta = ir = None
    if level != "symbol" and curve:
        bench_rows = (
            session.query(BenchmarkReturn).filter(BenchmarkReturn.series_id == series_id).all()
        )
        if bench_rows:
            from app.services.benchmark import benchmark_metrics

            bench_by_day = {trade_date(b.ts, tz): float(b.return_pct) for b in bench_rows}
            bm = benchmark_metrics(rets, bench_by_day)
            alpha, beta, ir = bm["alpha"], bm["beta"], bm["information_ratio"]

    # 6. trade concentration analysis
    conc_data = _trade_concentration(rts)

    # 7. symbol-level PnL contributions (for account/strategy level)
    symbol_contribs = _symbol_contributions(rts, base_ccy, level)

    # 10. assemble
    # 7. available strategies and symbols (for frontend pickers)
    avail_strategies = _get_series_strategies(session, series_id)
    avail_symbols = _get_series_symbols(session, series_id)

    meta = MetaBlock(
        level=level,
        base_currency=base_ccy,
        session_tz=tz,
        date_range=DateRange(
            from_=date_from.isoformat() if date_from else None,
            to=date_to.isoformat() if date_to else None,
        ),
        trade_view=trade_view,
        capital_base=_fmt(capital_base),
        sample=SampleBlock(round_trips=len(rts), active_days=active_days),
        flags=FlagsBlock(**flags),
        strategies=avail_strategies,
        symbols=avail_symbols,
    )
    metrics_block = MetricsBlock(
        net_pnl=_fmt(stats["net_pnl"]),
        gross_pnl=_fmt(stats["gross_pnl"]),
        total_fees=_fmt(stats["total_fees"]),
        fees_on_open_positions=_fmt(fees_open),
        twr=_fmt(twr_val),
        cagr=_fmt(cagr_val),
        volatility=_fmt(vol_val),
        sharpe=_fmt(sharpe_val),
        sortino=_fmt(sortino_val),
        calmar=_fmt(calmar_val),
        max_drawdown=_fmt(max_dd_out),
        win_rate=_fmt(stats["win_rate"]),
        profit_factor=_fmt(stats["profit_factor"]),
        payoff_ratio=_fmt(stats["payoff_ratio"]),
        expectancy=_fmt(stats["expectancy"]),
        max_consec_wins=stats["max_consec_wins"],
        max_consec_losses=stats["max_consec_losses"],
        largest_win=_fmt(stats["largest_win"]),
        largest_loss=_fmt(stats["largest_loss"]),
        avg_holding_secs=stats["avg_holding_secs"],
        trade_count=stats["trade_count"],
        avg_win=_fmt(stats["avg_win"]),
        avg_loss=_fmt(stats["avg_loss"]),
        contribution_pct=_fmt(contribution),
        concentration_curve=conc_data.get("gain_curve", []),
        loss_concentration_curve=conc_data.get("loss_curve", []),
        alpha=_fmt(alpha),
        beta=_fmt(beta),
        information_ratio=_fmt(ir),
        units=units_map(level, base_ccy),
    )
    equity = [
        EquityPoint(ts=ts.isoformat(), realized_pnl=_fmt(v), indexed_return=_fmt(idx[i]))
        for i, (ts, v) in enumerate(curve)
    ]
    drawdown = [
        DrawdownPoint(ts=ts.isoformat(), drawdown=_fmt(d), drawdown_pct=_fmt(p)) for ts, d, p in dd
    ]
    return MetricsEnvelope(
        meta=meta, metrics=metrics_block, equity_curve=equity, drawdown_series=drawdown,
        symbol_contributions=symbol_contribs,
    )


# ---------------------------------------------------------------------------
# Internal helpers for compute_metrics
# ---------------------------------------------------------------------------


def _load_fills(session, series_id, strategy=None, symbol=None):
    from app.models.fill import Fill
    from app.models.instrument import Instrument
    from app.models.strategy import Strategy

    q = session.query(Fill).filter(Fill.series_id == series_id, Fill.voided_at.is_(None))
    strat_id = None
    if strategy is not None:
        strat = (
            session.query(Strategy)
            .filter(
                Strategy.series_id == series_id,
                Strategy.name_key == strategy.strip().lower(),
            )
            .one_or_none()
        )
        if strat is None:
            return [], {}, None
        q = q.filter(Fill.strategy_id == strat.id)
        strat_id = strat.id
    if symbol is not None:
        q = q.filter(Fill.symbol == symbol.strip().upper())
    fills = q.all()
    instruments = {
        i.symbol: i
        for i in session.query(Instrument).filter(Instrument.series_id == series_id).all()
    }
    return fills, instruments, strat_id


def filter_round_trips(rts, session_tz, date_from, date_to):
    if date_from is not None and isinstance(date_from, datetime):
        date_from = date_from.date()
    if date_to is not None and isinstance(date_to, datetime):
        date_to = date_to.date()
    out = []
    for rt in rts:
        td = trade_date(rt.close_ts, session_tz)
        if date_from is not None and td < date_from:
            continue
        if date_to is not None and td > date_to:
            continue
        out.append(rt)
    return out


# ---------------------------------------------------------------------------

def realized_equity_curve(rts):
    """Step-function cumulative net PnL."""
    if not rts:
        return []
    ordered = sorted(rts, key=lambda rt: rt.close_ts)
    cum = Decimal("0")
    out = []
    for rt in ordered:
        cum += rt.net_pnl
        out.append((rt.close_ts, cum))
    return out


def indexed_curve(curve, capital_base):
    if capital_base is None or capital_base == Decimal("0") or not curve:
        return [None] * len(curve)
    return [cum / capital_base for _, cum in curve]


def drawdown_series(curve):
    if not curve:
        return []
    peak = Decimal("-Infinity")
    out = []
    for ts, cum in curve:
        if cum > peak:
            peak = cum
        dd = cum - peak
        pct = dd / peak if peak != 0 else Decimal("0")
        out.append((ts, dd, pct))
    return out


def max_drawdown(dd):
    if not dd:
        return Decimal("0")
    return min((d for _, d, _ in dd), default=Decimal("0"))


def daily_returns(rts, base_by_day, tz, active_days_only=False):
    from collections import OrderedDict

    if not rts or not base_by_day:
        return {}
    days = sorted(base_by_day.keys())
    start, end = days[0], days[-1]
    by_day: dict[date, Decimal] = OrderedDict()
    for rt in rts:
        td = trade_date(rt.close_ts, tz)
        by_day[td] = by_day.get(td, Decimal("0")) + rt.net_pnl
    out: dict[date, float] = {}
    prev_base = base_by_day.get(days[0], Decimal("0"))
    d = start
    while d <= end:
        base = base_by_day.get(d, prev_base)
        if base and base != 0:
            pnl = by_day.get(d, Decimal("0"))
            ret = float(pnl / base)
        else:
            ret = 0.0
        if not active_days_only or d in by_day:
            out[d] = ret
        prev_base = base
        d += timedelta(days=1)
    return out


def sharpe(daily_rets):
    if not daily_rets or len(daily_rets) < 2:
        return None
    vals = list(daily_rets.values())
    mean_ret = statistics.fmean(vals)
    sd = statistics.stdev(vals)
    if sd == 0:
        return None
    rf_daily = settings.RISK_FREE_RATE / settings.ANNUALIZATION_DAYS
    return (mean_ret - rf_daily) / sd * math.sqrt(settings.ANNUALIZATION_DAYS)


def sortino(daily_rets):
    if not daily_rets or len(daily_rets) < 2:
        return None
    vals = list(daily_rets.values())
    target_daily = 0.0  # Sortino target
    downside = [min(r - target_daily, 0) for r in vals]
    nz = [d for d in downside if d < 0]
    if not nz:
        return None
    mean_excess = statistics.fmean(vals) - target_daily
    downside_sd = math.sqrt(sum(d**2 for d in downside) / len(downside))
    if downside_sd == 0:
        return None
    return mean_excess / downside_sd * math.sqrt(settings.ANNUALIZATION_DAYS)


def volatility(daily_rets):
    if not daily_rets or len(daily_rets) < 2:
        return None
    vals = list(daily_rets.values())
    return statistics.stdev(vals) * math.sqrt(settings.ANNUALIZATION_DAYS)


def cagr(curve, capital_base, n_days):
    if not curve or capital_base is None or capital_base == Decimal("0") or n_days < 1:
        return None
    _, ending = curve[-1]
    total_return = (capital_base + ending) / capital_base
    if total_return <= 0:
        return None
    years = n_days / settings.ANNUALIZATION_DAYS
    if years == 0:
        return None
    cagr_val = float(total_return) ** (1.0 / years) - 1.0
    return cagr_val


def calmar(cagr_val, max_dd, capital_base):
    if cagr_val is None or max_dd is None:
        return None
    if capital_base is None or capital_base == Decimal("0"):
        return None
    dd_pct = abs(float(max_dd)) / float(capital_base)
    if dd_pct == 0:
        return None
    return cagr_val / dd_pct


def twr(session, series_id, level, strat_id, rts, tz):
    """Time-Weighted Return — split at external cashflows, chain sub-periods."""
    if not rts or level == "symbol":
        return None

    from app.services import capital

    ordered = sorted(rts, key=lambda rt: rt.close_ts)
    start = ordered[0].close_ts
    end = ordered[-1].close_ts

    # Get all external movements in the period
    from app.models.fund_movement import FundMovement

    moves = (
        session.query(FundMovement)
        .filter(
            FundMovement.series_id == series_id,
            FundMovement.voided_at.is_(None),
            FundMovement.ts >= start,
            FundMovement.ts <= end,
        )
        .all()
    )

    # Filter to external movements
    external_ts = sorted(
        {m.ts for m in moves if m.from_bucket == "EXTERNAL" or m.to_bucket == "EXTERNAL"}
    )

    if not external_ts:
        # Single period
        base = capital.account_base(session, series_id, start)
        if base is None or base == Decimal("0"):
            return None
        pnl = sum((rt.net_pnl for rt in ordered), Decimal("0"))
        return (base + pnl) / base - Decimal("1")

    # Chain TWR across sub-periods between external flows
    periods = [start] + external_ts + [end]
    twr_total = Decimal("1")
    for i in range(len(periods) - 1):
        period_start = periods[i]
        period_end = periods[i + 1]

        # RTs closing in this sub-period
        sub_rts = [rt for rt in ordered if period_start <= rt.close_ts <= period_end]
        if not sub_rts:
            continue

        # Starting base: use last sub-period plus flow
        if level == "strategy":
            base_start = capital.strategy_base(session, series_id, strat_id, period_start)
        else:
            base_start = capital.account_base(session, series_id, period_start)

        if base_start is None or base_start == Decimal("0"):
            continue

        sub_pnl = sum((rt.net_pnl for rt in sub_rts), Decimal("0"))
        sub_twr = (base_start + sub_pnl) / base_start
        twr_total *= sub_twr

    return twr_total - Decimal("1")


import statistics  # noqa: E402

# ---------------------------------------------------------------------------
# Task 9 pure helper: TWR from event stream (unit-testable, no DB)
# ---------------------------------------------------------------------------


def twr_from_periods(starting_base, events):
    """Chain sub-period returns split at external cashflows.

    events: time-ordered list of ("pnl", Decimal) | ("flow", Decimal).
    """
    base = starting_base
    period_pnl = Decimal("0")
    factor = Decimal("1")
    established = base > 0

    def _close_period(b, p, f):
        if b > 0:
            return f * (Decimal("1") + p / b)
        return f

    for kind, amount in events:
        if kind == "pnl":
            period_pnl += amount
        elif kind == "flow":
            factor = _close_period(base, period_pnl, factor)
            base += amount
            period_pnl = Decimal("0")
            if base > 0:
                established = True
    factor = _close_period(base, period_pnl, factor)

    if not established:
        return None
    return (factor - Decimal("1")).quantize(_RATIO_Q)


def _get_series_strategies(session, series_id: int) -> list[str]:
    """Return all distinct strategy keys for a series."""
    from sqlalchemy import select

    from app.models.strategy import Strategy

    rows = session.scalars(
        select(Strategy.name_key).where(Strategy.series_id == series_id).distinct()
    ).all()
    return sorted(rows)


def _get_series_symbols(session, series_id: int) -> list[str]:
    """Return all distinct traded symbols for a series."""
    from sqlalchemy import select

    from app.models.fill import Fill

    rows = session.scalars(
        select(Fill.symbol).where(Fill.series_id == series_id, Fill.voided_at.is_(None)).distinct()
    ).all()
    return sorted(rows)


def _trade_concentration(rts):
    """Compute trade concentration curves for gains and losses separately."""
    if not rts:
        return {"gain_curve": [], "loss_curve": []}

    winners = sorted([rt for rt in rts if rt.net_pnl > 0], key=lambda rt: rt.net_pnl, reverse=True)
    losers = sorted([rt for rt in rts if rt.net_pnl < 0], key=lambda rt: rt.net_pnl)
    total_gain = sum(rt.net_pnl for rt in winners)
    total_loss = abs(sum(rt.net_pnl for rt in losers))

    percentiles = [1, 2, 5, 10, 20, 50]

    def _curve(trades, total, label):
        curve = []
        for pct in percentiles:
            n = max(1, int(len(trades) * pct / 100))
            cum = sum(rt.net_pnl for rt in trades[:n])
            if label == "loss":
                cum = abs(cum)
            curve.append({
                "pct_trades": str(pct),
                "trade_count": n,
                "cum_pnl_pct": str(cum / total) if total != 0 else "0",
            })
        return curve

    return {
        "gain_curve": _curve(winners, total_gain, "gain"),
        "loss_curve": _curve(losers, total_loss, "loss"),
    }


def _symbol_contributions(rts, base_ccy, level):
    """Compute per-symbol PnL contributions (account level only)."""
    from collections import defaultdict

    if not rts:
        return []

    by_symbol: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for rt in rts:
        by_symbol[rt.symbol] += rt.net_pnl

    total = sum(by_symbol.values())
    if total == Decimal("0"):
        return []

    result = []
    for symbol in sorted(by_symbol.keys()):
        contrib = by_symbol[symbol]
        result.append({
            "symbol": symbol,
            "pnl": str(contrib),
            "pct": str(contrib / total) if total != 0 else "0",
        })
    result.sort(key=lambda x: abs(Decimal(x["pnl"])), reverse=True)
    return result
