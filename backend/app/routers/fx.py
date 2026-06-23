from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user
from app.db import get_db
from app.models.user import User
from app.schemas.fx import FxIngestOut, FxRateIn
from app.services.ingestion import IngestionError, ingest_fx_rates
from app.services.series import SeriesNotFound, get_owned_series

router = APIRouter(tags=["fx"])


@router.post(
    "/series/{series_id}/fx-rates",
    status_code=status.HTTP_201_CREATED,
    response_model=FxIngestOut,
)
def post_fx_rates(
    series_id: int,
    body: list[FxRateIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> FxIngestOut:
    try:
        get_owned_series(db, user.id, series_id)
    except SeriesNotFound as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="series not found"
        ) from err
    try:
        n = ingest_fx_rates(db, series_id=series_id, rates=body)
    except IngestionError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(err)
        ) from err
    db.commit()
    return FxIngestOut(ingested=n)
