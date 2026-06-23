"""Validation request/response schemas."""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, Field


class ValidationConfigIn(BaseModel):
    """PATCH /series/{id}/validation-config request — partial update."""
    max_leverage_ratio: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    max_drawdown_ratio: Optional[Decimal] = Field(default=None, ge=Decimal("0"))
    require_capital: Optional[bool] = None


class ValidationConfigOut(BaseModel):
    """GET validation config response — resolved with defaults."""
    max_leverage_ratio: Decimal
    max_drawdown_ratio: Optional[Decimal]
    require_capital: bool


class ValidationErrorDetail(BaseModel):
    """Single fill validation failure."""
    client_fill_id: str
    rule: str
    strategy: Optional[str] = None
    current: Optional[str] = None
    limit: Optional[str] = None
    ts: Optional[str] = None
