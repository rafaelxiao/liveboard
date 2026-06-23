from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Index, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class BenchmarkReturn(Base):
    __tablename__ = "benchmark_returns"
    __table_args__ = (Index("ix_benchmark_lookup", "series_id", "name", "ts"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    series_id: Mapped[int] = mapped_column(
        ForeignKey("series.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    return_pct: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
