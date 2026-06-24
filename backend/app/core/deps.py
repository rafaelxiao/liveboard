from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.core.errors import AuthError, ForbiddenError
from app.core.security import decode_token
from app.db import get_db
from app.models.user import User


def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise AuthError("missing or malformed authorization")
    token = authorization.removeprefix("Bearer ")
    claims = decode_token(token)
    if claims.get("type") != "access":
        raise AuthError("not an access token")
    user_id = int(claims["sub"])
    user = db.get(User, user_id)
    if user is None:
        raise AuthError("user not found")
    return user


def require_admin(current: User = Depends(get_current_user)) -> User:
    if current.role != "admin":
        raise ForbiddenError("admin only")
    return current


def require_approved(current: User = Depends(get_current_user)) -> User:
    if current.status != "approved":
        raise ForbiddenError("awaiting approval")
    return current


def get_api_user(
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not x_api_key:
        raise AuthError("missing X-API-Key")
    from app.services import api_keys as api_keys_service

    return api_keys_service.resolve_api_key(db, x_api_key)


def get_user(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Accept either Bearer JWT or X-API-Key header."""
    if authorization and authorization.startswith("Bearer "):
        return get_current_user(authorization=authorization, db=db)
    if x_api_key:
        return get_api_user(x_api_key=x_api_key, db=db)
    raise AuthError("missing Authorization or X-API-Key header")
