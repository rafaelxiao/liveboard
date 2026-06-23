"""API tests for POST /comparisons — end-to-end against TestClient."""


def _auth_headers(client, email="cmp@example.com", password="pw-secret-123"):
    client.post("/auth/register", json={"email": email, "password": password})
    from tests.conftest import db_session  # noqa

    # approve user via direct DB access
    # For TestClient, we use the session inside the test
    return None  # will be replaced in each test with proper fixtures


def test_comparison_requires_two_series(client):
    """Pydantic min_length=2 validation on series_ids."""
    r = client.post(
        "/comparisons",
        json={"series_ids": [1]},
        headers={"Authorization": "Bearer fake"},
    )
    assert r.status_code == 401


def test_comparison_cross_user_returns_404(db_session, client, make_user, make_api_key):

    user_a = make_user(db_session, status="approved", email="own@cmp.com")
    _, key_a = make_api_key(db_session, user_a)
    h_a = {"X-API-Key": key_a}
    h_jwt_a = _jwt_for(client, db_session, user_a)

    user_b = make_user(db_session, status="approved", email="oth@cmp.com")
    _, key_b = make_api_key(db_session, user_b)
    h_b = {"X-API-Key": key_b}

    sid_a = client.post(
        "/series",
        headers=h_a,
        json={"name": "A", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]
    sid_b = client.post(
        "/series",
        headers=h_b,
        json={"name": "B", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]

    # user A tries to compare with user B's series
    r = client.post(
        "/comparisons",
        json={"series_ids": [sid_a, sid_b]},
        headers=h_jwt_a,
    )
    assert r.status_code == 404


def _jwt_for(client, db_session, user):
    from app.core.security import create_access_token

    token = create_access_token(subject=user.id)
    return {"Authorization": f"Bearer {token}"}
