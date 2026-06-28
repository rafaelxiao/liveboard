import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import ReactEChartsCore from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { useThemeStore } from "../../state/themeStore";
import type { FillOut } from "../../lib/types";
import { pairFills, fmtPnl, r2 } from "./helpers";

interface Props {
  fills1: FillOut[];
  fills2: FillOut[];
  name1: string;
  name2: string;
  selectedDate: string;
}

export default function TradeScatterChart({ fills1, fills2, name1, name2, selectedDate }: Props) {
  const { t } = useTranslation("tradeCompare");
  const isDark = useThemeStore((s) => s.theme) === "dark";

  const axisColor = isDark ? "#6b7280" : "#9ca3af";
  const gridColor = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)";
  const axisLineColor = isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";
  const textColor = isDark ? "#d1d5db" : "#374151";
  const tooltipBg = isDark ? "#1f2937" : "#ffffff";
  const tooltipBorder = isDark ? "#374151" : "#e5e7eb";
  const tooltipText = isDark ? "#f3f4f6" : "#1f2937";
  const simColor = "#4fc3f7";
  const liveColor = "#ff8a65";

  const option = useMemo(() => {
    if (!selectedDate) return {};
    const f1 = fills1;
    const f2 = fills2;

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

    const lineData: ([number, number] | null)[] = [];
    for (const pl of pairLines) {
      lineData.push(pl.coords[0]);
      lineData.push(pl.coords[1]);
      lineData.push(null);
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
  }, [fills1, fills2, name1, name2, t, selectedDate, isDark, tooltipBg, tooltipBorder, tooltipText, axisColor, axisLineColor, gridColor, textColor, simColor, liveColor]);

  return (
    <div className="flex-1 min-h-0">
      <ReactEChartsCore
        echarts={echarts}
        option={option}
        style={{ height: "100%", width: "100%" }}
        notMerge
      />
    </div>
  );
}
