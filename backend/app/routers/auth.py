from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.deps import get_current_user
from app.core.errors import AuthError
from app.core.security import create_access_token, create_refresh_token, decode_token
from app.db import get_db
from app.models.user import User
from app.schemas.auth import (
    AccessTokenOut,
    LoginIn,
    RefreshIn,
    RegisterIn,
    TokenPair,
    UserOut,
)
from app.services import users as users_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, db: Session = Depends(get_db)) -> UserOut:
    user = users_service.register_user(db, payload.email, payload.password)
    db.commit()
    return UserOut.model_validate(user)


@router.post("/login", response_model=TokenPair)
def login(payload: LoginIn, db: Session = Depends(get_db)) -> TokenPair:
    user = users_service.authenticate_user(db, payload.email, payload.password)
    return TokenPair(
        access_token=create_access_token(subject=user.id),
        refresh_token=create_refresh_token(subject=user.id),
    )


@router.get("/me", response_model=UserOut)
def me(current: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(current)


@router.post("/refresh", response_model=AccessTokenOut)
def refresh(payload: RefreshIn, db: Session = Depends(get_db)) -> AccessTokenOut:
    claims = decode_token(payload.refresh_token)
    if claims.get("type") != "refresh":
        raise AuthError("not a refresh token")
    user = db.get(User, int(claims["sub"]))
    if user is None or user.status != "approved":
        raise AuthError("user not found or not approved")
    return AccessTokenOut(access_token=create_access_token(subject=claims["sub"]))
