from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import Bucket, PositionEffect, Side


class FundMovementIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_movement_id: str
    ts: datetime
    currency: str
    from_bucket: Bucket
    to_bucket: Bucket
    from_strategy: str | None = None
    to_strategy: str | None = None
    amount: Decimal


class FundIngestOut(BaseModel):
    ingested: int


class FillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_fill_id: str
    strategy: str
    symbol: str
    side: Side
    qty: Decimal
    price: Decimal
    ts: datetime
    commission: Decimal = Decimal("0")
    exchange_fee: Decimal = Decimal("0")
    regulatory_fee: Decimal = Decimal("0")
    financing_fee: Decimal = Decimal("0")
    signal_id: str | None = None
    position_effect: PositionEffect | None = None


class FillBatchIn(BaseModel):
    fills: list[FillIn]


class BatchError(BaseModel):
    row: int
    client_fill_id: str | None
    message: str


class BatchResultOut(BaseModel):
    inserted: int
    updated: int
    rejected: int
    errors: list[BatchError]
    batch_id: int


class VoidFillsIn(BaseModel):
    client_fill_ids: list[str]


class VoidOut(BaseModel):
    voided: int
