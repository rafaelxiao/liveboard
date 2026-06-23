from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class FxRateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ccy_from: str
    ccy_to: str
    ts: datetime
    rate: Decimal


class FxIngestOut(BaseModel):
    ingested: int
