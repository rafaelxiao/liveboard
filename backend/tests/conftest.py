import uuid
from collections.abc import Iterator

import pytest
from app.core.config import settings
from app.db import Base, get_db
from app.main import create_app
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.models.user import User


@pytest.fixture(scope="session")
def test_engine():
    url = settings.TEST_DATABASE_URL or settings.DATABASE_URL
    engine = create_engine(url, pool_pre_ping=True, future=True)
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def db_session(test_engine) -> Iterator[Session]:
    """Function-scoped session wrapped in a transaction rolled back after each test."""
    connection = test_engine.connect()
    transaction = connection.begin()
    session_factory = sessionmaker(bind=connection, autoflush=False, expire_on_commit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture()
def client(db_session) -> Iterator[TestClient]:
    app = create_app()

    def _override_get_db() -> Iterator[Session]:
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def make_unique_email():
    def _make() -> str:
        return f"user-{uuid.uuid4().hex[:12]}@example.com"

    return _make


@pytest.fixture()
def make_user():
    """Factory fixture that creates a User and returns it.

    Usage in tests:
        user = make_user(db_session, email="a@b.com", status="approved", role="user")
    """
    from app.core.security import hash_password

    def _make(session, *, email=None, password="test", status="approved", role="user"):
        u_email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
        u = User(email=u_email, password_hash=hash_password(password), role=role, status=status)
        session.add(u)
        session.flush()
        return u

    return _make


@pytest.fixture()
def make_api_key():
    """Factory fixture that creates an ApiKey and returns (api_key_row, raw_key_string)."""
    from app.core.security import generate_api_key, hash_api_key
    from app.models.api_key import ApiKey

    def _make(session, user):
        raw, prefix = generate_api_key()
        row = ApiKey(user_id=user.id, name="test-key", key_hash=hash_api_key(raw), prefix=prefix)
        session.add(row)
        session.flush()
        return row, raw

    return _make


@pytest.fixture()
def auth_header(make_user, make_api_key, db_session):
    """Returns a dict suitable for the Authorization header (X-API-Key) for a test user."""
    user = make_user(db_session, status="approved")
    _, raw_key = make_api_key(db_session, user)
    return {"X-API-Key": raw_key}
