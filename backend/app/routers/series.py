from fastapi import APIRouter, Depends, HTTPException, status
from decimal import Decimal
from sqlalchemy.orm import Session

from app.core.deps import get_api_user, get_current_user, get_user
from app.db import get_db
from app.models.series import Series
from app.models.user import User
from app.schemas.series import FillOut, StrategyCapital, SeriesCapitalOut, SeriesCreateIn, SeriesDetailOut, SeriesOut
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
    user: User = Depends(get_user),
) -> list[SeriesOut]:
    return list_series(db, user_id=user.id)


@router.get("/series/{series_id}", response_model=SeriesDetailOut)
def get_series_one(
    series_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_user),
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
    user: User = Depends(get_user),
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
    user: User = Depends(get_user),
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


@router.get("/series/{series_id}/fills")
def list_fills(
    series_id: int,
    strategy_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 1000,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: User = Depends(get_user),
) -> list[FillOut]:
    """List fills for a series, with optional strategy and date filtering."""
    from sqlalchemy import select
    from app.models.fill import Fill
    from app.models.strategy import Strategy

    series = db.get(Series, series_id)
    if series is None or (series.user_id != user.id and user.role != "admin"):
        raise HTTPException(status_code=404, detail="series not found")

    # Resolve strategy filter
    strategy_id = None
    if strategy_name:
        st = db.execute(
            select(Strategy).where(
                Strategy.series_id == series_id, Strategy.name_key == strategy_name
            )
        ).scalar_one_or_none()
        if st is None:
            raise HTTPException(status_code=404, detail="strategy not found")
        strategy_id = st.id

    # Build query
    stmt = select(Fill).where(Fill.series_id == series_id, Fill.voided_at.is_(None))
    if strategy_id:
        stmt = stmt.where(Fill.strategy_id == strategy_id)
    if date_from:
        stmt = stmt.where(Fill.ts >= date_from)
    if date_to:
        stmt = stmt.where(Fill.ts < date_to)
    stmt = stmt.order_by(Fill.ts.asc()).offset(offset).limit(limit)

    fills = db.execute(stmt).scalars().all()

    # Load strategy names
    st_ids = {f.strategy_id for f in fills}
    strat_names = {}
    if st_ids:
        for st in db.execute(select(Strategy).where(Strategy.id.in_(st_ids))).scalars():
            strat_names[st.id] = st.name_key

    return [
        FillOut(
            id=f.id,
            strategy_name=strat_names.get(f.strategy_id, "unknown"),
            symbol=f.symbol,
            side=f.side,
            qty=str(f.qty),
            price=str(f.price),
            commission=str(f.commission),
            ts=f.ts,
            client_fill_id=f.client_fill_id,
            signal_id=f.signal_id,
        )
        for f in fills
    ]


@router.get("/series/{series_id}/capital")
def get_capital(
    series_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_user),
) -> SeriesCapitalOut:
    """Current capital snapshot: free cash, per-strategy allocation, account total."""
    from datetime import datetime, timezone
    from sqlalchemy import select
    from app.models.strategy import Strategy
    from app.models.fill import Fill
    from app.models.instrument import Instrument
    from app.services.capital import free_cash, strategy_base, account_base
    from app.services.pairing import pair_fills

    series = db.get(Series, series_id)
    if series is None or (series.user_id != user.id and user.role != "admin"):
        raise HTTPException(status_code=404, detail="series not found")

    now = datetime.now(timezone.utc)
    fc = free_cash(db, series_id, None)
    acct = account_base(db, series_id, None)

    strategies: list[StrategyCapital] = []
    stmts = db.execute(select(Strategy).where(Strategy.series_id == series_id)).scalars().all()

    # Load instruments once
    instruments = {i.symbol: i for i in db.execute(select(Instrument).where(Instrument.series_id == series_id)).scalars()}

    for st in stmts:
        cap = strategy_base(db, series_id, st.id, None)
        fills = db.execute(select(Fill).where(
            Fill.series_id == series_id, Fill.strategy_id == st.id, Fill.voided_at.is_(None)
        )).scalars().all()
        rts = pair_fills(fills, instruments)
        total_pnl = sum(rt.net_pnl for rt in rts)
        net_value = cap + total_pnl
        strategies.append(StrategyCapital(
            strategy_id=st.id,
            name_key=st.name_key,
            name=st.name,
            capital=str(cap),
            pnl=str(total_pnl),
            net_value=str(net_value),
        ))

    return SeriesCapitalOut(
        free_cash=str(fc.quantize(Decimal("0.01"))),
        strategies=strategies,
        account_total=str(acct.quantize(Decimal("0.01"))),
    )
