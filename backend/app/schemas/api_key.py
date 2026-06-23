from datetime import datetime

from pydantic import BaseModel


class ApiKeyCreateIn(BaseModel):
    name: str


class ApiKeyCreatedOut(BaseModel):
    id: int
    name: str
    key: str  # full key — shown exactly once


class ApiKeyOut(BaseModel):
    id: int
    name: str
    prefix: str
    last_used_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}
