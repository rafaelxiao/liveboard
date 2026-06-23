from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class FxRate(Base):
    __tablename__ = "fx_rates"
    __table_args__ = (Index("ix_fxrate_lookup", "series_id", "ccy_from", "ccy_to", "ts"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )
    ccy_from: Mapped[str] = mapped_column(String(3), nullable=False)
    ccy_to: Mapped[str] = mapped_column(String(3), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
