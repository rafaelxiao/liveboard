import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/client";
import type { FillOut } from "../../lib/types";

interface DateGroups {
  datesByKind: { shared: string[]; simOnly: string[]; liveOnly: string[] };
  allDates: string[];
  fillsByDate1: Map<string, FillOut[]>;
  fillsByDate2: Map<string, FillOut[]>;
}

export function useTradeData(series1: number, series2: number, strategy: string) {
  const [fills1, setFills1] = useState<FillOut[]>([]);
  const [fills2, setFills2] = useState<FillOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!series1 || !series2 || !strategy) return;
    setLoading(true);
    Promise.all([
      apiFetch<FillOut[]>(`/series/${series1}/fills?strategy_name=${strategy}&limit=5000`),
      apiFetch<FillOut[]>(`/series/${series2}/fills?strategy_name=${strategy}&limit=5000`),
    ])
      .then(([r1, r2]) => {
        setFills1(r1);
        setFills2(r2);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [series1, series2, strategy]);

  const dateGroups: DateGroups = useMemo(() => {
    const d1 = new Map<string, FillOut[]>();
    const d2 = new Map<string, FillOut[]>();
    for (const f of fills1) {
      const dt = f.ts.slice(0, 10);
      if (!d1.has(dt)) d1.set(dt, []);
      d1.get(dt)!.push(f);
    }
    for (const f of fills2) {
      const dt = f.ts.slice(0, 10);
      if (!d2.has(dt)) d2.set(dt, []);
      d2.get(dt)!.push(f);
    }
    const shared: string[] = [];
    const simOnly: string[] = [];
    const liveOnly: string[] = [];
    const all = new Set([...d1.keys(), ...d2.keys()]);
    for (const k of all) {
      if (d1.has(k) && d2.has(k)) shared.push(k);
      else if (d1.has(k)) simOnly.push(k);
      else liveOnly.push(k);
    }
    shared.sort();
    simOnly.sort();
    liveOnly.sort();
    return {
      datesByKind: { shared, simOnly, liveOnly },
      allDates: [...shared, ...simOnly, ...liveOnly].sort(),
      fillsByDate1: d1,
      fillsByDate2: d2,
    };
  }, [fills1, fills2]);

  return { fills1, fills2, loading, ...dateGroups };
}
