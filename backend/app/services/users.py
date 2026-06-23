from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AuthError, ConflictError, ForbiddenError, NotFoundError
from app.core.security import hash_password, verify_password
from app.models.user import User


def register_user(session: Session, email: str, password: str) -> User:
    existing = session.scalar(select(User).where(User.email == email))
    if existing is not None:
        raise ConflictError("email already registered")
    user = User(
        email=email,
        password_hash=hash_password(password),
        role="user",
        status="pending",
    )
    session.add(user)
    session.flush()
    return user


def authenticate_user(session: Session, email: str, password: str) -> User:
    user = session.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(password, user.password_hash):
        raise AuthError("invalid credentials")
    if user.status != "approved":
        raise ForbiddenError("awaiting approval")
    return user


def list_users(session: Session) -> list[User]:
    return list(session.scalars(select(User).order_by(User.created_at)))


def _set_status(session: Session, user_id: int, status_value: str) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise NotFoundError("user not found")
    user.status = status_value
    session.flush()
    return user


def approve_user(session: Session, user_id: int) -> User:
    return _set_status(session, user_id, "approved")


def reject_user(session: Session, user_id: int) -> User:
    return _set_status(session, user_id, "rejected")


def seed_admin(session: Session) -> User | None:
    """Idempotent: seed the admin user from env vars on startup.

    Reads ADMIN_EMAIL and ADMIN_PASSWORD from settings.
    If either is empty/unset → silent no-op, returns None.
    If user exists → ensures role=admin, status=approved (never overwrites password).
    If user does not exist → creates with role=admin, status=approved, hashed password.
    Returns the admin user.
    """
    from app.core.config import settings

    if not settings.ADMIN_EMAIL or not settings.ADMIN_PASSWORD:
        return None
    existing = session.scalar(select(User).where(User.email == settings.ADMIN_EMAIL))
    if existing is not None:
        existing.role = "admin"
        existing.status = "approved"
        session.flush()
        return existing
    admin = User(
        email=settings.ADMIN_EMAIL,
        password_hash=hash_password(settings.ADMIN_PASSWORD),
        role="admin",
        status="approved",
    )
    session.add(admin)
    session.flush()
    return admin
