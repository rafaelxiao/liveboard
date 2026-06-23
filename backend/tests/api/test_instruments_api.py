# backend/tests/api/test_instruments_api.py
def test_post_instruments_upserts_and_clears_inferred(
    db_session, client, make_user, make_api_key, auth_header
):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series",
        headers=h,
        json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]

    r = client.post(
        f"/series/{sid}/instruments",
        headers=h,
        json=[
            {
                "symbol": "es",
                "asset_class": "future",
                "currency": "USD",
                "multiplier": "50",
            }
        ],
    )
    assert r.status_code == 201
    assert r.json() == {"upserted": 1}

    from app.core.security import create_access_token

    jwt_token = create_access_token(subject=user.id)
    detail = client.get(
        f"/series/{sid}",
        headers={"Authorization": f"Bearer {jwt_token}"},
    ).json()
    inst = next(i for i in detail["instruments"] if i["symbol"] == "ES")
    assert inst["asset_class"] == "future"
    assert inst["multiplier"] == "50.000000000000"
    assert inst["inferred"] is False
