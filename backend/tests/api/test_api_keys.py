# backend/tests/api/test_api_keys.py
from app.models.api_key import ApiKey
from app.models.user import User


def test_api_key_model_persists(db_session):
    u = User(email="k@e.com", password_hash="h", role="user", status="approved")
    db_session.add(u)
    db_session.flush()
    k = ApiKey(user_id=u.id, name="ci", key_hash="hashed", prefix="lbk_ab12")
    db_session.add(k)
    db_session.flush()
    assert k.id is not None
    assert k.created_at is not None
    assert k.last_used_at is None
    assert k.revoked_at is None


# --- Task 11: create key (full key once) ---


def _approved_token(client, db_session, email="ak@e.com"):
    client.post("/auth/register", json={"email": email, "password": "pw12345"})
    from app.models.user import User

    db_session.query(User).filter_by(email=email).one().status = "approved"
    db_session.flush()
    return client.post("/auth/login", json={"email": email, "password": "pw12345"}).json()[
        "access_token"
    ]


def test_create_api_key_returns_full_key_once_and_stores_hash(client, db_session):
    token = _approved_token(client, db_session)
    r = client.post("/api-keys", json={"name": "ci"}, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 201
    body = r.json()
    assert body["key"].startswith("lbk_")  # full key shown once
    from app.models.api_key import ApiKey

    row = db_session.query(ApiKey).filter_by(id=body["id"]).one()
    assert row.key_hash != body["key"]  # stored hashed, not plaintext
    assert body["key"].startswith(row.prefix)


def test_pending_user_cannot_create_key(client):
    client.post("/auth/register", json={"email": "pend2@e.com", "password": "pw12345"})
    # status stays pending; login is 403 for pending
    assert (
        client.post("/auth/login", json={"email": "pend2@e.com", "password": "pw12345"}).status_code
        == 403
    )


# --- Task 12: list (prefix only) + revoke ---


def test_list_returns_prefix_only_no_full_key(client, db_session):
    token = _approved_token(client, db_session, "list@e.com")
    hdr = {"Authorization": f"Bearer {token}"}
    created = client.post("/api-keys", json={"name": "one"}, headers=hdr).json()
    r = client.get("/api-keys", headers=hdr)
    assert r.status_code == 200
    item = next(i for i in r.json() if i["id"] == created["id"])
    assert set(item.keys()) == {"id", "name", "prefix", "last_used_at", "created_at"}
    assert "key" not in item and "key_hash" not in item


def test_revoke_sets_revoked_at(client, db_session):
    token = _approved_token(client, db_session, "rev@e.com")
    hdr = {"Authorization": f"Bearer {token}"}
    created = client.post("/api-keys", json={"name": "x"}, headers=hdr).json()
    r = client.delete(f"/api-keys/{created['id']}", headers=hdr)
    assert r.status_code == 204
    from app.models.api_key import ApiKey

    assert db_session.query(ApiKey).filter_by(id=created["id"]).one().revoked_at is not None


def test_cannot_revoke_another_users_key(client, db_session):
    owner_token = _approved_token(client, db_session, "owner@e.com")
    created = client.post(
        "/api-keys",
        json={"name": "o"},
        headers={"Authorization": f"Bearer {owner_token}"},
    ).json()
    other_token = _approved_token(client, db_session, "other@e.com")
    r = client.delete(
        f"/api-keys/{created['id']}",
        headers={"Authorization": f"Bearer {other_token}"},
    )
    assert r.status_code == 404


# --- Task 13: get_api_user X-API-Key auth ---


def test_valid_key_authenticates_and_touches_last_used(client, db_session):
    token = _approved_token(client, db_session, "auth1@e.com")
    hdr = {"Authorization": f"Bearer {token}"}
    created = client.post("/api-keys", json={"name": "k"}, headers=hdr).json()
    r = client.get("/api-keys/_authcheck", headers={"X-API-Key": created["key"]})
    assert r.status_code == 200
    from app.models.api_key import ApiKey

    db_session.expire_all()
    assert db_session.query(ApiKey).filter_by(id=created["id"]).one().last_used_at is not None


def test_missing_or_invalid_key_is_401(client):
    assert client.get("/api-keys/_authcheck").status_code == 401
    assert client.get("/api-keys/_authcheck", headers={"X-API-Key": "lbk_bogus"}).status_code == 401


def test_revoked_key_is_401_on_ingestion_auth(client, db_session):
    token = _approved_token(client, db_session, "auth2@e.com")
    hdr = {"Authorization": f"Bearer {token}"}
    created = client.post("/api-keys", json={"name": "k"}, headers=hdr).json()
    # works before revoke
    assert client.get("/api-keys/_authcheck", headers={"X-API-Key": created["key"]}).status_code == 200
    client.delete(f"/api-keys/{created['id']}", headers=hdr)
    # 401 after revoke (B4)
    assert client.get("/api-keys/_authcheck", headers={"X-API-Key": created["key"]}).status_code == 401
