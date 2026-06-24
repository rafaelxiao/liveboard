"""Comparison request/response schemas — Pydantic v2 DTOs."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class StrategyKey(BaseModel):
    series_id: int
    name_key: str


class ComparisonIn(BaseModel):
    series_ids: list[int] = Field(min_length=2)
    level: Literal["account", "strategy"] = "account"
    strategy_keys: list[StrategyKey] | None = None
    baseline_entity_index: int = Field(default=0, ge=0)
    baseline_series_id: int | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None
    trade_view: Literal["lot", "position"] = "lot"
    trade_grouping: Literal["lot", "day"] | None = None
    per_trade_page: int = Field(default=1, ge=1)
    per_trade_page_size: int = Field(default=500, ge=1, le=5000)


class ComparisonMeta(BaseModel):
    base_currency: str | None
    baseline_series_id: int | None
    date_range: dict[str, str | None]
    currency_mismatch_series: list[int]


class AccountSeriesEntry(BaseModel):
    series_id: int
    meta: dict
    metrics: dict


class AccountBlock(BaseModel):
    series: list[AccountSeriesEntry]


class StrategyBlock(BaseModel):
    matched: bool
    series: list[dict]


class SymbolBlock(BaseModel):
    series: list[dict]


class PerTradeValue(BaseModel):
    price: str
    qty: str
    total_fee: str
    ts: str


class PerTradeDiff(BaseModel):
    price_slippage: str
    price_slippage_pct: str
    timing_sec: int
    qty_diff: str
    fee_diff: str


class PerTradeRow(BaseModel):
    ts: str
    symbol: str
    side: str
    name_key: str
    values: dict[str, PerTradeValue]
    diff: PerTradeDiff


class UnmatchedFill(BaseModel):
    client_fill_id: str
    symbol: str
    side: str
    ts: str


class PerTradeBlock(BaseModel):
    page: int
    page_size: int
    total: int
    rows: list[PerTradeRow]
    unmatched: dict[str, list[UnmatchedFill]]


class SeriesEquityCurve(BaseModel):
    series_id: int
    name: str
    equity_curve: list[dict]
    drawdown_series: list[dict]


class ExecutionDeltaGroup(BaseModel):
    """Per (strategy, symbol) execution delta summary."""
    name_key: str
    symbol: str
    baseline_series_id: int
    other_series_id: int
    daily_groups: int
    weighted_avg_bps: str  # signed: positive = other worse, "—" = no match
    estimated_pnl_impact: str  # monetized impact, "—" = no match
    total_notional: str  # total notional used for weighting
    note: str | None = None  # e.g., "live only" for unmatched symbols


class ExecutionComparisonBlock(BaseModel):
    """Container for execution quality comparison across matched strategies."""
    groups: list[ExecutionDeltaGroup]


class PnlBreakdownRow(BaseModel):
    """One row in the PnL breakdown table."""
    month: str
    name_key: str
    first_pnl: str
    second_pnl: str
    total_delta: str
    shared_delta: str
    date_delta: str


class PnlBreakdownBlock(BaseModel):
    """PnL difference broken down by shared vs different dates, per strategy per month."""
    first_name: str
    second_name: str
    rows: list[PnlBreakdownRow]


class ComparisonOut(BaseModel):
    meta: ComparisonMeta
    account: AccountBlock
    strategy: dict[str, StrategyBlock]
    symbol: dict[str, SymbolBlock]
    per_trade: PerTradeBlock
    equity_curves: list[SeriesEquityCurve]
    execution: ExecutionComparisonBlock | None = None
    pnl_breakdown: PnlBreakdownBlock | None = None
