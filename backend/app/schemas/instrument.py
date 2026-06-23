from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.enums import AssetClass


class InstrumentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    asset_class: AssetClass
    currency: str
    multiplier: Decimal = Decimal("1")
    tick_size: Decimal | None = None
    lot_size: Decimal | None = None


class InstrumentUpsertOut(BaseModel):
    upserted: int
