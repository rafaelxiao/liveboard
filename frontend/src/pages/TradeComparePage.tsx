import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { ScatterChart, LineChart, BarChart } from "echarts/charts";
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
  BarChart,
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
  // orphan buys at end
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

  // Mode
  const [viewMode, setViewMode] = useState<"intraday" | "multiday">("intraday");

  // Intraday state
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calYear, setCalYear] = useState(0);
  const [calMonth, setCalMonth] = useState(0);

  // Multi-day state
  const [mdFrom, setMdFrom] = useState("");
  const [mdTo, setMdTo] = useState("");

  // Init
  useEffect(() => {
    if (allDates.length > 0) {
      const latest = allDates[allDates.length - 1];
      setSelectedDate(latest);
      const d = new Date(latest);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
      // multi-day: default to last 30 days
      const end = new Date(latest);
      const start = new Date(end);
      start.setDate(start.getDate() - 30);
      setMdFrom(ymd(start));
      setMdTo(ymd(end));
    }
  }, [allDates]);

  useEffect(() => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
    }
  }, [selectedDate]);

  // Navigation
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

  // Calendar data
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

  // --- Intraday chart option ---
  const intradayOption = useMemo(() => {
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
      const label = `${name1} · ${f.side}\nPrice: ${r2(p)} · Qty: ${r2(parseFloat(f.qty))}\nTime: ${f.ts.slice(11, 19)}\nRT PnL: ${fmtPnl(rtp)}`;
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
      const label = `${name2} · ${f.side}\nPrice: ${r2(p)} · Qty: ${r2(parseFloat(f.qty))}\nTime: ${f.ts.slice(11, 19)}\nRT PnL: ${fmtPnl(rtp)}`;
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

    const simColor = "#4fc3f7";
    const liveColor = "#ff8a65";

    const markLines = pairLines.map((pl) => ({
      coords: pl.coords,
      lineStyle: { color: "rgba(156,163,175,0.4)", type: "dashed" as const, width: 1 },
      symbol: "none",
    }));

    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { data?: [number, number, string] }) =>
          p.data ? `<div style="font-size:11px;line-height:1.6">${p.data[2].replace(/\n/g, "<br/>")}</div>` : "",
        backgroundColor: "var(--color-surface, #1f2937)",
        borderColor: "var(--color-border, #374151)",
        textStyle: { color: "var(--color-primary, #f3f4f6)" },
        extraCssText: "border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,.3);",
      },
      legend: {
        data: [`${name1} ${t("buy")}`, `${name1} ${t("sell")}`, `${name2} ${t("buy")}`, `${name2} ${t("sell")}`],
        textStyle: { color: "var(--color-secondary, #9ca3af)", fontSize: 11 },
        top: 4,
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { top: 40, right: 24, bottom: 24, left: 64 },
      xAxis: {
        type: "time",
        axisLabel: { formatter: "{HH}:{mm}", color: "var(--color-secondary, #9ca3af)", fontSize: 10 },
        axisLine: { lineStyle: { color: "var(--color-border, #374151)" } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: t("price"),
        scale: true,
        nameTextStyle: { color: "var(--color-secondary, #9ca3af)", fontSize: 10 },
        axisLabel: { color: "var(--color-secondary, #9ca3af)", fontSize: 10 },
        splitLine: { lineStyle: { color: "var(--color-border-subtle, #1f2937)" } },
      },
      series: [
        {
          name: `${name1} ${t("buy")}`,
          type: "scatter",
          data: simBuys,
          symbol: "emptyCircle",
          symbolSize: 9,
          itemStyle: { color: simColor, borderColor: simColor, borderWidth: 1.5 },
          markLine: { silent: true, symbol: "none", data: markLines },
        },
        {
          name: `${name1} ${t("sell")}`,
          type: "scatter",
          data: simSells,
          symbol: "circle",
          symbolSize: 9,
          itemStyle: { color: simColor },
        },
        {
          name: `${name2} ${t("buy")}`,
          type: "scatter",
          data: liveBuys,
          symbol: "emptyCircle",
          symbolSize: 9,
          itemStyle: { color: liveColor, borderColor: liveColor, borderWidth: 1.5 },
        },
        {
          name: `${name2} ${t("sell")}`,
          type: "scatter",
          data: liveSells,
          symbol: "circle",
          symbolSize: 9,
          itemStyle: { color: liveColor },
        },
      ],
      backgroundColor: "transparent",
    };
  }, [selectedDate, fillsByDate1, fillsByDate2, name1, name2, t]);

  // --- Multi-day chart option ---
  const multidayOption = useMemo(() => {
    if (!mdFrom || !mdTo) return {};
    const f1 = fills1.filter((f) => f.ts >= mdFrom && f.ts < mdTo + "T23:59:59");
    const f2 = fills2.filter((f) => f.ts >= mdFrom && f.ts < mdTo + "T23:59:59");

    const simBuys: [string, number, string][] = [];
    const simSells: [string, number, string][] = [];
    const liveBuys: [string, number, string][] = [];
    const liveSells: [string, number, string][] = [];

    const rts1 = pairFills(f1);
    const rts2 = pairFills(f2);

    for (const f of f1) {
      const ts = f.ts.slice(0, 19).replace("T", " ");
      const p = parseFloat(f.price);
      const rts = rts1.find((rt) => rt.buys.includes(f) || rt.sells.includes(f));
      const rtp = rts && rts.buys.length > 0 && rts.sells.length > 0
        ? (parseFloat(rts.sells[0].price) - parseFloat(rts.buys[rts.buys.length - 1].price)) * parseFloat(rts.sells[0].qty)
        : 0;
      const label = `${name1} · ${f.side}\nDate: ${f.ts.slice(0, 10)} ${f.ts.slice(11, 19)}\nPrice: ${r2(p)} · Qty: ${r2(parseFloat(f.qty))}\nRT PnL: ${fmtPnl(rtp)}`;
      if (f.side === "buy") simBuys.push([ts, p, label]);
      else simSells.push([ts, p, label]);
    }
    for (const f of f2) {
      const ts = f.ts.slice(0, 19).replace("T", " ");
      const p = parseFloat(f.price);
      const rts = rts2.find((rt) => rt.buys.includes(f) || rt.sells.includes(f));
      const rtp = rts && rts.buys.length > 0 && rts.sells.length > 0
        ? (parseFloat(rts.sells[0].price) - parseFloat(rts.buys[rts.buys.length - 1].price)) * parseFloat(rts.sells[0].qty)
        : 0;
      const label = `${name2} · ${f.side}\nDate: ${f.ts.slice(0, 10)} ${f.ts.slice(11, 19)}\nPrice: ${r2(p)} · Qty: ${r2(parseFloat(f.qty))}\nRT PnL: ${fmtPnl(rtp)}`;
      if (f.side === "buy") liveBuys.push([ts, p, label]);
      else liveSells.push([ts, p, label]);
    }

    const simColor = "#4fc3f7";
    const liveColor = "#ff8a65";

    // Daily PnL bars
    const dailyBars1: [string, number][] = [];
    const dailyBars2: [string, number][] = [];
    const byDate1 = new Map<string, FillOut[]>();
    const byDate2 = new Map<string, FillOut[]>();
    for (const f of f1) {
      const d = f.ts.slice(0, 10);
      if (!byDate1.has(d)) byDate1.set(d, []);
      byDate1.get(d)!.push(f);
    }
    for (const f of f2) {
      const d = f.ts.slice(0, 10);
      if (!byDate2.has(d)) byDate2.set(d, []);
      byDate2.get(d)!.push(f);
    }
    const allMdDays = new Set([...byDate1.keys(), ...byDate2.keys()]);
    for (const d of [...allMdDays].sort()) {
      dailyBars1.push([d, calcDailyPnl(byDate1.get(d) || [])]);
      dailyBars2.push([d, calcDailyPnl(byDate2.get(d) || [])]);
    }

    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { data?: [string, number, string] }) =>
          p.data && p.data.length > 2
            ? `<div style="font-size:11px;line-height:1.6">${p.data[2].replace(/\n/g, "<br/>")}</div>`
            : "",
        backgroundColor: "var(--color-surface, #1f2937)",
        borderColor: "var(--color-border, #374151)",
        textStyle: { color: "var(--color-primary, #f3f4f6)" },
        extraCssText: "border-radius:8px;padding:8px 12px;box-shadow:0 4px 12px rgba(0,0,0,.3);",
      },
      legend: {
        data: [`${name1} ${t("buy")}`, `${name1} ${t("sell")}`, `${name2} ${t("buy")}`, `${name2} ${t("sell")}`],
        textStyle: { color: "var(--color-secondary, #9ca3af)", fontSize: 11 },
        top: 4,
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { top: 40, right: 24, bottom: 80, left: 64 },
      xAxis: {
        type: "category",
        data: dailyBars1.map(([d]) => d),
        axisLabel: { color: "var(--color-secondary, #9ca3af)", fontSize: 9, rotate: 45 },
        axisLine: { lineStyle: { color: "var(--color-border, #374151)" } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        name: t("price"),
        scale: true,
        nameTextStyle: { color: "var(--color-secondary, #9ca3af)", fontSize: 10 },
        axisLabel: { color: "var(--color-secondary, #9ca3af)", fontSize: 10 },
        splitLine: { lineStyle: { color: "var(--color-border-subtle, #1f2937)" } },
      },
      dataZoom: [{ type: "slider", bottom: 30, height: 20, textStyle: { fontSize: 9 } }],
      series: [
        {
          name: `${name1} ${t("buy")}`,
          type: "scatter",
          data: simBuys,
          symbol: "emptyCircle",
          symbolSize: 6,
          itemStyle: { color: simColor, borderColor: simColor, borderWidth: 1 },
        },
        {
          name: `${name1} ${t("sell")}`,
          type: "scatter",
          data: simSells,
          symbol: "circle",
          symbolSize: 6,
          itemStyle: { color: simColor },
        },
        {
          name: `${name2} ${t("buy")}`,
          type: "scatter",
          data: liveBuys,
          symbol: "emptyCircle",
          symbolSize: 6,
          itemStyle: { color: liveColor, borderColor: liveColor, borderWidth: 1 },
        },
        {
          name: `${name2} ${t("sell")}`,
          type: "scatter",
          data: liveSells,
          symbol: "circle",
          symbolSize: 6,
          itemStyle: { color: liveColor },
        },
      ],
      backgroundColor: "transparent",
    };
  }, [mdFrom, mdTo, fills1, fills2, name1, name2, t]);

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

  // Multi-day filtered for summary
  const mdF1 = fills1.filter((f) => f.ts >= mdFrom && f.ts < mdTo + "T23:59:59");
  const mdF2 = fills2.filter((f) => f.ts >= mdFrom && f.ts < mdTo + "T23:59:59");
  const mdPnl1 = calcDailyPnl(mdF1);
  const mdPnl2 = calcDailyPnl(mdF2);

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode("intraday")}
            className={`px-3 py-1.5 text-xs rounded ${viewMode === "intraday" ? "bg-accent text-white" : "bg-surface-2 text-secondary hover:text-primary"}`}
          >
            {t("intraday")}
          </button>
          <button
            onClick={() => setViewMode("multiday")}
            className={`px-3 py-1.5 text-xs rounded ${viewMode === "multiday" ? "bg-accent text-white" : "bg-surface-2 text-secondary hover:text-primary"}`}
          >
            {t("multiDay")}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-secondary">{t("loading")}</div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar — calendar (intraday) or date pickers (multi-day) */}
          {viewMode === "intraday" ? (
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
              </div>
            </div>
          ) : (
            <div className="w-[220px] shrink-0 border-r border-border-default p-3 flex flex-col gap-3">
              <label className="text-xs text-secondary">
                {t("from")}
                <input
                  type="date"
                  value={mdFrom}
                  onChange={(e) => setMdFrom(e.target.value)}
                  className="mt-1 block w-full rounded border border-border-default bg-surface px-2 py-1 text-xs text-primary"
                />
              </label>
              <label className="text-xs text-secondary">
                {t("to")}
                <input
                  type="date"
                  value={mdTo}
                  onChange={(e) => setMdTo(e.target.value)}
                  className="mt-1 block w-full rounded border border-border-default bg-surface px-2 py-1 text-xs text-primary"
                />
              </label>
              <div className="text-[10px] text-secondary mt-1 space-y-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full border border-[#4fc3f7]"></span> {name1} {t("buy")}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#4fc3f7]"></span> {name1} {t("sell")}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full border border-[#ff8a65]"></span> {name2} {t("buy")}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#ff8a65]"></span> {name2} {t("sell")}
                </div>
              </div>
            </div>
          )}

          {/* Chart area */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 min-h-0">
              <ReactEChartsCore
                echarts={echarts}
                option={viewMode === "intraday" ? intradayOption : multidayOption}
                style={{ height: "100%", width: "100%" }}
                notMerge
                theme="dark"
              />
            </div>

            {/* Bottom bar */}
            {viewMode === "intraday" ? (
              <>
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
              </>
            ) : (
              <div className="flex items-center gap-6 px-4 py-1.5 border-t border-border-default text-xs shrink-0">
                <span>
                  <span className="text-[#4fc3f7] font-medium">{name1}:</span>{" "}
                  <span className="text-secondary">{mdF1.length} {t("fills")}</span>
                  {" · "}
                  <span className={mdPnl1 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(mdPnl1)}</span>
                </span>
                <span>
                  <span className="text-[#ff8a65] font-medium">{name2}:</span>{" "}
                  <span className="text-secondary">{mdF2.length} {t("fills")}</span>
                  {" · "}
                  <span className={mdPnl2 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(mdPnl2)}</span>
                </span>
                <span>
                  <span className="text-secondary">{t("delta")}:</span>{" "}
                  <span className={mdPnl1 - mdPnl2 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(mdPnl1 - mdPnl2)}</span>
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
