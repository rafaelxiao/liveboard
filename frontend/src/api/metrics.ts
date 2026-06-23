import type { MetricsEnvelope } from "../lib/types";
import type { DashboardParams } from "../lib/dashboardParams";
import { apiFetch } from "./client";

export function getMetrics(params: DashboardParams): Promise<MetricsEnvelope> {
  const qs = new URLSearchParams();
  qs.set("level", params.level);
  if (params.strategy) qs.set("strategy", params.strategy);
  if (params.symbol) qs.set("symbol", params.symbol);
  if (params.from) qs.set("date_from", params.from);
  if (params.to) qs.set("date_to", params.to);
  return apiFetch<MetricsEnvelope>(`/series/${params.series}/metrics?${qs.toString()}`);
}
