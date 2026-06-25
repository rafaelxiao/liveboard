import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { ScatterChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  ScatterChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

import { apiFetch } from "../api/client";
import { useSeriesList } from "../state/useSeries";
import type { FillOut } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FillWithSim extends FillOut {
  isSim: boolean;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtPnl(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function TradeComparePage() {
  const { t } = useTranslation("tradeCompare");
  const [searchParams] = useSearchParams();
  const series1 = Number(searchParams.get("series_1") || "0");
  const series2 = Number(searchParams.get("series_2") || "0");
  const strategy = searchParams.get("strategy") || "";

  const { data: seriesList } = useSeriesList();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name1 = (seriesList as any)?.find((s: { id: number; name: string }) => s.id === series1)?.name || `Series ${series1}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name2 = (seriesList as any)?.find((s: { id: number; name: string }) => s.id === series2)?.name || `Series ${series2}`;

  // Data
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

  // Organize by date
  const { datesByKind, allDates } = useMemo(() => {
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
    const all = new Set<string>();
    for (const k of d1.keys()) all.add(k);
    for (const k of d2.keys()) all.add(k);
    for (const k of all) {
      const in1 = d1.has(k);
      const in2 = d2.has(k);
      if (in1 && in2) shared.push(k);
      else if (in1) simOnly.push(k);
      else liveOnly.push(k);
    }
    shared.sort();
    simOnly.sort();
    liveOnly.sort();
    return {
      datesByKind: { shared, simOnly, liveOnly, d1, d2 },
      allDates: [...shared, ...simOnly, ...liveOnly].sort(),
    };
  }, [fills1, fills2]);

  // Calendar state — start at the latest data year/month
  const [calYear, setCalYear] = useState(0);
  const [calMonth, setCalMonth] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"intraday" | "multiday">("intraday");

  // Set initial selected date and calendar month
  useEffect(() => {
    if (allDates.length > 0) {
      if (!selectedDate) {
        const latest = allDates[allDates.length - 1];
        setSelectedDate(latest);
        const d = new Date(latest);
        setCalYear(d.getFullYear());
        setCalMonth(d.getMonth());
      }
    }
  }, [allDates, selectedDate]);

  // When selected date changes, auto-scroll calendar month
  useEffect(() => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
    }
  }, [selectedDate]);

  const { d1: fillsByDate1, d2: fillsByDate2 } = datesByKind;
  const todayStr = ymd(new Date());

  // Navigation
  const navigateDay = useCallback(
    (dir: number) => {
      if (!selectedDate || allDates.length === 0) return;
      const idx = allDates.indexOf(selectedDate);
      if (idx === -1) return;
      const newIdx = Math.max(0, Math.min(allDates.length - 1, idx + dir));
      setSelectedDate(allDates[newIdx]);
    },
    [selectedDate, allDates],
  );

  const goFirst = useCallback(() => setSelectedDate(allDates[0]), [allDates]);
  const goLast = useCallback(() => setSelectedDate(allDates[allDates.length - 1]), [allDates]);

  // Keyboard nav
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") navigateDay(-1);
      else if (e.key === "ArrowRight") navigateDay(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigateDay]);

  // Calendar data
  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startPad = firstDay.getDay(); // 0=Sun
    const days: { date: Date; kind: "shared" | "simOnly" | "liveOnly" | "none"; isToday: boolean }[] = [];

    for (let i = 0; i < startPad; i++) {
      days.push({ date: new Date(calYear, calMonth, -startPad + i + 1), kind: "none", isToday: false });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dt = new Date(calYear, calMonth, d);
      const ds = ymd(dt);
      let kind: "shared" | "simOnly" | "liveOnly" | "none" = "none";
      if (datesByKind.shared.includes(ds)) kind = "shared";
      else if (datesByKind.simOnly.includes(ds)) kind = "simOnly";
      else if (datesByKind.liveOnly.includes(ds)) kind = "liveOnly";
      days.push({ date: dt, kind, isToday: ds === todayStr });
    }
    while (days.length % 7 !== 0) {
      const last = days[days.length - 1].date;
      days.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), kind: "none", isToday: false });
    }
    return days;
  }, [calYear, calMonth, datesByKind, todayStr]);

  // --- ECharts option for intraday ---
  const intradayOption = useMemo(() => {
    if (!selectedDate) return {};
    const f1 = fillsByDate1?.get(selectedDate) || [];
    const f2 = fillsByDate2?.get(selectedDate) || [];

    const simBuys: [number, number, string][] = [];
    const simSells: [number, number, string][] = [];
    const liveBuys: [number, number, string][] = [];
    const liveSells: [number, number, string][] = [];
    const pairLines: { coords: [number, number][] }[] = [];

    // Pair fills into round trips
    function pairFills(fills: FillOut[]): { buys: FillOut[]; sells: FillOut[] }[] {
      const result: { buys: FillOut[]; sells: FillOut[] }[] = [];
      const bQueue: FillOut[] = [];
      for (const f of fills) {
        if (f.side === "buy") {
          bQueue.push(f);
        } else {
          if (bQueue.length > 0) {
            result.push({ buys: [...bQueue], sells: [f] });
            bQueue.length = 0;
          } else {
            result.push({ buys: [], sells: [f] });
          }
        }
      }
      return result;
    }

    const rts1 = pairFills(f1);
    const rts2 = pairFills(f2);
    const allF1: FillWithSim[] = f1.map((f) => ({ ...f, isSim: true }));
    const allF2: FillWithSim[] = f2.map((f) => ({ ...f, isSim: false }));

    for (const f of allF1) {
      const t = new Date(f.ts).getTime();
      const p = parseFloat(f.price);
      const label = `${f.side} ${f.qty}\n${f.price}\n${f.client_fill_id}`;
      if (f.side === "buy") simBuys.push([t, p, label]);
      else simSells.push([t, p, label]);
    }
    for (const f of allF2) {
      const t = new Date(f.ts).getTime();
      const p = parseFloat(f.price);
      const label = `${f.side} ${f.qty}\n${f.price}\n${f.client_fill_id}`;
      if (f.side === "buy") liveBuys.push([t, p, label]);
      else liveSells.push([t, p, label]);
    }
    // Pair lines: connect buys to their paired sells
    for (const rt of rts1) {
      if (rt.buys.length === 0 || rt.sells.length === 0) continue;
      const buy = rt.buys[rt.buys.length - 1];
      const sell = rt.sells[0];
      pairLines.push({
        coords: [
          [new Date(buy.ts).getTime(), parseFloat(buy.price)],
          [new Date(sell.ts).getTime(), parseFloat(sell.price)],
        ],
      });
    }
    for (const rt of rts2) {
      if (rt.buys.length === 0 || rt.sells.length === 0) continue;
      const buy = rt.buys[rt.buys.length - 1];
      const sell = rt.sells[0];
      pairLines.push({
        coords: [
          [new Date(buy.ts).getTime(), parseFloat(buy.price)],
          [new Date(sell.ts).getTime(), parseFloat(sell.price)],
        ],
      });
    }

    const markLines = pairLines.map((pl, i) => ({
      name: `pair${i}`,
      coords: pl.coords,
      lineStyle: { color: "rgba(156, 163, 175, 0.5)", type: "dashed" as const, width: 1 },
      symbol: "none",
    }));

    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { data?: [number, number, string] }) =>
          p.data ? p.data[2].replace(/\n/g, "<br/>") : "",
        backgroundColor: "var(--color-surface, #1f2937)",
        borderColor: "var(--color-border, #374151)",
        textStyle: { color: "var(--color-primary, #f3f4f6)" },
      },
      legend: {
        data: [`${name1} ${t("buy")}`, `${name1} ${t("sell")}`, `${name2} ${t("buy")}`, `${name2} ${t("sell")}`],
        textStyle: { color: "var(--color-secondary, #9ca3af)" },
        top: 0,
      },
      grid: { top: 40, right: 40, bottom: 60, left: 60 },
      xAxis: {
        type: "time",
        axisLabel: {
          formatter: "{HH}:{mm}",
          color: "var(--color-secondary, #9ca3af)",
        },
        axisLine: { lineStyle: { color: "var(--color-border, #374151)" } },
      },
      yAxis: {
        type: "value",
        name: t("price"),
        scale: true,
        nameTextStyle: { color: "var(--color-secondary, #9ca3af)" },
        axisLabel: { color: "var(--color-secondary, #9ca3af)" },
        axisLine: { lineStyle: { color: "var(--color-border, #374151)" } },
        splitLine: { lineStyle: { color: "var(--color-border-subtle, #1f2937)" } },
      },
      series: [
        {
          name: `${name1} ${t("buy")}`,
          type: "scatter",
          data: simBuys,
          symbol: "rect",
          symbolSize: 10,
          itemStyle: { color: "#4fc3f7" },
          markLine: { silent: true, symbol: "none", data: markLines },
        },
        {
          name: `${name1} ${t("sell")}`,
          type: "scatter",
          data: simSells,
          symbol: "triangle",
          symbolSize: 10,
          symbolRotate: 180,
          itemStyle: { color: "#4fc3f7" },
        },
        {
          name: `${name2} ${t("buy")}`,
          type: "scatter",
          data: liveBuys,
          symbol: "rect",
          symbolSize: 10,
          itemStyle: { color: "#ff8a65" },
        },
        {
          name: `${name2} ${t("sell")}`,
          type: "scatter",
          data: liveSells,
          symbol: "triangle",
          symbolSize: 10,
          symbolRotate: 180,
          itemStyle: { color: "#ff8a65" },
        },
      ],
      backgroundColor: "transparent",
    };
  }, [selectedDate, fillsByDate1, fillsByDate2, name1, name2]);

  // Multi-day option
  const multidayOption = useMemo(() => {
    const allShared = datesByKind.shared;
    const pnlByDate1: [number, number][] = [];
    const pnlByDate2: [number, number][] = [];

    for (const dt of allShared) {
      const f1 = fillsByDate1?.get(dt) || [];
      const f2 = fillsByDate2?.get(dt) || [];
      const t = new Date(dt).getTime();

      function calcPnl(fills: FillOut[]): number {
        const bQueue: FillOut[] = [];
        let pnl = 0;
        for (const f of fills) {
          if (f.side === "buy") {
            bQueue.push(f);
          } else if (bQueue.length > 0) {
            const buy = bQueue[bQueue.length - 1];
            pnl += (parseFloat(f.price) - parseFloat(buy.price)) * parseFloat(f.qty);
            bQueue.length = 0;
          }
        }
        return pnl;
      }
      pnlByDate1.push([t, calcPnl(f1)]);
      pnlByDate2.push([t, calcPnl(f2)]);
    }

    return {
      tooltip: {
        trigger: "axis",
        backgroundColor: "var(--color-surface, #1f2937)",
        borderColor: "var(--color-border, #374151)",
        textStyle: { color: "var(--color-primary, #f3f4f6)" },
      },
      legend: {
        data: [`${name1} ${t("pnl")}`, `${name2} ${t("pnl")}`],
        textStyle: { color: "var(--color-secondary, #9ca3af)" },
        top: 0,
      },
      grid: { top: 40, right: 40, bottom: 60, left: 70 },
      xAxis: {
        type: "time",
        axisLabel: { color: "var(--color-secondary, #9ca3af)" },
        axisLine: { lineStyle: { color: "var(--color-border, #374151)" } },
      },
      yAxis: {
        type: "value",
        name: t("pnl"),
        scale: true,
        nameTextStyle: { color: "var(--color-secondary, #9ca3af)" },
        axisLabel: { color: "var(--color-secondary, #9ca3af)" },
        splitLine: { lineStyle: { color: "var(--color-border-subtle, #1f2937)" } },
      },
      series: [
        {
          name: `${name1} ${t("pnl")}`,
          type: "bar",
          data: pnlByDate1,
          itemStyle: { color: "#4fc3f7" },
        },
        {
          name: `${name2} ${t("pnl")}`,
          type: "bar",
          data: pnlByDate2,
          itemStyle: { color: "#ff8a65" },
        },
      ],
      backgroundColor: "transparent",
    };
  }, [datesByKind, fillsByDate1, fillsByDate2, name1, name2]);

  // --- Render ---
  if (!series1 || !series2 || !strategy) {
    return (
      <div className="p-8 text-secondary">
        Missing parameters. Use{" "}
        <code className="text-primary">?series_1=4&amp;series_2=5&amp;strategy=vwap_intra_day_2</code>
      </div>
    );
  }

  const selF1 = selectedDate ? fillsByDate1?.get(selectedDate) || [] : [];
  const selF2 = selectedDate ? fillsByDate2?.get(selectedDate) || [] : [];
  const selPnl1 = (() => {
    const b: FillOut[] = [];
    let pnl = 0;
    for (const f of selF1) {
      if (f.side === "buy") b.push(f);
      else if (b.length > 0) {
        pnl += (parseFloat(f.price) - parseFloat(b[b.length - 1].price)) * parseFloat(f.qty);
        b.length = 0;
      }
    }
    return pnl;
  })();
  const selPnl2 = (() => {
    const b: FillOut[] = [];
    let pnl = 0;
    for (const f of selF2) {
      if (f.side === "buy") b.push(f);
      else if (b.length > 0) {
        pnl += (parseFloat(f.price) - parseFloat(b[b.length - 1].price)) * parseFloat(f.qty);
        b.length = 0;
      }
    }
    return pnl;
  })();

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold text-primary">
            {strategy} — {name1} vs {name2}
          </h2>
          <p className="text-xs text-secondary mt-0.5">
            {fills1.length + fills2.length} {t("fills")} · {allDates.length} {t("tradingDays")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("intraday")}
            className={`px-3 py-1 text-xs rounded ${viewMode === "intraday" ? "bg-primary-500 text-white" : "bg-surface-2 text-secondary"}`}
          >
            {t("intraday")}
          </button>
          <button
            onClick={() => setViewMode("multiday")}
            className={`px-3 py-1 text-xs rounded ${viewMode === "multiday" ? "bg-primary-500 text-white" : "bg-surface-2 text-secondary"}`}
          >
            {t("multiDay")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-secondary">{t("loading")}</div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Calendar sidebar */}
          <div className="w-[260px] shrink-0 border-r border-border-default p-3 overflow-y-auto flex flex-col gap-3">
            {/* Month navigation */}
            <div className="flex items-center justify-between">
              <button onClick={() => { const m = calMonth - 1; if (m < 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(m); }} className="text-secondary hover:text-primary text-sm px-1">&lt;</button>
              <span className="text-primary text-sm font-medium">
                {monthNames[calMonth]} {calYear}
              </span>
              <button onClick={() => { const m = calMonth + 1; if (m > 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(m); }} className="text-secondary hover:text-primary text-sm px-1">&gt;</button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {dayNames.map((d) => (
                <div key={d} className="text-[10px] text-secondary py-1">{d}</div>
              ))}
            </div>

            {/* Calendar cells */}
            <div className="grid grid-cols-7 gap-0.5">
              {calendarDays.map((d, i) => {
                const ds = ymd(d.date);
                const isSelected = ds === selectedDate;
                const inMonth = d.date.getMonth() === calMonth;
                let bgClass = "bg-surface-2/50 text-secondary/40";
                if (d.kind === "shared") bgClass = "bg-[#4caf50] text-white";
                else if (d.kind === "simOnly") bgClass = "bg-[#4fc3f7] text-white";
                else if (d.kind === "liveOnly") bgClass = "bg-[#ff8a65] text-white";
                if (!inMonth) bgClass = "text-secondary/30";

                return (
                  <button
                    key={i}
                    onClick={() => d.kind !== "none" && setSelectedDate(ds)}
                    disabled={d.kind === "none"}
                    className={`
                      w-full aspect-square rounded text-[11px] flex items-center justify-center
                      ${isSelected ? "ring-2 ring-white" : ""}
                      ${d.isToday ? "font-bold" : ""}
                      ${d.kind !== "none" ? "hover:opacity-80 cursor-pointer" : ""}
                      ${bgClass}
                    `}
                  >
                    {d.date.getDate()}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="text-[10px] text-secondary mt-2 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-[#4caf50]"></span> {t("bothTraded")}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-[#4fc3f7]"></span> {t("simOnly", { name: name1 })}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-[#ff8a65]"></span> {t("liveOnly", { name: name2 })}
              </div>
            </div>
          </div>

          {/* Chart area */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Chart */}
            <div className="flex-1 min-h-0">
              {viewMode === "intraday" ? (
                <ReactEChartsCore
                  echarts={echarts}
                  option={intradayOption}
                  style={{ height: "100%", width: "100%" }}
                  notMerge
                  theme="dark"
                />
              ) : (
                <ReactEChartsCore
                  echarts={echarts}
                  option={multidayOption}
                  style={{ height: "100%", width: "100%" }}
                  notMerge
                  theme="dark"
                />
              )}
            </div>

            {/* Navigation bar */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border-default bg-surface shrink-0">
              <div className="flex items-center gap-1">
                <button onClick={goFirst} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">|◀</button>
                <button onClick={() => navigateDay(-1)} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">{t("prev")}</button>
              </div>
              <span className="text-sm font-mono text-primary">
                {selectedDate || "—"}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => navigateDay(1)} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">{t("next")}</button>
                <button onClick={goLast} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">▶|</button>
              </div>
            </div>

            {/* PnL summary */}
            <div className="flex items-center gap-6 px-4 py-1.5 border-t border-border-default text-xs shrink-0">
              <span>
                <span className="text-[#4fc3f7] font-medium">{name1}:</span>{" "}
                <span className="text-secondary">{selF1.length} {t("fills")}</span>
                {" · "}
                <span className={selPnl1 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>
                  {fmtPnl(selPnl1)}
                </span>
              </span>
              <span>
                <span className="text-[#ff8a65] font-medium">{name2}:</span>{" "}
                <span className="text-secondary">{selF2.length} {t("fills")}</span>
                {" · "}
                <span className={selPnl2 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>
                  {fmtPnl(selPnl2)}
                </span>
              </span>
              <span>
                <span className="text-secondary">{t("delta")}:</span>{" "}
                <span className={selPnl1 - selPnl2 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>
                  {fmtPnl(selPnl1 - selPnl2)}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
