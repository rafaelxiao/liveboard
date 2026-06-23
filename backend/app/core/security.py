from datetime import UTC, datetime, timedelta

import jwt
from passlib.context import CryptContext

from app.core.config import settings
from app.core.errors import AuthError

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


def _encode(
    subject: str | int,
    token_type: str,
    expires_delta: timedelta,
    extra: dict | None = None,
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(subject),
        "type": token_type,
        "iat": int(now.timestamp()),
        "exp": int((now + expires_delta).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str | int, extra: dict | None = None) -> str:
    return _encode(subject, "access", timedelta(minutes=settings.ACCESS_TOKEN_TTL_MIN), extra)


def create_refresh_token(subject: str | int) -> str:
    return _encode(subject, "refresh", timedelta(days=settings.REFRESH_TOKEN_TTL_DAYS))


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise AuthError("invalid or expired token") from exc


import hashlib  # noqa: E402
import hmac  # noqa: E402
import secrets  # noqa: E402

_API_KEY_PREFIX = "lbk_"


def generate_api_key() -> tuple[str, str]:
    body = secrets.token_urlsafe(32)
    full = f"{_API_KEY_PREFIX}{body}"
    prefix = full[:12]  # "lbk_" + first 8 url-safe chars (non-secret)
    return full, prefix


def hash_api_key(full_key: str) -> str:
    return hashlib.sha256(full_key.encode()).hexdigest()


def verify_api_key(full_key: str, key_hash: str) -> bool:
    return hmac.compare_digest(hash_api_key(full_key), key_hash)
