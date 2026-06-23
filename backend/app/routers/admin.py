from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.deps import require_admin
from app.db import get_db
from app.schemas.admin import AdminUserOut
from app.services import users as users_service

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=list[AdminUserOut])
def list_users(db: Session = Depends(get_db)) -> list[AdminUserOut]:
    return [AdminUserOut.model_validate(u) for u in users_service.list_users(db)]


@router.post("/users/{user_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
def approve(user_id: int, db: Session = Depends(get_db)) -> None:
    users_service.approve_user(db, user_id)
    db.commit()


@router.post("/users/{user_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
def reject(user_id: int, db: Session = Depends(get_db)) -> None:
    users_service.reject_user(db, user_id)
    db.commit()
