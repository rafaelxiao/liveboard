import React from "react";
import { useTranslation } from "react-i18next";
import type { DrawdownPoint } from "../lib/types";
import { formatCurrency } from "../lib/format";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface DrawdownChartProps {
  points: DrawdownPoint[];
  baseCurrency: string;
  showCaveat?: boolean;
  mode: "absolute" | "indexed";
  onModeChange: (mode: "absolute" | "indexed") => void;
}

const DrawdownChart = React.memo(function DrawdownChart({ points, baseCurrency, showCaveat, mode, onModeChange }: DrawdownChartProps) {
  const { t } = useTranslation("dashboard");
  const activeKey = mode === "absolute" ? "drawdown" : "drawdown_pct";
  const formatValue = (v: number) => mode === "absolute" ? formatCurrency(String(v), baseCurrency) : (v * 100).toFixed(2) + "%";

  const data = points.map((p) => ({
    ts: p.ts,
    value: Number(p[activeKey]),
  }));

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-primary">
          {t("Drawdown")}
          {showCaveat && (
            <span className="ml-2 rounded bg-warning/20 px-1 text-[10px] uppercase text-warning" title={t("Max DD may understate risk — open positions exist")}>
              {t("DD CAVEAT")}
            </span>
          )}
        </h3>
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
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 5, bottom: 2, left: 5 }}>
            <defs>
              <linearGradient id="ddGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--pnl-loss))" stopOpacity={0.25} />
                <stop offset="100%" stopColor="rgb(var(--pnl-loss))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
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
            <Area
              type="monotone"
              dataKey="value"
              stroke="rgb(var(--pnl-loss))"
              fill="url(#ddGradient)"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export default DrawdownChart;
