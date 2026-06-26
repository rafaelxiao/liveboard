export type UserStatus = "pending" | "approved" | "rejected";
export type UserRole = "user" | "admin";

export interface UserOut {
  id: number;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface AccessToken {
  access_token: string;
}

export interface ApiKeyOut {
  id: number;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyCreatedOut {
  id: number;
  name: string;
  key: string; // full key — shown ONCE
}

export type AdminUserOut = UserOut;

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── Phase 7+ domain types ──

export type Level = "account" | "strategy" | "symbol";

export interface FlagsBlock {
  realized_only: boolean;
  low_sample: boolean;
  sharpe_suppressed: boolean;
  fx_missing: boolean;
  open_positions_exist: boolean;
}

export interface MetaBlock {
  level: Level;
  base_currency: string;
  session_tz: string;
  date_range: { from_: string; to: string };
  strategy?: string;
  symbol?: string;
  capital_base: string | null;
  sample: { round_trips: number; active_days: number };
  flags: FlagsBlock;
  strategies?: string[];
  symbols?: string[];
}

export interface MetricsBlock {
  net_pnl: string;
  gross_pnl: string;
  total_fees: string;
  fees_on_open_positions: string;
  twr: string | null;
  cagr: string | null;
  volatility: string | null;
  sharpe: string | null;
  sortino: string | null;
  calmar: string | null;
  max_drawdown: string | null;
  win_rate: string;
  profit_factor: string;
  payoff_ratio: string;
  expectancy: string;
  max_consec_wins: number;
  max_consec_losses: number;
  largest_win: string;
  largest_loss: string;
  avg_holding_secs: number;
  trade_count: number;
  contribution_pct: string | null;
  concentration_curve: { pct_trades: string; trade_count: number; cum_pnl_pct: string }[];
  loss_concentration_curve: { pct_trades: string; trade_count: number; cum_pnl_pct: string }[];
  alpha: string | null;
  beta: string | null;
  information_ratio: string | null;
  units: Record<string, string>;
}

export interface EquityPoint {
  ts: string;
  realized_pnl: string;
  indexed_return: string;
}

export interface DrawdownPoint {
  ts: string;
  drawdown: string;
  drawdown_pct: string;
}

export interface MetricsEnvelope {
  meta: MetaBlock;
  metrics: MetricsBlock;
  equity_curve: EquityPoint[];
  drawdown_series: DrawdownPoint[];
  symbol_contributions: { symbol: string; pnl: string; pct: string }[];
}

export interface StrategyBrief {
  name_key: string;
  name: string;
}

export interface SharedSeriesOut {
  series: SeriesSummary;
  metrics: MetricsEnvelope | null;
  pnl_color_scheme?: string;
  lang?: string;
}

export interface ShareLinkOut {
  id: number;
  token: string;
  slug?: string;
  series_id?: number;
  series_name?: string;
  expires_at: string | null;
  created_at: string;
  last_accessed_at: string | null;
  url: string;
}

export interface SeriesSummary {
  id: number;
  name: string;
  tag: string;
  base_currency: string;
  created_at: string;
  counts?: { strategies: number; fills: number };
  last_ingest_at?: string;
  summary?: {
    capital_base: string | null;
    cumulative_pnl: string | null;
    end_capital: string | null;
    return_pct: string | null;
    sharpe: string | null;
    max_drawdown: string | null;
    max_drawdown_pct: string | null;
    trade_start: string | null;
    trade_end: string | null;
  };
  strategies?: StrategyBrief[];
}

export interface Strategy {
  id: number;
  name: string;
  name_key: string;
  fills?: number;
}

export interface InstrumentSpec {
  symbol: string;
  asset_class: string;
  multiplier: string;
  currency: string;
  inferred: boolean;
  tick_size?: string;
  lot_size?: string;
}

export interface FxRateSummary {
  ccy_from: string;
  ccy_to: string;
  latest_rate: string;
  points: number;
}

export interface SeriesDetail {
  id: number;
  name: string;
  tag: string;
  notes?: string;
  base_currency: string;
  session_tz: string;
  created_at: string;
  strategies: Strategy[];
  symbols: string[];
  instruments: InstrumentSpec[];
  fx_rates?: FxRateSummary[];
  fx_missing_count?: number;
  ingestion?: {
    last_batch_at?: string;
    rejected?: number;
    fills_missing_fx?: number;
  };
}

// ── Phase 8: Comparison types ──

export type ComparisonLevel = "account" | "strategy";

export interface StrategyKey {
  series_id: number;
  name_key: string;
}

export interface ComparisonRequest {
  series_ids: number[];
  level: ComparisonLevel;
  strategy_keys?: StrategyKey[];
  baseline_entity_index?: number;
  date_from?: string;
  date_to?: string;
  trade_grouping?: string;
}

export interface PerTradeDiff {
  price_slippage: string;
  price_slippage_pct: string;
  timing_sec: number;
  qty_diff: string;
  fee_diff: string;
}

export interface PerTradeRow {
  ts: string;
  symbol: string;
  side: string;
  name_key: string;
  values: Record<string, { price: string; qty: string; total_fee: string; ts: string }>;
  diff: PerTradeDiff;
}

export interface UnmatchedFill {
  client_fill_id: string;
  symbol: string;
  side: string;
  ts: string;
}

export interface AccountSeriesBlock {
  series_id: number;
  meta: Record<string, unknown>;
  metrics: Record<string, unknown>;
}

export interface StrategyBlock {
  matched: boolean;
  series: StrategySeriesBlock[];
}

export interface StrategySeriesBlock {
  series_id: number;
  metrics: Record<string, unknown>;
}

export interface ComparisonEquityCurve {
  series_id: number;
  name: string;
  equity_curve: EquityPoint[];
  drawdown_series: DrawdownPoint[];
}

export interface ExecutionDeltaGroup {
  name_key: string;
  symbol: string;
  baseline_series_id: number;
  other_series_id: number;
  daily_groups: number;
  weighted_avg_bps: string;
  estimated_pnl_impact: string;
  total_notional: string;
  note?: string;
}

export interface ComparisonResponse {
  meta: {
    base_currency: string;
    baseline_series_id?: number;
    date_range: { from: string; to: string };
    currency_mismatch_series: number[];
  };
  account: { series: AccountSeriesBlock[] };
  strategy: Record<string, StrategyBlock>;
  per_trade: {
    page: number;
    page_size: number;
    total: number;
    rows: PerTradeRow[];
    unmatched: Record<string, UnmatchedFill[]>;
  };
  equity_curves: ComparisonEquityCurve[];
  execution?: {
    groups: ExecutionDeltaGroup[];
  };
  pnl_breakdown?: {
    first_name: string;
    second_name: string;
    rows: PnlBreakdownRow[];
  };
}

export interface PnlBreakdownRow {
  month: string;
  name_key: string;
  first_pnl: string;
  second_pnl: string;
  total_delta: string;
  shared_delta: string;
  date_delta: string;
}

export interface FillOut {
  id: number;
  strategy_name: string;
  symbol: string;
  side: string;
  qty: string;
  price: string;
  commission: string;
  ts: string;
  client_fill_id: string;
  signal_id: string | null;
}

export interface StrategyCapital {
  strategy_id: number;
  name_key: string;
  name: string;
  capital: string;
  pnl: string;
  net_value: string;
}

export interface SeriesCapital {
  free_cash: string;
  strategies: StrategyCapital[];
  account_total: string;
}

export interface FundMovement {
  client_movement_id: string;
  ts: string;
  currency: string;
  amount: string;
  from_bucket: string;
  to_bucket: string;
  from_strategy: string | null;
  to_strategy: string | null;
}
