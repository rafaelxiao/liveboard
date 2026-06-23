# backend/tests/api/test_ingestion_api.py
def test_post_fund_movements(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series",
        headers=h,
        json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]
    r = client.post(
        f"/series/{sid}/fund-movements",
        headers=h,
        json=[
            {
                "ts": "2026-06-19T00:00:00Z",
                "currency": "USD",
                "from_bucket": "EXTERNAL",
                "to_bucket": "FREE_CASH",
                "amount": "100000",
            }
        ],
    )
    assert r.status_code == 201
    assert r.json() == {"ingested": 1}


def test_post_fund_movements_strategy_without_name_rejected(
    db_session, client, make_user, make_api_key
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
        f"/series/{sid}/fund-movements",
        headers=h,
        json=[
            {
                "ts": "2026-06-19T00:00:00Z",
                "currency": "USD",
                "from_bucket": "FREE_CASH",
                "to_bucket": "STRATEGY",
                "amount": "5000",
            }
        ],
    )
    assert r.status_code == 422
