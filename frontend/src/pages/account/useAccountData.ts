import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import type { SeriesCapital, FundMovement } from "../../lib/types";

export function useAccountData(seriesId: number) {
  const [capital, setCapital] = useState<SeriesCapital | null>(null);
  const [committed, setCommitted] = useState<FundMovement[]>([]);
  const [stratCreationTimes, setStratCreationTimes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!seriesId) return;
    setLoading(true);
    Promise.all([
      apiFetch<SeriesCapital>(`/series/${seriesId}/capital`),
      apiFetch<FundMovement[]>(`/series/${seriesId}/fund-movements?limit=100`),
    ])
      .then(([cap, mov]) => {
        setCapital(cap);
        setCommitted(mov);
        // Infer strategy creation events from first allocation
        const stratFirstAlloc = new Map<string, string>();
        for (const m of mov) {
          if (m.to_bucket === "STRATEGY" && m.to_strategy) {
            if (!stratFirstAlloc.has(m.to_strategy) || m.ts < stratFirstAlloc.get(m.to_strategy)!) {
              stratFirstAlloc.set(m.to_strategy, m.ts);
            }
          }
        }
        setStratCreationTimes(new Set(stratFirstAlloc.keys()));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [seriesId]);

  /** Re-fetch after commit — keeps state in sync with server. */
  const refresh = async () => {
    const [cap, mov] = await Promise.all([
      apiFetch<SeriesCapital>(`/series/${seriesId}/capital`),
      apiFetch<FundMovement[]>(`/series/${seriesId}/fund-movements?limit=100`),
    ]);
    setCapital(cap);
    setCommitted(mov);
    const stratAlloc = new Map<string, string>();
    for (const m of mov) {
      if (m.to_bucket === "STRATEGY" && m.to_strategy) {
        if (!stratAlloc.has(m.to_strategy) || m.ts < stratAlloc.get(m.to_strategy)!) {
          stratAlloc.set(m.to_strategy, m.ts);
        }
      }
    }
    setStratCreationTimes(new Set(stratAlloc.keys()));
  };

  return { capital, committed, stratCreationTimes, loading, refresh };
}
