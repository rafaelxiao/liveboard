import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.models.series import Series
from app.models.share_link import ShareLink
from app.schemas.series import ShareLinkOut


def _make_token() -> str:
    return secrets.token_urlsafe(24)


def create_share_link(
    session: Session,
    *,
    user_id: int,
    series_id: int,
    expires_in_days: int | None = None,
    pnl_color_scheme: str | None = None,
    trade_grouping: str = "day",
    lang: str | None = None,
    custom_slug: str | None = None,
    date_from: datetime | None = None,
    base_url: str = "",
) -> ShareLinkOut:
    series = session.get(Series, series_id)
    if series is None or series.user_id != user_id:
        raise NotFoundError("series not found")

    # Validate custom slug
    token = _make_token()
    slug = None
    if custom_slug:
        slug = custom_slug.strip()
        if not slug or len(slug) > 64 or not slug.replace("-", "").replace("_", "").isalnum():
            raise ValueError("custom_slug must be 1-64 alphanumeric chars, hyphens, or underscores")
        existing = session.scalar(
            select(ShareLink).where(
                ShareLink.slug == slug,
                ShareLink.revoked_at.is_(None),
            )
        )
        if existing:
            raise ValueError(f"'{slug}' is already in use")

    expires_at = (
        datetime.now(UTC) + timedelta(days=expires_in_days)
        if expires_in_days
        else None
    )
    row = ShareLink(
        series_id=series_id,
        user_id=user_id,
        token=token,
        slug=slug,
        expires_at=expires_at,
        pnl_color_scheme=pnl_color_scheme,
        trade_grouping=trade_grouping,
        lang=lang,
        date_from=date_from,
    )
    session.add(row)
    session.flush()

    return ShareLinkOut(
        id=row.id,
        token=row.token,
        slug=row.slug,
        expires_at=row.expires_at,
        created_at=row.created_at,
        last_accessed_at=None,
        url=f"{base_url.rstrip('/')}/share/{slug or token}",
    )


def list_share_links(session: Session, *, user_id: int, series_id: int) -> list[ShareLinkOut]:
    series = session.get(Series, series_id)
    if series is None or series.user_id != user_id:
        raise NotFoundError("series not found")

    rows = session.scalars(
        select(ShareLink)
        .where(ShareLink.series_id == series_id, ShareLink.revoked_at.is_(None))
        .order_by(ShareLink.created_at.desc())
    ).all()

    return [
        ShareLinkOut(
            id=r.id,
            token=r.token,
            slug=r.slug,
            expires_at=r.expires_at,
            created_at=r.created_at,
            last_accessed_at=r.last_accessed_at,
            url=f"",
        )
        for r in rows
    ]


def revoke_share_link(session: Session, *, user_id: int, series_id: int, link_id: int) -> None:
    row = session.scalar(
        select(ShareLink).where(
            ShareLink.id == link_id,
            ShareLink.series_id == series_id,
            ShareLink.user_id == user_id,
        )
    )
    if row is None:
        raise NotFoundError("share link not found")
    row.revoked_at = datetime.now(UTC)
    session.flush()


def resolve_share_link(session: Session, token: str) -> ShareLink:
    """Validate token/slug and return the share link."""
    row = session.scalar(
        select(ShareLink).where(
            (ShareLink.token == token) | (ShareLink.slug == token),
            ShareLink.revoked_at.is_(None),
        )
    )
    if row is None:
        raise NotFoundError("share link not found or revoked")

    if row.expires_at is not None and row.expires_at < datetime.now(UTC):
        raise NotFoundError("share link expired")

    row.last_accessed_at = datetime.now(UTC)
    session.flush()
    return row
