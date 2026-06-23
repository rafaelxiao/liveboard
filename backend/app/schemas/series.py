import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, field_validator

_CCY_RE = re.compile(r"^[A-Z]{3}$")


class StrategyIn(BaseModel):
    name: str


class SeriesCreateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    tag: str | None = None
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


class SeriesOut(BaseModel):
    id: int
    name: str
    tag: str | None
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
    tag: str | None
    notes: str | None
    base_currency: str
    session_tz: str
    created_at: datetime
    strategies: list[str]
    instruments: list[InstrumentDetailOut]
    discovered_symbols: list[str]
