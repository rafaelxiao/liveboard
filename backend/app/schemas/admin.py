from datetime import datetime

from pydantic import BaseModel


class AdminUserOut(BaseModel):
    id: int
    email: str
    status: str
    role: str
    created_at: datetime

    model_config = {"from_attributes": True}
