from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user
from app.db import get_db
from app.models.user import User
from app.schemas.instrument import InstrumentIn, InstrumentUpsertOut
from app.services.ingestion import upsert_instruments
from app.services.series import SeriesNotFound, get_owned_series

router = APIRouter(tags=["instruments"])


@router.post(
    "/series/{series_id}/instruments",
    status_code=status.HTTP_201_CREATED,
    response_model=InstrumentUpsertOut,
)
def post_instruments(
    series_id: int,
    body: list[InstrumentIn],
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> InstrumentUpsertOut:
    try:
        get_owned_series(db, user_id=user.id, series_id=series_id)
    except SeriesNotFound as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="series not found"
        ) from err
    n = upsert_instruments(db, series_id=series_id, instruments=body)
    db.commit()
    return InstrumentUpsertOut(upserted=n)
