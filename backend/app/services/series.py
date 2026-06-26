from datetime import datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import Bucket
from app.models.fill import Fill
from app.models.fund_movement import FundMovement
from app.models.instrument import Instrument
from app.models.series import Series
from app.models.strategy import Strategy
from app.schemas.series import (
    InstrumentDetailOut,
    SeriesCounts,
    SeriesCreateIn,
    SeriesDetailOut,
    SeriesOut,
    StrategyBrief,
    SeriesSummary,
)
from app.services.pairing import pair_fills


class SeriesNotFound(Exception):
    pass


def create_series(session: Session, *, user_id: int, data: SeriesCreateIn) -> int:
    series = Series(
        user_id=user_id,
        name=data.name,
        tag=data.tag,
        notes=data.notes,
        base_currency=data.base_currency,
        session_tz=data.session_tz,
    )
    session.add(series)
    session.flush()
    if data.strategies:
        try:
            from app.services.ingestion import get_or_create_strategy
        except ImportError:
            pass
        else:
            cache: dict[str, int] = {}
            for s in data.strategies:
                get_or_create_strategy(session, series.id, s.name, cache)

    if data.instruments:
        try:
            from app.services.ingestion import upsert_instruments
        except ImportError:
            pass
        else:
            upsert_instruments(
                session,
                series_id=series.id,
                instruments=[{"symbol": i["symbol"]} for i in data.instruments],
            )

    if data.fund_movements:
        try:
            from app.services.ingestion import ingest_fund_movements
        except ImportError:
            pass
        else:
            ingest_fund_movements(
                session,
                series_id=series.id,
                movements=[{k: v for k, v in fm.items()} for fm in data.fund_movements],
            )

    session.flush()
    return series.id


def get_owned_series(session: Session, user_id: int, series_id: int) -> Series:
    series = session.get(Series, series_id)
    if series is None or series.user_id != user_id:
        raise SeriesNotFound(f"series {series_id} not found")
    return series


def list_series(session: Session, *, user_id: int) -> list[SeriesOut]:
    rows = session.scalars(
        select(Series).where(Series.user_id == user_id, Series.voided_at.is_(None)).order_by(Series.id)
    ).all()

    series_ids = [s.id for s in rows]

    # Batch-load fund movements for capital base
    fm_stmt = select(FundMovement).where(
        FundMovement.series_id.in_(series_ids),
        FundMovement.voided_at.is_(None),
    )
    fm_by_series: dict[int, list[FundMovement]] = {sid: [] for sid in series_ids}
    for fm in session.scalars(fm_stmt).all():
        fm_by_series[fm.series_id].append(fm)

    # Batch-load instruments for multiplier lookup
    inst_stmt = select(Instrument).where(Instrument.series_id.in_(series_ids))
    inst_by_series: dict[int, dict[str, Instrument]] = {}
    for inst in session.scalars(inst_stmt).all():
        inst_by_series.setdefault(inst.series_id, {})[inst.symbol] = inst

    # Batch-load fills for cumulative PnL
    fill_stmt = select(Fill).where(
        Fill.series_id.in_(series_ids),
        Fill.voided_at.is_(None),
    )
    fills_by_series: dict[int, list[Fill]] = {sid: [] for sid in series_ids}
    for f in session.scalars(fill_stmt).all():
        fills_by_series[f.series_id].append(f)

    # Counts
    strat_counts = {
        sid: session.scalar(
            select(func.count()).select_from(Strategy).where(Strategy.series_id == sid)
        ) or 0
        for sid in series_ids
    }
    inst_counts = {sid: len(inst_by_series.get(sid, {})) for sid in series_ids}
    fill_counts = {sid: len(fills_by_series.get(sid, [])) for sid in series_ids}

    # Batch-load strategy names for comparison strategy board
    strat_stmt_all = select(Strategy).where(Strategy.series_id.in_(series_ids))
    strats_by_series: dict[int, list[dict[str, str]]] = {sid: [] for sid in series_ids}
    for st in session.scalars(strat_stmt_all).all():
        strats_by_series[st.series_id].append({"name_key": st.name_key, "name": st.name})

    # Last ingest: max fill ts per series
    last_ingest: dict[int, datetime | None] = {}
    for sid in series_ids:
        fills = fills_by_series.get(sid, [])
        last_ingest[sid] = max((f.ts for f in fills), default=None) if fills else None

    out: list[SeriesOut] = []
    for s in rows:
        sid = s.id

        # Capital base: net of EXTERNAL movements
        cap = Decimal("0")
        for fm in fm_by_series.get(sid, []):
            if fm.from_bucket == Bucket.EXTERNAL:
                cap += fm.amount
            elif fm.to_bucket == Bucket.EXTERNAL:
                cap -= fm.amount

        # Cumulative PnL: proper round-trip pairing (only closed trades)
        instruments = inst_by_series.get(sid, {})
        fills_list = fills_by_series.get(sid, [])
        cum_pnl = Decimal("0")
        if fills_list:
            rts = pair_fills(fills_list, instruments)
            cum_pnl = sum((rt.net_pnl for rt in rts), Decimal("0"))

        # End capital and return
        end_cap = cap + cum_pnl
        return_pct = (cum_pnl / cap).quantize(Decimal("0.0001")) if cap != 0 else None

        # Sharpe — compute via full metrics pipeline if there are fills
        sharpe_val: str | None = None
        max_dd_val: str | None = None
        max_dd_pct_val: str | None = None
        if fills_list:
            try:
                from app.services.metrics import compute_metrics
                result = compute_metrics(
                    session, sid, "account",
                    strategy=None, symbol=None,
                    date_from=None, date_to=None,
                    trade_view="lot", active_days_only=False,
                )
                sharpe_val = result.metrics.sharpe
                max_dd_val = result.metrics.max_drawdown
                if max_dd_val is not None and cap != 0:
                    max_dd_pct_val = str(Decimal(max_dd_val) / cap)
            except Exception:
                sharpe_val = None
                max_dd_val = None
                max_dd_pct_val = None

        # Trade date range from fill timestamps
        trade_start = min(f.ts for f in fills_list).strftime("%Y-%m-%d") if fills_list else None
        trade_end = max(f.ts for f in fills_list).strftime("%Y-%m-%d") if fills_list else None

        out.append(
            SeriesOut(
                id=s.id,
                name=s.name,
                tag=s.tag,
                base_currency=s.base_currency,
                session_tz=s.session_tz,
                created_at=s.created_at,
                last_ingest_at=last_ingest.get(sid),
                counts=SeriesCounts(
                    strategies=strat_counts.get(sid, 0),
                    instruments=inst_counts.get(sid, 0),
                    fills=fill_counts.get(sid, 0),
                ),
                summary=SeriesSummary(
                    capital_base=str(cap),
                    cumulative_pnl=str(cum_pnl),
                    end_capital=str(end_cap),
                    return_pct=str(return_pct) if return_pct is not None else None,
                    sharpe=sharpe_val,
                    max_drawdown=max_dd_val,
                    max_drawdown_pct=max_dd_pct_val,
                    trade_start=trade_start,
                    trade_end=trade_end,
                ),
                strategies=[
                    StrategyBrief(**s) for s in strats_by_series.get(sid, [])
                ],
            )
        )
    return out


def get_series_detail(session: Session, *, user_id: int, series_id: int) -> SeriesDetailOut:
    series = get_owned_series(session, user_id, series_id)

    strategies = session.scalars(
        select(Strategy.name).where(Strategy.series_id == series_id).order_by(Strategy.name)
    ).all()
    instruments = session.scalars(
        select(Instrument).where(Instrument.series_id == series_id).order_by(Instrument.symbol)
    ).all()
    discovered = session.scalars(
        select(Fill.symbol)
        .where(Fill.series_id == series_id, Fill.voided_at.is_(None))
        .distinct()
        .order_by(Fill.symbol)
    ).all()
    return SeriesDetailOut(
        id=series.id,
        name=series.name,
        tag=series.tag,
        notes=series.notes,
        base_currency=series.base_currency,
        session_tz=series.session_tz,
        created_at=series.created_at,
        strategies=list(strategies),
        instruments=[
            InstrumentDetailOut(
                symbol=i.symbol,
                asset_class=i.asset_class,
                currency=i.currency,
                multiplier=_dec(i.multiplier),
                tick_size=_dec(i.tick_size),
                lot_size=_dec(i.lot_size),
                inferred=i.inferred,
            )
            for i in instruments
        ],
        discovered_symbols=list(discovered),
    )


def _dec(value: Decimal | None) -> str | None:
    return None if value is None else str(value)
