import React from "react";
import { useTranslation } from "react-i18next";
import type { EquityPoint } from "../lib/types";
import { formatCurrency } from "../lib/format";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

interface EquityChartProps {
  points: EquityPoint[];
  baseCurrency: string;
  mode: "absolute" | "indexed";
  onModeChange: (mode: "absolute" | "indexed") => void;
}

const EquityChart = React.memo(function EquityChart({ points, baseCurrency, mode, onModeChange }: EquityChartProps) {
  const { t } = useTranslation("dashboard");
  const activeKey = mode === "absolute" ? "realized_pnl" : "indexed_return";
  const formatValue = (v: number) => mode === "absolute" ? formatCurrency(String(v), baseCurrency) : (v * 100).toFixed(2) + "%";

  const data = points.map((p) => ({
    ts: p.ts,
    value: Number(p[activeKey]),
  }));

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary">{t("Equity Curve")}</h3>
        <div className="inline-flex rounded-md border border-border-default">
          <button
            type="button"
            onClick={() => onModeChange("absolute")}
            className={`px-2 py-1 text-xs rounded-l-md ${mode === "absolute" ? "bg-accent text-white" : "bg-surface text-secondary"}`}
          >
            {t("Absolute")}
          </button>
          <button
            type="button"
            onClick={() => onModeChange("indexed")}
            className={`px-2 py-1 text-xs rounded-r-md ${mode === "indexed" ? "bg-accent text-white" : "bg-surface text-secondary"}`}
          >
            {t("Indexed")}
          </button>
        </div>
      </div>
      <div className="h-72 w-full" style={{ minHeight: "288px" }}>
        <ResponsiveContainer width="99%" height="99%">
          <LineChart data={data} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" strokeOpacity={0.3} />
            <ReferenceLine y={0} stroke="#666" strokeOpacity={0.5} />
            <XAxis
              dataKey="ts"
              tickFormatter={(ts: string) => {
                const d = new Date(ts);
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={(v: number) => formatValue(v)}
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0 || !payload[0]) return null;
                const val = Number(payload[0].value);
                return (
                  <div
                    style={{
                      backgroundColor: "rgb(var(--bg-surface-3))",
                      color: "rgb(var(--text-primary))",
                      border: "1px solid rgb(var(--border-default))",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "12px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
                    }}
                  >
                    <div style={{ color: "rgb(var(--text-muted))", marginBottom: 2, fontSize: "10px" }}>
                      {new Date(String(label ?? "")).toLocaleString()}
                    </div>
                    <div className="font-mono" style={{ color: "rgb(var(--text-primary))" }}>
                      {formatValue(val)}
                    </div>
                  </div>
                );
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="rgb(var(--accent-primary))"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "rgb(var(--accent-primary))" }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
        <p className="mt-1 text-center text-[10px] text-muted">
          {mode === "absolute" ? `${t("Cumulative PnL")} (${baseCurrency})` : t("Cumulative Return")} · {data.length} {t("points")}
        </p>
      </div>
    </div>
  );
});

export default EquityChart;
