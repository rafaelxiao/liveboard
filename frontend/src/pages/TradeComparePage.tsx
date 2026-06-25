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
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  ScatterChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

import { apiFetch } from "../api/client";
import { useSeriesList } from "../state/useSeries";
import { useThemeStore } from "../state/themeStore";
import type { FillOut } from "../lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtPnl(v: number): string {
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}`;
}

interface RoundTrip {
  buys: FillOut[];
  sells: FillOut[];
}

function pairFills(fills: FillOut[]): RoundTrip[] {
  const result: RoundTrip[] = [];
  const bQueue: FillOut[] = [];
  for (const f of fills) {
    if (f.side === "buy") {
      bQueue.push(f);
    } else {
      if (bQueue.length > 0) {
        result.push({ buys: [...bQueue], sells: [f] });
        bQueue.length = 0;
      }
    }
  }
  if (bQueue.length > 0) {
    result.push({ buys: [...bQueue], sells: [] });
  }
  return result;
}

function calcDailyPnl(fills: FillOut[]): number {
  let pnl = 0;
  const bQueue: FillOut[] = [];
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

function r2(v: number): string {
  return v.toFixed(2);
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
  const name1 = (seriesList as { id: number; name: string }[] | undefined)?.find((s) => s.id === series1)?.name || `Series ${series1}`;
  const name2 = (seriesList as { id: number; name: string }[] | undefined)?.find((s) => s.id === series2)?.name || `Series ${series2}`;

  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";

  // Theme-aware colors
  const axisColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const axisLineColor = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";
  const textColor = isDark ? "#d1d5db" : "#374151";
  const tooltipBg = isDark ? "#1f2937" : "#ffffff";
  const tooltipBorder = isDark ? "#374151" : "#e5e7eb";
  const tooltipText = isDark ? "#f3f4f6" : "#1f2937";
  const simColor = "#4fc3f7";
  const liveColor = "#ff8a65";

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
  const { datesByKind, allDates, fillsByDate1, fillsByDate2 } = useMemo(() => {
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

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calYear, setCalYear] = useState(0);
  const [calMonth, setCalMonth] = useState(0);

  useEffect(() => {
    if (allDates.length > 0 && !selectedDate) {
      const latest = allDates[allDates.length - 1];
      setSelectedDate(latest);
      const d = new Date(latest);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
    }
  }, [allDates, selectedDate]);

  useEffect(() => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
    }
  }, [selectedDate]);

  const navigateDay = useCallback(
    (dir: number) => {
      if (!selectedDate || allDates.length === 0) return;
      const idx = allDates.indexOf(selectedDate);
      if (idx === -1) return;
      setSelectedDate(allDates[Math.max(0, Math.min(allDates.length - 1, idx + dir))]);
    },
    [selectedDate, allDates],
  );
  const goFirst = useCallback(() => setSelectedDate(allDates[0]), [allDates]);
  const goLast = useCallback(() => setSelectedDate(allDates[allDates.length - 1]), [allDates]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") navigateDay(-1);
      else if (e.key === "ArrowRight") navigateDay(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigateDay]);

  const todayStr = ymd(new Date());
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayNames = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  const calendarDays = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startPad = firstDay.getDay();
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

  // --- Chart option ---
  const chartOption = useMemo(() => {
    if (!selectedDate) return {};
    const f1 = fillsByDate1?.get(selectedDate) || [];
    const f2 = fillsByDate2?.get(selectedDate) || [];

    const simBuys: [number, number, string][] = [];
    const simSells: [number, number, string][] = [];
    const liveBuys: [number, number, string][] = [];
    const liveSells: [number, number, string][] = [];
    const pairLines: { coords: [number, number][] }[] = [];

    const rts1 = pairFills(f1);
    const rts2 = pairFills(f2);

    for (const f of f1) {
      const t = new Date(f.ts).getTime();
      const p = parseFloat(f.price);
      const rts = rts1.find((rt) => rt.buys.includes(f) || rt.sells.includes(f));
      const rtp = rts && rts.buys.length > 0 && rts.sells.length > 0
        ? (parseFloat(rts.sells[0].price) - parseFloat(rts.buys[rts.buys.length - 1].price)) * parseFloat(rts.sells[0].qty)
        : 0;
      const label = `${f.side} · ${name1}\nPrice: ${r2(p)} · Qty: ${r2(parseFloat(f.qty))}\nTime: ${f.ts.slice(11, 19)}\nRT PnL: ${fmtPnl(rtp)}`;
      if (f.side === "buy") simBuys.push([t, p, label]);
      else simSells.push([t, p, label]);
    }
    for (const f of f2) {
      const t = new Date(f.ts).getTime();
      const p = parseFloat(f.price);
      const rts = rts2.find((rt) => rt.buys.includes(f) || rt.sells.includes(f));
      const rtp = rts && rts.buys.length > 0 && rts.sells.length > 0
        ? (parseFloat(rts.sells[0].price) - parseFloat(rts.buys[rts.buys.length - 1].price)) * parseFloat(rts.sells[0].qty)
        : 0;
      const label = `${f.side} · ${name2}\nPrice: ${r2(p)} · Qty: ${r2(parseFloat(f.qty))}\nTime: ${f.ts.slice(11, 19)}\nRT PnL: ${fmtPnl(rtp)}`;
      if (f.side === "buy") liveBuys.push([t, p, label]);
      else liveSells.push([t, p, label]);
    }
    for (const rt of [...rts1, ...rts2]) {
      if (rt.buys.length > 0 && rt.sells.length > 0) {
        const buy = rt.buys[rt.buys.length - 1];
        const sell = rt.sells[0];
        pairLines.push({
          coords: [
            [new Date(buy.ts).getTime(), parseFloat(buy.price)],
            [new Date(sell.ts).getTime(), parseFloat(sell.price)],
          ],
        });
      }
    }

    // Build line segments for paired buy→sell links
    const lineData: ([number, number] | null)[] = [];
    for (const pl of pairLines) {
      lineData.push(pl.coords[0]);
      lineData.push(pl.coords[1]);
      lineData.push(null); // break between pairs
    }
    const lineColor = isDark ? "rgba(156,163,175,0.45)" : "rgba(107,114,128,0.35)";

    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { data?: [number, number, string] }) =>
          p.data ? `<div style="font-size:11px;line-height:1.7">${p.data[2].replace(/\n/g, "<br/>")}</div>` : "",
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        textStyle: { color: tooltipText },
        extraCssText: "border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,.3);",
      },
      legend: {
        data: [
          `${name1} ${t("buy")}`, `${name1} ${t("sell")}`,
          `${name2} ${t("buy")}`, `${name2} ${t("sell")}`,
        ],
        textStyle: { color: textColor, fontSize: 11 },
        top: 4,
        itemWidth: 12,
        itemHeight: 12,
      },
      grid: { top: 40, right: 24, bottom: 24, left: 60 },
      xAxis: {
        type: "time",
        axisLabel: { formatter: "{HH}:{mm}", color: axisColor, fontSize: 10 },
        axisLine: { lineStyle: { color: axisLineColor } },
        axisTick: { lineStyle: { color: axisLineColor } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: t("price"),
        nameTextStyle: { color: axisColor, fontSize: 10 },
        scale: true,
        axisLabel: { color: axisColor, fontSize: 10 },
        axisLine: { lineStyle: { color: axisLineColor } },
        axisTick: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: gridColor } },
      },
      series: [
        {
          name: "pair-link",
          type: "line",
          data: lineData,
          symbol: "none",
          lineStyle: { color: lineColor, type: "dashed", width: 1 },
          silent: true,
          showSymbol: false,
          legendHoverLink: false,
          z: 1,
        },
        {
          name: `${name1} ${t("buy")}`,
          type: "scatter",
          data: simBuys,
          symbol: "circle",
          symbolSize: 10,
          itemStyle: { color: simColor },
          z: 2,
        },
        {
          name: `${name1} ${t("sell")}`,
          type: "scatter",
          data: simSells,
          symbol: "diamond",
          symbolSize: 10,
          itemStyle: { color: simColor },
          z: 2,
        },
        {
          name: `${name2} ${t("buy")}`,
          type: "scatter",
          data: liveBuys,
          symbol: "circle",
          symbolSize: 10,
          itemStyle: { color: liveColor },
        },
        {
          name: `${name2} ${t("sell")}`,
          type: "scatter",
          data: liveSells,
          symbol: "diamond",
          symbolSize: 10,
          itemStyle: { color: liveColor },
          z: 2,
        },
      ],
      backgroundColor: "transparent",
    };
  }, [selectedDate, fillsByDate1, fillsByDate2, name1, name2, t, tooltipBg, tooltipBorder, tooltipText, axisColor, axisLineColor, gridColor, textColor, simColor, liveColor, isDark]);

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
  const selPnl1 = calcDailyPnl(selF1);
  const selPnl2 = calcDailyPnl(selF2);

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold text-primary">
            {strategy} — {name1} vs {name2} · {t("title")}
          </h2>
          <p className="text-xs text-secondary mt-0.5">
            {fills1.length + fills2.length} {t("fills")} · {allDates.length} {t("tradingDays")}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-secondary">{t("loading")}</div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Calendar sidebar */}
          <div className="w-[260px] shrink-0 border-r border-border-default p-3 overflow-y-auto flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <button
                onClick={() => { const m = calMonth - 1; if (m < 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(m); }}
                className="text-secondary hover:text-primary text-sm px-1"
              >&lt;</button>
              <span className="text-primary text-sm font-medium">{monthNames[calMonth]} {calYear}</span>
              <button
                onClick={() => { const m = calMonth + 1; if (m > 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(m); }}
                className="text-secondary hover:text-primary text-sm px-1"
              >&gt;</button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {dayNames.map((d) => <div key={d} className="text-[10px] text-secondary py-1">{d}</div>)}
            </div>
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
                    className={`w-full aspect-square rounded text-[11px] flex items-center justify-center ${isSelected ? "ring-2 ring-white" : ""} ${d.isToday ? "font-bold" : ""} ${d.kind !== "none" ? "hover:opacity-80 cursor-pointer" : ""} ${bgClass}`}
                  >
                    {d.date.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="text-[10px] text-secondary mt-2 space-y-1">
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#4caf50]"></span> {t("bothTraded")}</div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#4fc3f7]"></span> {t("simOnly", { name: name1 })}</div>
              <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#ff8a65]"></span> {t("liveOnly", { name: name2 })}</div>
              <div className="mt-3 pt-3 border-t border-border-subtle space-y-1">
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#4fc3f7]"></span> {name1} {t("buy")}</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[#4fc3f7] rotate-45"></span> {name1} {t("sell")}</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#ff8a65]"></span> {name2} {t("buy")}</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[#ff8a65] rotate-45"></span> {name2} {t("sell")}</div>
              </div>
            </div>
          </div>

          {/* Chart area */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 min-h-0">
              <ReactEChartsCore
                echarts={echarts}
                option={chartOption}
                style={{ height: "100%", width: "100%" }}
                notMerge
              />
            </div>

            {/* Navigation + PnL bar */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-border-default bg-surface shrink-0">
              <div className="flex items-center gap-1">
                <button onClick={goFirst} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">|◀</button>
                <button onClick={() => navigateDay(-1)} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">{t("prev")}</button>
              </div>
              <span className="text-sm font-mono text-primary">{selectedDate || "—"}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => navigateDay(1)} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">{t("next")}</button>
                <button onClick={goLast} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">▶|</button>
              </div>
            </div>
            <div className="flex items-center gap-6 px-4 py-1.5 border-t border-border-default text-xs shrink-0">
              <span>
                <span className="text-[#4fc3f7] font-medium">{name1}:</span>{" "}
                <span className="text-secondary">{selF1.length} {t("fills")}</span>
                {" · "}
                <span className={selPnl1 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(selPnl1)}</span>
              </span>
              <span>
                <span className="text-[#ff8a65] font-medium">{name2}:</span>{" "}
                <span className="text-secondary">{selF2.length} {t("fills")}</span>
                {" · "}
                <span className={selPnl2 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(selPnl2)}</span>
              </span>
              <span>
                <span className="text-secondary">{t("delta")}:</span>{" "}
                <span className={selPnl1 - selPnl2 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(selPnl1 - selPnl2)}</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
