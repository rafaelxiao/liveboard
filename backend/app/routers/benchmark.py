from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user
from app.db import get_db
from app.models.user import User
from app.schemas.benchmark import BenchmarkIn, BenchmarkIngestOut
from app.services.ingestion import IngestionError, ingest_benchmark
from app.services.series import SeriesNotFound, get_owned_series

router = APIRouter(tags=["benchmark"])


@router.post(
    "/series/{series_id}/benchmark",
    status_code=status.HTTP_201_CREATED,
    response_model=BenchmarkIngestOut,
)
def post_benchmark(
    series_id: int,
    body: BenchmarkIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> BenchmarkIngestOut:
    try:
        get_owned_series(db, user.id, series_id)
    except SeriesNotFound as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="series not found"
        ) from err
    try:
        n = ingest_benchmark(db, series_id=series_id, payload=body)
    except IngestionError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(err)
        ) from err
    db.commit()
    return BenchmarkIngestOut(ingested=n)
