import pytest
from app.models.series import Series
from app.schemas.series import SeriesCreateIn
from app.services.series import (
    SeriesNotFound,
    create_series,
    get_series_detail,
)


def _make_user(db_session, email="u@x.com"):
    from app.models.user import User

    u = User(email=email, password_hash="x", role="user", status="approved")
    db_session.add(u)
    db_session.flush()
    return u


def test_create_series(db_session):
    user = _make_user(db_session)
    sid = create_series(
        db_session,
        user_id=user.id,
        data=SeriesCreateIn(
            name="Real", tag="real", base_currency="USD", session_tz="America/New_York"
        ),
    )
    series = db_session.get(Series, sid)
    assert series.user_id == user.id
    assert series.base_currency == "USD"


def test_create_series_rejects_bad_currency():
    with pytest.raises(ValueError):
        SeriesCreateIn(name="x", base_currency="US", session_tz="UTC")


def test_create_series_rejects_bad_tz():
    with pytest.raises(ValueError):
        SeriesCreateIn(name="x", base_currency="USD", session_tz="Mars/Olympus")


def test_get_series_detail_enforces_ownership(db_session):
    owner = _make_user(db_session, email="a@x.com")
    other = _make_user(db_session, email="b@x.com")
    sid = create_series(
        db_session,
        user_id=owner.id,
        data=SeriesCreateIn(name="R", base_currency="USD", session_tz="UTC"),
    )
    with pytest.raises(SeriesNotFound):
        get_series_detail(db_session, user_id=other.id, series_id=sid)
    detail = get_series_detail(db_session, user_id=owner.id, series_id=sid)
    assert detail.id == sid
