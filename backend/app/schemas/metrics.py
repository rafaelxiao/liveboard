"""Metrics envelope schemas — Pydantic v2 DTOs for the portable-data contract."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class DateRange(BaseModel):
    from_: str | None = None
    to: str | None = None
    model_config = {"populate_by_name": True}


class SampleBlock(BaseModel):
    round_trips: int
    active_days: int


class FlagsBlock(BaseModel):
    realized_only: bool
    low_sample: bool
    sharpe_suppressed: bool
    fx_missing: bool
    open_positions_exist: bool


class MetaBlock(BaseModel):
    level: str
    base_currency: str
    session_tz: str
    date_range: DateRange
    trade_view: str
    capital_base: str | None
    sample: SampleBlock
    flags: FlagsBlock
    strategies: list[str] | None = None
    symbols: list[str] | None = None


class MetricsBlock(BaseModel):
    net_pnl: str
    gross_pnl: str
    total_fees: str
    fees_on_open_positions: str
    twr: str | None
    cagr: str | None
    volatility: str | None
    sharpe: str | None
    sortino: str | None
    calmar: str | None
    max_drawdown: str | None
    win_rate: str
    profit_factor: str | None
    payoff_ratio: str | None
    expectancy: str
    max_consec_wins: int
    max_consec_losses: int
    largest_win: str
    largest_loss: str
    avg_holding_secs: int
    trade_count: int
    avg_win: str
    avg_loss: str
    contribution_pct: str | None = None
    concentration_curve: list[dict] = []
    loss_concentration_curve: list[dict] = []
    alpha: str | None = None
    beta: str | None = None
    information_ratio: str | None = None
    units: dict[str, str]


class EquityPoint(BaseModel):
    ts: str
    realized_pnl: str
    indexed_return: str | None


class DrawdownPoint(BaseModel):
    ts: str
    drawdown: str
    drawdown_pct: str


class MetricsEnvelope(BaseModel):
    meta: MetaBlock
    metrics: MetricsBlock
    equity_curve: list[EquityPoint]
    drawdown_series: list[DrawdownPoint]
    symbol_contributions: list[dict] = []
