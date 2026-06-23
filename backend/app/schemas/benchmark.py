from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class BenchmarkReturnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ts: datetime
    return_pct: Decimal


class BenchmarkIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    returns: list[BenchmarkReturnIn]


class BenchmarkIngestOut(BaseModel):
    ingested: int
