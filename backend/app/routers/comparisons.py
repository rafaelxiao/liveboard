from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.comparison import ComparisonIn, ComparisonOut
from app.services.comparison import compare

router = APIRouter(tags=["comparisons"])


@router.post("/comparisons", response_model=ComparisonOut)
def post_comparison(
    body: ComparisonIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ComparisonOut:
    return compare(
        session=db,
        user_id=user.id,
        series_ids=body.series_ids,
        level=body.level,
        strategy_keys=[sk.model_dump() for sk in body.strategy_keys] if body.strategy_keys else None,
        baseline_entity_index=body.baseline_entity_index,
        baseline_series_id=body.baseline_series_id,
        date_from=body.date_from,
        date_to=body.date_to,
        trade_view=body.trade_view,
        per_trade_page=body.per_trade_page,
        per_trade_page_size=body.per_trade_page_size,
    )
