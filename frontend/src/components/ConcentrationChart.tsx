import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useTranslation } from "react-i18next";

interface ConcentrationPoint {
  pct_trades: string;
  trade_count: number;
  cum_pnl_pct: string;
}

interface ConcentrationChartProps {
  gainCurve: ConcentrationPoint[];
  lossCurve: ConcentrationPoint[];
}

const ConcentrationChart = React.memo(function ConcentrationChart({ gainCurve, lossCurve }: ConcentrationChartProps) {
  const { t } = useTranslation("dashboard");
  const hasGain = gainCurve && gainCurve.length > 0;
  const hasLoss = lossCurve && lossCurve.length > 0;

  // Merge gain and loss into unified dataset keyed by pct_trades
  const pctLabels = ["1", "2", "5", "10", "20", "50"];
  const data = pctLabels.map((pct) => {
    const gain = gainCurve?.find((g) => g.pct_trades === pct);
    const loss = lossCurve?.find((l) => l.pct_trades === pct);
    return {
      label: `Top ${pct}%`,
      gain: gain ? Number(gain.cum_pnl_pct) * 100 : 0,
      gainCount: gain?.trade_count ?? 0,
      loss: loss ? Number(loss.cum_pnl_pct) * 100 : 0,
      lossCount: loss?.trade_count ?? 0,
    };
  });

  if (!hasGain && !hasLoss) return null;

  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <h3 className="mb-1 text-sm font-semibold text-primary">{t("PnL Concentration")}</h3>
      <p className="mb-3 text-xs text-muted">
        {t("What % of total gains/losses come from the top trades. Steep bars = concentrated risk.")}
      </p>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
          <BarChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              tick={{ fontSize: 10, fill: "#888" }}
              axisLine={false}
              tickLine={false}
              width={40}
              domain={[0, 100]}
            />
            <Tooltip
              cursor={false}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
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
                    <div style={{ color: "rgb(var(--text-muted))", marginBottom: 4, fontSize: "10px" }}>{label}</div>
                    {payload.map((entry, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span
                          className="inline-block w-2 h-2 rounded-sm"
                          style={{ backgroundColor: entry.color }}
                        />
                        <span style={{ color: "rgb(var(--text-secondary))" }}>
                          {entry.name === "gain" ? t("Gain") : t("Loss")}:
                        </span>
                        <span className="font-mono" style={{ color: "rgb(var(--text-primary))" }}>
                          {Number(entry.value).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            {hasGain && (
              <Bar dataKey="gain" name="gain" fill="rgb(var(--pnl-gain))" fillOpacity={0.4} radius={[3, 3, 0, 0]} maxBarSize={24} activeBar={false} />
            )}
            {hasLoss && (
              <Bar dataKey="loss" name="loss" fill="rgb(var(--pnl-loss))" fillOpacity={0.4} radius={[3, 3, 0, 0]} maxBarSize={24} activeBar={false} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});

export default ConcentrationChart;
