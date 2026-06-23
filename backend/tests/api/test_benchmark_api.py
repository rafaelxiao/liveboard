# backend/tests/api/test_benchmark_api.py
def test_post_benchmark_ingests(db_session, client, make_user, make_api_key):
    user = make_user(db_session, status="approved")
    _, raw = make_api_key(db_session, user)
    h = {"X-API-Key": raw}
    sid = client.post(
        "/series",
        headers=h,
        json={"name": "R", "base_currency": "USD", "session_tz": "UTC"},
    ).json()["series_id"]

    r = client.post(
        f"/series/{sid}/benchmark",
        headers=h,
        json={
            "name": "SPX",
            "returns": [
                {"ts": "2026-06-18T00:00:00Z", "return_pct": "0.012000000000"},
                {"ts": "2026-06-19T00:00:00Z", "return_pct": "-0.004000000000"},
            ],
        },
    )
    assert r.status_code == 201
    assert r.json() == {"ingested": 2}
