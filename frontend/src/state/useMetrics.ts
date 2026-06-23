import { useQuery } from "@tanstack/react-query";
import type { DashboardParams } from "../lib/dashboardParams";
import type { MetricsEnvelope } from "../lib/types";
import { getMetrics } from "../api/metrics";

export function useMetrics(p: DashboardParams) {
  return useQuery<MetricsEnvelope>({
    queryKey: [
      "metrics", p.series, p.level, p.strategy ?? null, p.symbol ?? null,
      p.from ?? null, p.to ?? null,
    ],
    queryFn: () => getMetrics(p),
    enabled: !!p.series,
  });
}
