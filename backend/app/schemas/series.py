import re
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, field_validator

_CCY_RE = re.compile(r"^[A-Z]{3}$")


class StrategyIn(BaseModel):
    name: str


class SeriesCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    tag: Literal["live", "sim"] | None = None
    notes: str | None = None
    base_currency: str
    session_tz: str
    strategies: list[StrategyIn] | None = None
    instruments: list[dict] | None = None
    fund_movements: list[dict] | None = None

    @field_validator("base_currency")
    @classmethod
    def _ccy(cls, v: str) -> str:
        if not _CCY_RE.match(v):
            raise ValueError("base_currency must be a 3-letter ISO-4217 code")
        return v

    @field_validator("session_tz")
    @classmethod
    def _tz(cls, v: str) -> str:
        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("session_tz must be a valid IANA timezone") from exc
        return v


class StrategyBrief(BaseModel):
    name_key: str
    name: str


class SeriesCounts(BaseModel):
    strategies: int
    instruments: int
    fills: int


class SeriesSummary(BaseModel):
    capital_base: str | None = None
    cumulative_pnl: str | None = None
    end_capital: str | None = None
    return_pct: str | None = None
    sharpe: str | None = None
    max_drawdown: str | None = None
    max_drawdown_pct: str | None = None
    trade_start: str | None = None
    trade_end: str | None = None


class SeriesOut(BaseModel):
    id: int
    name: str
    tag: Literal["live", "sim"] | None
    base_currency: str
    session_tz: str
    created_at: datetime
    last_ingest_at: datetime | None = None
    counts: SeriesCounts
    summary: SeriesSummary | None = None
    strategies: list[StrategyBrief] = []


class InstrumentDetailOut(BaseModel):
    symbol: str
    asset_class: str
    currency: str
    multiplier: str
    tick_size: str | None
    lot_size: str | None
    inferred: bool


class SeriesDetailOut(BaseModel):
    id: int
    name: str
    tag: Literal["live", "sim"] | None
    notes: str | None
    base_currency: str
    session_tz: str
    created_at: datetime
    strategies: list[str]
    instruments: list[InstrumentDetailOut]
    discovered_symbols: list[str]


class ShareLinkCreateIn(BaseModel):
    expires_in_days: int | None = None  # None = never expires
    pnl_color_scheme: str | None = None  # "red-up" or "green-up"
    trade_grouping: str | None = None  # "lot" or "day"
    lang: str | None = None  # "en" or "zh"
    custom_slug: str | None = None  # custom URL path
    date_from: str | None = None  # ISO date, start of the shared data range


class ShareLinkOut(BaseModel):
    id: int
    token: str
    slug: str | None = None
    series_id: int | None = None
    series_name: str | None = None
    expires_at: datetime | None
    created_at: datetime
    last_accessed_at: datetime | None
    url: str


class SharedSeriesOut(BaseModel):
    """Public view of a shared series — no auth required."""
    series: SeriesOut
    metrics: dict | None = None  # compute_metrics envelope
    pnl_color_scheme: str | None = None
    lang: str | None = None


class FillOut(BaseModel):
    """A single fill record."""
    id: int
    strategy_name: str
    symbol: str
    side: str
    qty: str
    price: str
    commission: str
    ts: datetime
    client_fill_id: str
    signal_id: str | None = None


class StrategyCapital(BaseModel):
    """Capital allocated + PnL for one strategy."""
    strategy_id: int
    name_key: str
    name: str
    capital: str
    pnl: str
    net_value: str


class SeriesCapitalOut(BaseModel):
    """Snapshot of free cash, strategy allocations, and account total."""
    free_cash: str
    strategies: list[StrategyCapital]
    account_total: str
