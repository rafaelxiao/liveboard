from collections.abc import Iterator

import app.db as db
from sqlalchemy.orm import Session


def test_base_has_metadata():
    # Base must expose a MetaData object for Alembic autogenerate
    assert hasattr(db.Base, "metadata")
    assert db.Base.metadata is not None


def test_engine_uses_configured_url():
    from app.core.config import settings

    assert str(db.engine.url).startswith("postgresql+psycopg")
    # URL should be derived from settings, not hardcoded
    assert settings.DATABASE_URL.split("://", 1)[0] in str(db.engine.url)


def test_get_db_yields_session_and_closes():
    gen = db.get_db()
    assert isinstance(gen, Iterator)
    session = next(gen)
    assert isinstance(session, Session)
    # Exhausting the generator triggers the finally: close()
    try:
        next(gen)
    except StopIteration:
        pass
    assert session.bind is db.engine
