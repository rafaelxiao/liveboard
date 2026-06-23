from fastapi import APIRouter, Depends, HTTPException, status
from decimal import Decimal
from sqlalchemy.orm import Session

from app.core.deps import get_api_user, get_current_user
from app.db import get_db
from app.models.series import Series
from app.models.user import User
from app.schemas.series import SeriesCreateIn, SeriesDetailOut, SeriesOut
from app.schemas.validation import ValidationConfigIn, ValidationConfigOut
from app.services.series import (
    SeriesNotFound,
    create_series,
    get_series_detail,
    list_series,
)
from app.services.validation import _get_config as resolve_validation_config

router = APIRouter(tags=["series"])


@router.post("/series", status_code=status.HTTP_201_CREATED)
def post_series(
    body: SeriesCreateIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_api_user),
) -> dict:
    series_id = create_series(db, user_id=user.id, data=body)
    db.commit()
    return {"series_id": series_id}


@router.get("/series", response_model=list[SeriesOut])
def get_series_list(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SeriesOut]:
    return list_series(db, user_id=user.id)


@router.get("/series/{series_id}", response_model=SeriesDetailOut)
def get_series_one(
    series_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SeriesDetailOut:
    try:
        return get_series_detail(db, user_id=user.id, series_id=series_id)
    except SeriesNotFound as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="series not found"
        ) from err


@router.get("/series/{series_id}/validation-config", response_model=ValidationConfigOut)
def get_validation_config(
    series_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ValidationConfigOut:
    series = db.get(Series, series_id)
    if series is None or series.user_id != user.id:
        raise HTTPException(status_code=404, detail="series not found")
    cfg = resolve_validation_config(series)
    return ValidationConfigOut(**cfg)


@router.patch("/series/{series_id}/validation-config", response_model=ValidationConfigOut)
def update_validation_config(
    series_id: int,
    body: ValidationConfigIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ValidationConfigOut:
    series = db.get(Series, series_id)
    if series is None or series.user_id != user.id:
        raise HTTPException(status_code=404, detail="series not found")

    current = series.validation_config or {}
    update = body.model_dump(exclude_none=True)
    # Convert Decimals to strings for JSONB storage
    merged = {
        **current,
        **{k: str(v) if isinstance(v, Decimal) else v for k, v in update.items()},
    }
    series.validation_config = merged
    db.commit()

    cfg = resolve_validation_config(series)
    return ValidationConfigOut(**cfg)
