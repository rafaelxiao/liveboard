from datetime import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.db import get_db
from app.models.user import User
from app.schemas.series import ShareLinkCreateIn, ShareLinkOut, SharedSeriesOut
from app.services import series as series_service
from app.services import share_links
from app.services.metrics import compute_metrics

router = APIRouter(prefix="/series", tags=["share"])


# ── Bulk listing (must come before parameterized routes) ──

def list_all_shares(
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    request: Request = None,
):
    """List all share links across all series owned by the user."""
    from app.models.series import Series
    from sqlalchemy import select as sa_select

    rows = session.execute(
        sa_select(Series.id, Series.name).where(Series.user_id == user.id)
    ).all()
    series_names = {row[0]: row[1] for row in rows}

    base_url = str(request.base_url).rstrip("/") if request else ""
    all_links: list[ShareLinkOut] = []
    for sid, sname in series_names.items():
        links = share_links.list_share_links(session, user_id=user.id, series_id=sid)
        for link in links:
            all_links.append(ShareLinkOut(
                id=link.id,
                token=link.token,
                slug=link.slug,
                series_id=sid,
                series_name=sname,
                expires_at=link.expires_at,
                created_at=link.created_at,
                last_accessed_at=link.last_accessed_at,
                url=f"{base_url}/share/{link.slug or link.token}",
            ))
    return all_links


# ── Per-series share links ──

@router.post("/{series_id}/shares", response_model=ShareLinkOut)
def create_share(
    series_id: int,
    body: ShareLinkCreateIn,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    request: Request = None,
):
    base_url = str(request.base_url).rstrip("/") if request else ""
    result = share_links.create_share_link(
        session,
        user_id=user.id,
        series_id=series_id,
        expires_in_days=body.expires_in_days,
        pnl_color_scheme=body.pnl_color_scheme,
        trade_grouping=body.trade_grouping or "day",
        lang=body.lang,
        custom_slug=body.custom_slug,
        date_from=dt.fromisoformat(body.date_from) if body.date_from else None,
        base_url=base_url,
    )
    session.commit()
    return result


@router.get("/{series_id}/shares", response_model=list[ShareLinkOut])
def list_shares(
    series_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
    request: Request = None,
):
    base_url = str(request.base_url).rstrip("/") if request else ""
    links = share_links.list_share_links(session, user_id=user.id, series_id=series_id)
    for link in links:
        link.url = f"{base_url}/share/{link.slug or link.token}"
    return links


@router.delete("/{series_id}/shares/{link_id}", status_code=204)
def revoke_share(
    series_id: int,
    link_id: int,
    user: User = Depends(get_current_user),
    session: Session = Depends(get_db),
):
    share_links.revoke_share_link(
        session, user_id=user.id, series_id=series_id, link_id=link_id
    )
    session.commit()


# ── Public endpoint (no auth) ──

public_router = APIRouter(tags=["share-public"])


@public_router.get("/share/{token}", response_model=SharedSeriesOut)
def view_shared(token: str, session: Session = Depends(get_db)):
    link = share_links.resolve_share_link(session, token)

    series_list = series_service.list_series(session, user_id=link.user_id)
    series_out = next((so for so in series_list if so.id == link.series_id), None)
    if series_out is None:
        from app.core.errors import NotFoundError
        raise NotFoundError("series not found")

    # If start date is set, compute capital base at START of that day (PnL up to prev day)
    if link.date_from:
        try:
            from datetime import timedelta
            pre_date = link.date_from.date() - timedelta(days=1)
            pre_result = compute_metrics(
                session, link.series_id, "account",
                date_from=None, date_to=pre_date,
                trade_view="lot", trade_grouping=link.trade_grouping or "day",
            )
            pre_pnl = Decimal(pre_result.metrics.net_pnl or "0")
            base_cap = Decimal(series_out.summary.capital_base or "0")
            start_cap = base_cap + pre_pnl
            series_out.summary.capital_base = str(start_cap)
        except Exception:
            pass

    try:
        result = compute_metrics(
            session,
            link.series_id,
            "account",
            strategy=None,
            symbol=None,
            date_from=link.date_from.date() if link.date_from else None,
            date_to=None,
            trade_view="lot",
            trade_grouping=link.trade_grouping or "day",
        )
        metrics_dict = {
            "meta": result.meta.model_dump(),
            "metrics": result.metrics.model_dump(),
            "equity_curve": [p.model_dump() for p in result.equity_curve],
            "drawdown_series": [p.model_dump() for p in result.drawdown_series],
        }
    except Exception:
        metrics_dict = None

    return SharedSeriesOut(
        series=series_out,
        metrics=metrics_dict,
        pnl_color_scheme=link.pnl_color_scheme,
        lang=link.lang,
    )
