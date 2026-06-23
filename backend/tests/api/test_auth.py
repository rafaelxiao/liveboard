from app.models.user import User


def test_user_model_persists_with_defaults(db_session):
    u = User(email="a@example.com", password_hash="x")
    db_session.add(u)
    db_session.flush()
    assert u.id is not None
    assert u.role == "user"
    assert u.status == "pending"
    assert u.created_at is not None
    assert u.created_at.tzinfo is not None  # tz-aware UTC


def test_register_creates_pending_user_hashed(client, db_session):
    r = client.post(
        "/auth/register",
        json={"email": "u1@example.com", "password": "pw12345"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending"
    assert body["role"] == "user"
    assert "password" not in body and "password_hash" not in body
    # password stored hashed, never plaintext
    row = db_session.query(User).filter_by(email="u1@example.com").one()
    assert row.password_hash != "pw12345"
    assert row.password_hash.startswith("$2")


def test_register_duplicate_email_conflicts(client):
    client.post(
        "/auth/register",
        json={"email": "dup@example.com", "password": "pw12345"},
    )
    r = client.post(
        "/auth/register",
        json={"email": "dup@example.com", "password": "pw12345"},
    )
    assert r.status_code == 409


def _register(client, email, pw="pw12345"):
    return client.post("/auth/register", json={"email": email, "password": pw})


def _approve_directly(db_session, email):
    u = db_session.query(User).filter_by(email=email).one()
    u.status = "approved"
    db_session.flush()


def test_pending_login_is_forbidden(client):
    _register(client, "pend@example.com")
    r = client.post("/auth/login", json={"email": "pend@example.com", "password": "pw12345"})
    assert r.status_code == 403
    assert "awaiting approval" in r.json()["error"]["message"].lower()


def test_approved_login_returns_tokens(client, db_session):
    _register(client, "ok@example.com")
    _approve_directly(db_session, "ok@example.com")
    r = client.post("/auth/login", json={"email": "ok@example.com", "password": "pw12345"})
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"] and body["refresh_token"]


def test_wrong_password_is_401(client, db_session):
    _register(client, "wp@example.com")
    _approve_directly(db_session, "wp@example.com")
    r = client.post("/auth/login", json={"email": "wp@example.com", "password": "nope"})
    assert r.status_code == 401


def _login(client, db_session, email="me@example.com"):
    _register(client, email)
    _approve_directly(db_session, email)
    return client.post("/auth/login", json={"email": email, "password": "pw12345"}).json()


def test_me_requires_token(client):
    assert client.get("/auth/me").status_code == 401


def test_me_returns_current_user(client, db_session):
    tokens = _login(client, db_session, "me@example.com")
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert r.status_code == 200
    assert r.json()["email"] == "me@example.com"
    assert r.json()["status"] == "approved"


def test_refresh_issues_new_access_token(client, db_session):
    tokens = _login(client, db_session, "rf@example.com")
    r = client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    assert r.json()["access_token"]


def test_refresh_rejects_invalid_token(client):
    assert client.post("/auth/refresh", json={"refresh_token": "garbage"}).status_code == 401


def test_refresh_rejects_access_token_as_refresh(client, db_session):
    tokens = _login(client, db_session, "swap@example.com")
    r = client.post("/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert r.status_code == 401  # access token is not a valid refresh token
