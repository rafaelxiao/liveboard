from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models.fund_movement import FundMovement
from app.models.instrument import Instrument
from app.models.strategy import Strategy


class IngestionError(ValueError):
    """Row-level validation failure with a human-readable reason."""


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _normalize_name_key(name: str) -> str:
    return name.strip().lower()


def ensure_utc(ts: datetime) -> datetime:
    if ts.tzinfo is None:
        raise IngestionError("timestamp must be timezone-aware UTC (got naive)")
    if ts.utcoffset() != UTC.utcoffset(None):
        raise IngestionError("timestamp must be UTC")
    return ts.astimezone(UTC)


# ---------------------------------------------------------------------------


def get_or_create_strategy(
    session: Session, series_id: int, name: str, cache: dict[str, int] | None = None
) -> int:
    if cache is None:
        cache = {}
    key = _normalize_name_key(name)
    if key in cache:
        return cache[key]
    row = session.scalar(
        select(Strategy).where(Strategy.series_id == series_id, Strategy.name_key == key)
    )
    if row is not None:
        cache[key] = row.id
        return row.id
    strategy = Strategy(series_id=series_id, name=name.strip(), name_key=key)
    session.add(strategy)
    session.flush()
    cache[key] = strategy.id
    return strategy.id


# ---------------------------------------------------------------------------


def get_or_create_instrument(
    session: Session,
    series_id: int,
    symbol: str,
    base_currency: str,
    cache: set[str] | None = None,
) -> None:
    if cache is None:
        cache = set()
    sym = normalize_symbol(symbol)
    if sym in cache:
        return
    existing = session.scalar(
        select(Instrument).where(Instrument.series_id == series_id, Instrument.symbol == sym)
    )
    if existing is None:
        session.add(
            Instrument(
                series_id=series_id,
                symbol=sym,
                asset_class="equity",
                currency=base_currency,
                multiplier=Decimal("1"),
                inferred=True,
            )
        )
        session.flush()
    cache.add(sym)


def upsert_instruments(session: Session, *, series_id: int, instruments: list) -> int:
    from app.schemas.instrument import InstrumentIn

    n = 0
    for spec in instruments:
        if not isinstance(spec, InstrumentIn):
            spec = InstrumentIn.model_validate(spec)
        sym = normalize_symbol(spec.symbol)
        stmt = (
            pg_insert(Instrument)
            .values(
                series_id=series_id,
                symbol=sym,
                asset_class=str(spec.asset_class),
                currency=spec.currency,
                multiplier=spec.multiplier,
                tick_size=spec.tick_size,
                lot_size=spec.lot_size,
                inferred=False,
            )
            .on_conflict_do_update(
                index_elements=["series_id", "symbol"],
                set_={
                    "asset_class": str(spec.asset_class),
                    "currency": spec.currency,
                    "multiplier": spec.multiplier,
                    "tick_size": spec.tick_size,
                    "lot_size": spec.lot_size,
                    "inferred": False,
                },
            )
        )
        session.execute(stmt)
        n += 1
    session.flush()
    return n


# ---------------------------------------------------------------------------


def ingest_fx_rates(session: Session, *, series_id: int, rates: list) -> int:
    from app.models.fx_rate import FxRate
    from app.schemas.fx import FxRateIn

    for r in rates:
        if not isinstance(r, FxRateIn):
            r = FxRateIn.model_validate(r)
        ensure_utc(r.ts)
        session.add(
            FxRate(
                series_id=series_id,
                ccy_from=r.ccy_from.strip().upper(),
                ccy_to=r.ccy_to.strip().upper(),
                ts=r.ts,
                rate=r.rate,
            )
        )
    session.flush()
    return len(rates)


# ---------------------------------------------------------------------------


def ingest_benchmark(session: Session, *, series_id: int, payload) -> int:
    from app.models.benchmark_return import BenchmarkReturn
    from app.schemas.benchmark import BenchmarkIn

    if not isinstance(payload, BenchmarkIn):
        payload = BenchmarkIn.model_validate(payload)
    for point in payload.returns:
        ensure_utc(point.ts)
        session.add(
            BenchmarkReturn(
                series_id=series_id,
                name=payload.name.strip(),
                ts=point.ts,
                return_pct=point.return_pct,
            )
        )
    session.flush()
    return len(payload.returns)


# ---------------------------------------------------------------------------


def ingest_fund_movements(session: Session, *, series_id: int, movements: list) -> int:
    from app.models.enums import Bucket
    from app.schemas.ingestion import FundMovementIn

    strat_cache: dict[str, int] = {}
    for m in movements:
        if not isinstance(m, FundMovementIn):
            m = FundMovementIn.model_validate(m)
        ensure_utc(m.ts)
        if m.from_bucket == m.to_bucket:
            # Allow STRATEGY → STRATEGY when the strategies differ (inter-strategy transfer)
            if m.from_bucket == Bucket.STRATEGY and m.from_strategy and m.to_strategy and m.from_strategy != m.to_strategy:
                pass  # valid inter-strategy transfer
            else:
                raise IngestionError("from_bucket must differ from to_bucket")
        if m.amount <= 0:
            raise IngestionError("amount must be > 0")
        from_strategy_id = None
        to_strategy_id = None
        if m.from_bucket == Bucket.STRATEGY:
            if not m.from_strategy:
                raise IngestionError("from_strategy required when from_bucket is STRATEGY")
            from_strategy_id = get_or_create_strategy(
                session, series_id, m.from_strategy, strat_cache
            )
        if m.to_bucket == Bucket.STRATEGY:
            if not m.to_strategy:
                raise IngestionError("to_strategy required when to_bucket is STRATEGY")
            to_strategy_id = get_or_create_strategy(session, series_id, m.to_strategy, strat_cache)

        # Upsert by client_movement_id
        existing = session.scalar(
            select(FundMovement).where(
                FundMovement.series_id == series_id,
                FundMovement.client_movement_id == m.client_movement_id,
                FundMovement.voided_at.is_(None),
            )
        )
        if existing is not None:
            existing.ts = m.ts
            existing.currency = m.currency.strip().upper()
            existing.amount = m.amount
            existing.from_bucket = str(m.from_bucket)
            existing.to_bucket = str(m.to_bucket)
            existing.from_strategy_id = from_strategy_id
            existing.from_strategy_name = m.from_strategy
            existing.to_strategy_id = to_strategy_id
            existing.to_strategy_name = m.to_strategy
            existing.updated_at = datetime.now(UTC)
        else:
            session.add(
                FundMovement(
                    series_id=series_id,
                    client_movement_id=m.client_movement_id,
                    ts=m.ts,
                    currency=m.currency.strip().upper(),
                    amount=m.amount,
                    from_bucket=str(m.from_bucket),
                    to_bucket=str(m.to_bucket),
                    from_strategy_id=from_strategy_id,
                    from_strategy_name=m.from_strategy,
                    to_strategy_id=to_strategy_id,
                    to_strategy_name=m.to_strategy,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
    session.flush()
    return len(movements)


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------

FILLS_BATCH_CAP = 10_000


def ingest_fills_batch(
    session: Session,
    *,
    series_id: int,
    base_currency: str,
    fills: list,
    api_key_id: int | None = None,
) -> dict:
    from app.models.enums import IngestionKind
    from app.models.fill import Fill
    from app.models.ingestion_batch import IngestionBatch
    from app.schemas.ingestion import BatchError, FillIn

    if len(fills) > FILLS_BATCH_CAP:
        from app.core.errors import PayloadTooLargeError

        raise PayloadTooLargeError(f"batch size {len(fills)} exceeds cap of {FILLS_BATCH_CAP}")

    inst_cache: set[str] = set()
    strat_cache: dict[str, int] = {}
    errors: list[BatchError] = []
    inserted = 0
    updated = 0

    batch = IngestionBatch(
        series_id=series_id,
        api_key_id=api_key_id,
        received_at=datetime.now(UTC),
        kind=str(IngestionKind.FILLS),
    )
    session.add(batch)
    session.flush()

    valid_rows: list[tuple[int, FillIn]] = []
    for idx, raw in enumerate(fills):
        try:
            if not isinstance(raw, FillIn):
                fill = FillIn.model_validate(raw)
            else:
                fill = raw
        except Exception as exc:
            errors.append(BatchError(row=idx, client_fill_id=None, message=str(exc)))
            continue
        if fill.qty <= 0:
            errors.append(
                BatchError(row=idx, client_fill_id=fill.client_fill_id, message="qty must be > 0")
            )
            continue
        try:
            ensure_utc(fill.ts)
        except IngestionError as exc:
            errors.append(BatchError(row=idx, client_fill_id=fill.client_fill_id, message=str(exc)))
            continue
        valid_rows.append((idx, fill))

    for _idx, fill in valid_rows:
        sym = normalize_symbol(fill.symbol)
        get_or_create_instrument(session, series_id, sym, base_currency, inst_cache)
        strat_id = get_or_create_strategy(session, series_id, fill.strategy, strat_cache)

        existing = session.scalar(
            select(Fill).where(
                Fill.series_id == series_id,
                Fill.client_fill_id == fill.client_fill_id,
                Fill.voided_at.is_(None),
            )
        )
        if existing is not None:
            existing.strategy_id = strat_id
            existing.symbol = sym
            existing.side = str(fill.side)
            existing.qty = fill.qty
            existing.price = fill.price
            existing.commission = fill.commission
            existing.exchange_fee = fill.exchange_fee
            existing.regulatory_fee = fill.regulatory_fee
            existing.financing_fee = fill.financing_fee
            existing.ts = fill.ts
            existing.signal_id = fill.signal_id
            existing.position_effect = str(fill.position_effect) if fill.position_effect else None
            existing.updated_at = datetime.now(UTC)
            updated += 1
        else:
            session.add(
                Fill(
                    series_id=series_id,
                    strategy_id=strat_id,
                    symbol=sym,
                    side=str(fill.side),
                    qty=fill.qty,
                    price=fill.price,
                    commission=fill.commission,
                    exchange_fee=fill.exchange_fee,
                    regulatory_fee=fill.regulatory_fee,
                    financing_fee=fill.financing_fee,
                    ts=fill.ts,
                    client_fill_id=fill.client_fill_id,
                    signal_id=fill.signal_id,
                    position_effect=str(fill.position_effect) if fill.position_effect else None,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
            )
            inserted += 1

    session.flush()

    rejected = len(errors)
    batch.inserted = inserted
    batch.updated = updated
    batch.rejected = rejected

    return {
        "inserted": inserted,
        "updated": updated,
        "rejected": rejected,
        "errors": errors,
        "batch_id": batch.id,
    }


def void_fills(
    session: Session,
    *,
    series_id: int,
    client_fill_ids: list[str],
) -> int:
    from app.models.fill import Fill

    n = 0
    now = datetime.now(UTC)
    for cid in client_fill_ids:
        row = session.scalar(
            select(Fill).where(
                Fill.series_id == series_id,
                Fill.client_fill_id == cid,
                Fill.voided_at.is_(None),
            )
        )
        if row is not None:
            row.voided_at = now
            n += 1
    session.flush()
    return n


def void_fills_by_strategy(
    session: Session,
    *,
    series_id: int,
    strategy_name_key: str,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> int:
    """Void all non-voided fills for a given strategy within a series.

    Useful for idempotent re-uploads: void the old run's fills by strategy,
    then ingest the new run.
    """
    from app.models.fill import Fill
    from app.models.strategy import Strategy

    strat = session.scalar(
        select(Strategy).where(
            Strategy.series_id == series_id,
            Strategy.name_key == strategy_name_key,
        )
    )
    if strat is None:
        return 0

    q = (
        update(Fill)
        .where(
            Fill.series_id == series_id,
            Fill.strategy_id == strat.id,
            Fill.voided_at.is_(None),
        )
    )
    if date_from is not None:
        q = q.where(Fill.ts >= date_from)
    if date_to is not None:
        q = q.where(Fill.ts <= date_to)

    now = datetime.now(UTC)
    result = session.execute(q.values(voided_at=now))
    session.flush()
    return result.rowcount or 0
