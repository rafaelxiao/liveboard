# backend/tests/api/test_fx_api.py
def test_post_fx_rates_ingests(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series",
        headers=h,
        json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]

    r = client.post(
        f"/series/{sid}/fx-rates",
        headers=h,
        json=[
            {
                "ccy_from": "EUR",
                "ccy_to": "USD",
                "ts": "2026-06-19T00:00:00Z",
                "rate": "1.082000000000",
            },
            {
                "ccy_from": "EUR",
                "ccy_to": "USD",
                "ts": "2026-06-19T12:00:00Z",
                "rate": "1.090000000000",
            },
        ],
    )
    assert r.status_code == 201
    assert r.json() == {"ingested": 2}


def test_post_fx_rates_rejects_naive_ts(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series",
        headers=h,
        json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]
    r = client.post(
        f"/series/{sid}/fx-rates",
        headers=h,
        json=[
            {
                "ccy_from": "EUR",
                "ccy_to": "USD",
                "ts": "2026-06-19T00:00:00",
                "rate": "1.0",
            }
        ],
    )
    assert r.status_code == 422
