# backend/tests/api/test_admin.py
import importlib

import pytest
from app.core.deps import require_admin, require_approved
from app.core.errors import ForbiddenError
from app.core.security import hash_password, verify_password
from app.models.user import User
from app.services.users import seed_admin
from sqlalchemy import select


def test_require_admin_blocks_non_admin():
    user = User(email="x@e.com", password_hash="h", role="user", status="approved")
    with pytest.raises(ForbiddenError):
        require_admin(current=user)


def test_require_admin_allows_admin():
    admin = User(email="a@e.com", password_hash="h", role="admin", status="approved")
    assert require_admin(current=admin) is admin


def test_require_approved_blocks_pending():
    user = User(email="p@e.com", password_hash="h", role="user", status="pending")
    with pytest.raises(ForbiddenError):
        require_approved(current=user)


# --- Admin endpoint tests (Task 8) ---


def _make_admin(db_session, client):
    admin = User(
        email="admin@e.com",
        password_hash=hash_password("adminpw"),
        role="admin",
        status="approved",
    )
    db_session.add(admin)
    db_session.flush()
    tokens = client.post("/auth/login", json={"email": "admin@e.com", "password": "adminpw"}).json()
    return tokens["access_token"]


def _register(client, email, pw="pw12345"):
    return client.post("/auth/register", json={"email": email, "password": pw})


def test_admin_only_enforced(client, db_session):
    _register(client, "regular@e.com")
    db_session.query(User).filter_by(email="regular@e.com").one().status = "approved"
    db_session.flush()
    tokens = client.post(
        "/auth/login", json={"email": "regular@e.com", "password": "pw12345"}
    ).json()
    r = client.get("/admin/users", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert r.status_code == 403


def test_admin_approve_then_pending_user_can_login(client, db_session):
    token = _make_admin(db_session, client)
    _register(client, "joiner@e.com")
    uid = db_session.query(User).filter_by(email="joiner@e.com").one().id
    r = client.post(
        f"/admin/users/{uid}/approve",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 204
    login = client.post("/auth/login", json={"email": "joiner@e.com", "password": "pw12345"})
    assert login.status_code == 200


def test_admin_reject_then_login_forbidden(client, db_session):
    token = _make_admin(db_session, client)
    _register(client, "bad@e.com")
    uid = db_session.query(User).filter_by(email="bad@e.com").one().id
    assert (
        client.post(
            f"/admin/users/{uid}/reject",
            headers={"Authorization": f"Bearer {token}"},
        ).status_code
        == 204
    )
    assert (
        client.post("/auth/login", json={"email": "bad@e.com", "password": "pw12345"}).status_code
        == 403
    )


# --- Admin seed tests (Task 9) ---


def test_seed_admin_creates_admin(monkeypatch, db_session):
    monkeypatch.setenv("ADMIN_EMAIL", "seed@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "seedpw123")
    import app.core.config

    importlib.reload(app.core.config)

    admin = seed_admin(db_session)
    assert admin is not None
    assert admin.email == "seed@example.com"
    assert admin.role == "admin"
    assert admin.status == "approved"
    assert verify_password("seedpw123", admin.password_hash)


def test_seed_admin_idempotent_no_duplicate(monkeypatch, db_session):
    monkeypatch.setenv("ADMIN_EMAIL", "dup@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "dup12345")
    import app.core.config

    importlib.reload(app.core.config)

    a1 = seed_admin(db_session)
    a2 = seed_admin(db_session)
    assert a1.id == a2.id

    rows = db_session.scalars(select(User).where(User.email == "dup@example.com")).all()
    assert len(rows) == 1


def test_seed_admin_idempotent_no_pw_overwrite(monkeypatch, db_session):
    monkeypatch.setenv("ADMIN_EMAIL", "pw@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "first-pw")
    import app.core.config

    importlib.reload(app.core.config)

    a1 = seed_admin(db_session)
    original_hash = a1.password_hash

    monkeypatch.setenv("ADMIN_PASSWORD", "second-pw")
    importlib.reload(app.core.config)

    a2 = seed_admin(db_session)
    assert a2.id == a1.id
    assert a2.password_hash == original_hash
    assert verify_password("first-pw", a2.password_hash)


def test_seed_admin_noop_when_env_unset(monkeypatch, db_session):
    monkeypatch.setenv("ADMIN_EMAIL", "")
    monkeypatch.setenv("ADMIN_PASSWORD", "")
    import app.core.config

    importlib.reload(app.core.config)

    result = seed_admin(db_session)
    assert result is None

    count = len(db_session.scalars(select(User)).all())
    assert count == 0
