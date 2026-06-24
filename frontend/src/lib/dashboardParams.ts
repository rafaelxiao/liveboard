import type { Level } from "./types";

export interface DashboardParams {
  series: number;
  level: Level;
  strategy?: string;
  symbol?: string;
  from?: string;
  to?: string;
  trade_grouping?: string;
}

export function paramsToSearch(p: DashboardParams): string {
  const qs = new URLSearchParams();
  qs.set("series", String(p.series));
  qs.set("level", p.level);
  if (p.strategy) qs.set("strategy", p.strategy);
  if (p.symbol) qs.set("symbol", p.symbol);
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  return qs.toString();
}

export function searchToParams(qs: string): DashboardParams {
  const p = new URLSearchParams(qs);
  return {
    series: Number(p.get("series")) || 0,
    level: (p.get("level") as Level) || "account",
    strategy: p.get("strategy") || undefined,
    symbol: p.get("symbol") || undefined,
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
  };
}

export const DEFAULT_PARAMS: DashboardParams = {
  series: 0,
  level: "account",
  trade_grouping: "day",
};
