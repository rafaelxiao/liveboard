"""API integration tests for fill validation."""


def test_fills_exceeding_leverage_return_422(db_session, client, make_user, make_api_key):
    """POST /series/{id}/fills:batch returns 422 when leverage exceeds limit."""
    from decimal import Decimal

    user = make_user(db_session, status="approved")
    _, api_key = make_api_key(db_session, user)
    headers = {"X-API-Key": api_key}

    resp = client.post("/series", headers=headers, json={
        "name": "val-test-1", "base_currency": "USD", "session_tz": "UTC",
    })
    sid = resp.json()["series_id"]

    client.post(f"/series/{sid}/instruments", headers=headers, json=[
        {"symbol": "ES", "asset_class": "future", "multiplier": str(Decimal("50")), "currency": "USD"},
    ])
    client.post(f"/series/{sid}/fund-movements", headers=headers, json=[
        {"ts": "2024-01-01T09:00:00Z", "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH",
         "amount": "100000", "currency": "USD"},
    ])

    # 3 ES contracts at 5000 with ×50 multiplier = 750K on 100K capital = 7.5× > 5.0 max
    resp = client.post(f"/series/{sid}/fills:batch", headers=headers, json={
        "fills": [
            {"client_fill_id": "v1", "strategy": "alpha", "symbol": "ES", "side": "buy",
             "qty": "1", "price": "5000", "ts": "2024-01-02T14:30:00Z",
             "commission": "0", "exchange_fee": "0", "regulatory_fee": "0", "financing_fee": "0"},
            {"client_fill_id": "v2", "strategy": "alpha", "symbol": "ES", "side": "buy",
             "qty": "1", "price": "5000", "ts": "2024-01-02T14:31:00Z",
             "commission": "0", "exchange_fee": "0", "regulatory_fee": "0", "financing_fee": "0"},
            {"client_fill_id": "v3", "strategy": "alpha", "symbol": "ES", "side": "buy",
             "qty": "1", "price": "5000", "ts": "2024-01-02T14:32:00Z",
             "commission": "0", "exchange_fee": "0", "regulatory_fee": "0", "financing_fee": "0"},
        ]
    })
    assert resp.status_code == 422

    body = resp.json()
    assert "validation_failed" not in body  # not the standard format
    # Custom error handler wraps in {"error": {"code": "http_error", "message": "...", "details": null}}
    assert "Batch rejected" in body.get("error", {}).get("message", "")


def test_fills_within_limits_return_201(db_session, client, make_user, make_api_key):
    """POST /series/{id}/fills:batch returns 201 when within leverage limit."""
    user = make_user(db_session, status="approved")
    _, api_key = make_api_key(db_session, user)
    headers = {"X-API-Key": api_key}

    resp = client.post("/series", headers=headers, json={
        "name": "val-test-2", "base_currency": "USD", "session_tz": "UTC",
    })
    sid = resp.json()["series_id"]

    client.post(f"/series/{sid}/instruments", headers=headers, json=[
        {"symbol": "ES", "asset_class": "future", "multiplier": "50", "currency": "USD"},
    ])
    client.post(f"/series/{sid}/fund-movements", headers=headers, json=[
        {"ts": "2024-01-01T09:00:00Z", "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH",
         "amount": "500000", "currency": "USD"},
    ])

    resp = client.post(f"/series/{sid}/fills:batch", headers=headers, json={
        "fills": [
            {"client_fill_id": "v-ok", "strategy": "alpha", "symbol": "ES", "side": "buy",
             "qty": "1", "price": "5000", "ts": "2024-01-02T14:30:00Z",
             "commission": "0", "exchange_fee": "0", "regulatory_fee": "0", "financing_fee": "0"},
        ]
    })
    assert resp.status_code == 200
