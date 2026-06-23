from app.main import create_app
from fastapi.testclient import TestClient


def test_health_returns_200_ok():
    client = TestClient(create_app())
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
