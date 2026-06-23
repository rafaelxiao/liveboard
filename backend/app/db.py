from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    """Declarative base; every ORM model inherits from this.

    Alembic autogenerate targets ``Base.metadata`` (see app/alembic/env.py).
    """


engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: yield a session, always close it."""
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
