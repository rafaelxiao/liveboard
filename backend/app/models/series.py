from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Series(Base):
    __tablename__ = "series"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tag: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(String(2000))
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    session_tz: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    validation_config: Mapped[dict | None] = mapped_column(JSONB, nullable=True, comment="Per-series validation thresholds (max_leverage_ratio, max_drawdown_ratio, require_capital)")
