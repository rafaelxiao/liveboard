# backend/tests/api/test_conftest_wiring.py
from sqlalchemy import text


def test_db_session_fixture_connects(db_session):
    result = db_session.execute(text("select 1")).scalar_one()
    assert result == 1


def test_client_fixture_serves_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_make_unique_email_factory(make_unique_email):
    a = make_unique_email()
    b = make_unique_email()
    assert a != b
    assert "@" in a
