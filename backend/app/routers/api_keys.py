from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.deps import get_api_user, get_current_user, require_approved
from app.db import get_db
from app.models.user import User
from app.schemas.api_key import ApiKeyCreatedOut, ApiKeyCreateIn, ApiKeyOut
from app.services import api_keys as api_keys_service

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


@router.post("", response_model=ApiKeyCreatedOut, status_code=status.HTTP_201_CREATED)
def create_key(
    payload: ApiKeyCreateIn,
    db: Session = Depends(get_db),
    current: User = Depends(require_approved),
) -> ApiKeyCreatedOut:
    row, full_key = api_keys_service.create_api_key(db, current, payload.name)
    db.commit()
    return ApiKeyCreatedOut(id=row.id, name=row.name, key=full_key)


@router.get("", response_model=list[ApiKeyOut])
def list_keys(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[ApiKeyOut]:
    return [ApiKeyOut.model_validate(k) for k in api_keys_service.list_api_keys(db, current)]


@router.delete("/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_key(
    key_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> None:
    api_keys_service.revoke_api_key(db, current, key_id)
    db.commit()


@router.get("/_authcheck", include_in_schema=False)
def _authcheck_api(current: User = Depends(get_api_user)) -> dict:
    return {"user_id": current.id}
