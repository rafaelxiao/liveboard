from app.main import create_app
from fastapi.testclient import TestClient


def test_openapi_served():
    client = TestClient(create_app())
    resp = client.get("/openapi.json")
    assert resp.status_code == 200
    assert resp.json()["info"]["title"] == "LiveBoard API"


def test_docs_served():
    client = TestClient(create_app())
    resp = client.get("/docs")
    assert resp.status_code == 200


def test_unknown_route_uses_error_envelope():
    client = TestClient(create_app())
    resp = client.get("/does-not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["error"]["code"] == "http_error"
