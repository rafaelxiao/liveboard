import { useTranslation } from "react-i18next";
import type { StrategyCapital } from "../../lib/types";
import type { Balances } from "./useStaging";

function fmt(v: string): string {
  const n = parseFloat(v);
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtAbs(v: string): string {
  const n = parseFloat(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  strategies: StrategyCapital[];
  balances: Balances;
  onDelete: (nameKey: string) => void;
}

export default function StrategyTable({ strategies, balances, onDelete }: Props) {
  const { t } = useTranslation("capital");
  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-default bg-surface-2">
        <h3 className="text-sm font-medium text-primary">{t("strategyAllocations")}</h3>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-default bg-surface-2/50">
            <th className="text-left py-2 px-4 font-medium text-secondary">{t("strategy")}</th>
            <th className="text-right py-2 px-4 font-medium text-secondary">{t("capital")}</th>
            <th className="text-right py-2 px-4 font-medium text-secondary">{t("pnl")}</th>
            <th className="text-right py-2 px-4 font-medium text-secondary">{t("netValue")}</th>
            <th className="text-right py-2 px-4 font-medium text-secondary">{t("returnPct")}</th>
            <th className="text-right py-2 px-4 font-medium text-secondary">{t("projected")}</th>
            <th className="w-8"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {strategies.map((s) => {
            const retPct = parseFloat(s.capital) > 0 ? (parseFloat(s.pnl) / parseFloat(s.capital) * 100) : 0;
            const proj = balances.projStrats?.[s.name_key] ?? parseFloat(s.net_value);
            const diff = proj - parseFloat(s.net_value);
            return (
              <tr key={s.strategy_id} className="hover:bg-surface-2/50">
                <td className="py-2 px-4 text-primary font-medium">{s.name_key}</td>
                <td className="py-2 px-4 text-right font-mono text-secondary">{fmtAbs(s.capital)}</td>
                <td className={`py-2 px-4 text-right font-mono ${parseFloat(s.pnl) >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>{fmt(s.pnl)}</td>
                <td className="py-2 px-4 text-right font-mono text-primary">{fmtAbs(s.net_value)}</td>
                <td className={`py-2 px-4 text-right font-mono ${retPct >= 0 ? "text-pnl-gain" : "text-pnl-loss"}`}>{retPct >= 0 ? "+" : ""}{retPct.toFixed(1)}%</td>
                <td className={`py-2 px-4 text-right font-mono ${diff !== 0 ? "text-accent" : "text-muted"}`}>
                  {fmtAbs(String(proj))}
                </td>
                <td className="py-2 px-2 text-center">
                  <button
                    onClick={() => onDelete(s.name_key)}
                    className="text-[10px] text-pnl-loss hover:underline"
                    title={t("deleteStrategy")}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
