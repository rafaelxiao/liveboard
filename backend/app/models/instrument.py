from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Instrument(Base):
    __tablename__ = "instruments"
    __table_args__ = (UniqueConstraint("series_id", "symbol", name="uq_instrument_series_symbol"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False
    )
    symbol: Mapped[str] = mapped_column(String(64), nullable=False)
    asset_class: Mapped[str] = mapped_column(String(16), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    multiplier: Mapped[Decimal] = mapped_column(
        Numeric(28, 12), nullable=False, default=Decimal("1")
    )
    tick_size: Mapped[Decimal | None] = mapped_column(Numeric(28, 10))
    lot_size: Mapped[Decimal | None] = mapped_column(Numeric(28, 10))
    inferred: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
