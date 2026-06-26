import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user
from app.db import get_db

logger = logging.getLogger(__name__)
from app.models.user import User
from app.schemas.ingestion import (
    BatchResultOut,
    FillBatchIn,
    FundIngestOut,
    FundMovementIn,
    VoidFillsIn,
    VoidOut,
)
from app.services.ingestion import (
    IngestionError,
    ingest_fills_batch,
    ingest_fund_movements,
    void_fills,
    void_fills_by_strategy,
)
from app.services.series import get_owned_series
from app.services.validation import validate_fills_batch
from app.core.deps import get_user
from app.models.fund_movement import FundMovement
from app.models.strategy import Strategy
from app.schemas.ingestion import FillIn

router = APIRouter(prefix="/series/{series_id}", tags=["ingestion"])


def _owned_series(series_id: int, db: Session, user: User):
    return get_owned_series(db, user_id=user.id, series_id=series_id)


@router.post("/fills:batch", response_model=BatchResultOut)
def fills_batch(
    series_id: int,
    body: FillBatchIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> BatchResultOut:
    series = _owned_series(series_id, db, user)

    # Validate fills before ingestion
    fill_objects: list[FillIn] = []
    for raw in body.fills:
        try:
            fill_objects.append(raw if isinstance(raw, FillIn) else FillIn.model_validate(raw))
        except (ValueError, TypeError):
            logger.warning("Invalid fill skipped", exc_info=True)

    errors = validate_fills_batch(db, series_id, fill_objects)
    if errors:
        detail_msg = f"Batch rejected: {len(errors)} fills violate limits: " + ", ".join(
            f"{e.client_fill_id} (rule={e.rule})" for e in errors
        )
        raise HTTPException(status_code=422, detail=detail_msg)

    result = ingest_fills_batch(
        db,
        series_id=series.id,
        base_currency=series.base_currency,
        fills=body.fills,
    )
    db.commit()
    return BatchResultOut(
        inserted=result["inserted"],
        updated=result["updated"],
        rejected=result["rejected"],
        errors=result["errors"],
        batch_id=result["batch_id"],
    )


@router.post("/fills:void", response_model=VoidOut)
def fills_void(
    series_id: int,
    body: VoidFillsIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> VoidOut:
    series = _owned_series(series_id, db, user)
    count = void_fills(db, series_id=series.id, client_fill_ids=body.client_fill_ids)
    db.commit()
    return VoidOut(voided=count)


@router.delete("/fills", response_model=VoidOut)
def delete_fills_by_strategy(
    series_id: int,
    strategy: str,
    date_from: str | None = None,
    date_to: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> VoidOut:
    """Void all fills for a strategy within a series.

    Example:
      DELETE /v1/series/5/fills?strategy=vwap_intra_day_1&date_from=2026-06-01
    """
    from datetime import datetime as dt

    series = _owned_series(series_id, db, user)
    df = dt.fromisoformat(date_from) if date_from else None
    dt_ = dt.fromisoformat(date_to) if date_to else None

    count = void_fills_by_strategy(
        db,
        series_id=series.id,
        strategy_name_key=strategy,
        date_from=df,
        date_to=dt_,
    )
    db.commit()
    return VoidOut(voided=count)


@router.get("/fund-movements")
def get_fund_movements(
    series_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_user),
):
    series = _owned_series(series_id, db, user)
    from sqlalchemy import select
    rows = db.scalars(
        select(FundMovement).where(
            FundMovement.series_id == series.id,
            FundMovement.voided_at.is_(None),
        ).order_by(FundMovement.ts)
    ).all()
    # Resolve strategy names
    strat_ids = set()
    for fm in rows:
        if fm.from_strategy_id:
            strat_ids.add(fm.from_strategy_id)
        if fm.to_strategy_id:
            strat_ids.add(fm.to_strategy_id)
    strats = {s.id: s.name for s in db.scalars(select(Strategy).where(Strategy.id.in_(strat_ids))).all()} if strat_ids else {}

    return [
        {
            "client_movement_id": fm.client_movement_id,
            "ts": fm.ts.isoformat(),
            "currency": fm.currency,
            "from_bucket": fm.from_bucket,
            "to_bucket": fm.to_bucket,
            "from_strategy": strats.get(fm.from_strategy_id) if fm.from_strategy_id else None,
            "to_strategy": strats.get(fm.to_strategy_id) if fm.to_strategy_id else None,
            "amount": str(fm.amount),
        }
        for fm in rows
    ]


@router.post("/fund-movements", status_code=status.HTTP_201_CREATED, response_model=FundIngestOut)
def fund_movements(
    series_id: int,
    body: list[FundMovementIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_user),
) -> FundIngestOut:
    series = _owned_series(series_id, db, user)
    try:
        n = ingest_fund_movements(db, series_id=series.id, movements=body)
        db.commit()
    except IngestionError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return FundIngestOut(ingested=n)
