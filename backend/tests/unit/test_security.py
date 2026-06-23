import time

import jwt
import pytest
from app.core.errors import AuthError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)


def test_hash_password_is_not_plaintext_and_verifies():
    h = hash_password("s3cret-pw")
    assert h != "s3cret-pw"
    assert h.startswith("$2")  # bcrypt prefix ($2a/$2b)
    assert verify_password("s3cret-pw", h) is True
    assert verify_password("wrong", h) is False


def test_hash_password_is_salted():
    assert hash_password("same") != hash_password("same")


def test_access_token_roundtrip():
    tok = create_access_token(subject=42)
    claims = decode_token(tok)
    assert claims["sub"] == "42"
    assert claims["type"] == "access"


def test_refresh_token_carries_refresh_type():
    claims = decode_token(create_refresh_token(subject=7))
    assert claims["sub"] == "7"
    assert claims["type"] == "refresh"


def test_decode_rejects_garbage():
    with pytest.raises(AuthError):
        decode_token("not.a.jwt")


def test_decode_rejects_expired(monkeypatch):
    from app.core import security

    tok = jwt.encode(
        {"sub": "1", "type": "access", "exp": int(time.time()) - 10},
        security.settings.JWT_SECRET,
        algorithm=security.settings.JWT_ALGORITHM,
    )
    with pytest.raises(AuthError):
        decode_token(tok)
