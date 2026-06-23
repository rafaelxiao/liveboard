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
)
from app.services.series import get_owned_series
from app.services.validation import validate_fills_batch
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


@router.post("/fund-movements", status_code=status.HTTP_201_CREATED, response_model=FundIngestOut)
def fund_movements(
    series_id: int,
    body: list[FundMovementIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
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
