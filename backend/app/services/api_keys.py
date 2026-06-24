from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AuthError, NotFoundError
from app.core.security import generate_api_key, hash_api_key
from app.models.api_key import ApiKey
from app.models.user import User


def create_api_key(session: Session, user: User, name: str) -> tuple[ApiKey, str]:
    full_key, prefix = generate_api_key()
    row = ApiKey(user_id=user.id, name=name, key_hash=hash_api_key(full_key), prefix=prefix)
    session.add(row)
    session.flush()
    return row, full_key


def list_api_keys(session: Session, user: User) -> list[ApiKey]:
    return list(
        session.scalars(
            select(ApiKey).where(
                ApiKey.user_id == user.id,
                ApiKey.revoked_at.is_(None),
            ).order_by(ApiKey.created_at)
        )
    )


def revoke_api_key(session: Session, user: User, key_id: int) -> None:
    row = session.scalar(select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == user.id))
    if row is None:
        raise NotFoundError("api key not found")
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        session.flush()


def resolve_api_key(session: Session, full_key: str) -> User:
    key_hash = hash_api_key(full_key)
    row = session.scalar(
        select(ApiKey).where(ApiKey.key_hash == key_hash, ApiKey.revoked_at.is_(None))
    )
    if row is None:
        raise AuthError("invalid api key")
    row.last_used_at = datetime.now(UTC)
    session.flush()
    user = session.get(User, row.user_id)
    if user is None:
        raise AuthError("invalid api key")
    return user
