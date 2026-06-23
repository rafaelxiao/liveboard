from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db import get_db
from app.models.user import User
from app.schemas.metrics import MetricsEnvelope
from app.services.metrics import compute_metrics
from app.services.series import SeriesNotFound, get_owned_series

router = APIRouter(tags=["metrics"])


@router.get("/series/{series_id}/metrics", response_model=MetricsEnvelope)
def get_metrics(
    series_id: int,
    level: str = Query("account"),
    strategy: str | None = Query(None),
    symbol: str | None = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    trade_view: str = Query("lot"),
    active_days_only: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> MetricsEnvelope:
    try:
        get_owned_series(db, user.id, series_id)
    except SeriesNotFound as err:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="series not found"
        ) from err

    from datetime import date

    df = date.fromisoformat(date_from) if date_from else None
    dt = date.fromisoformat(date_to) if date_to else None

    return compute_metrics(
        db,
        series_id,
        level,
        strategy=strategy,
        symbol=symbol,
        date_from=df,
        date_to=dt,
        trade_view=trade_view,
        active_days_only=active_days_only,
    )
