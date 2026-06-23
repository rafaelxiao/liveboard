from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Fill(Base):
    __tablename__ = "fills"
    __table_args__ = (
        UniqueConstraint("series_id", "client_fill_id", name="uq_fills_series_client_fill_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), index=True, nullable=False
    )
    strategy_id: Mapped[int] = mapped_column(
        ForeignKey("strategies.id"), index=True, nullable=False
    )
    symbol: Mapped[str] = mapped_column(String(32), nullable=False)
    side: Mapped[str] = mapped_column(String(8), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(28, 10), nullable=False)
    commission: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=0, nullable=False)
    exchange_fee: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=0, nullable=False)
    regulatory_fee: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=0, nullable=False)
    financing_fee: Mapped[Decimal] = mapped_column(Numeric(28, 10), default=0, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    client_fill_id: Mapped[str] = mapped_column(String(128), nullable=False)
    signal_id: Mapped[str | None] = mapped_column(String(128))
    position_effect: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
