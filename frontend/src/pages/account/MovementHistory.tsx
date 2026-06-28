import { useTranslation } from "react-i18next";
import type { FundMovement } from "../../lib/types";

function fmtAbs(v: string): string {
  const n = parseFloat(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  committed: FundMovement[];
  stratCreationTimes: Set<string>;
}

export default function MovementHistory({ committed, stratCreationTimes }: Props) {
  const { t } = useTranslation("capital");
  return (
    <div className="rounded-lg border border-border-default overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border-default bg-surface-2">
        <h3 className="text-sm font-medium text-primary">{t("recentMovements")}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default bg-surface-2/50">
              <th className="text-left py-2 px-3 font-medium text-secondary">{t("time")}</th>
              <th className="text-left py-2 px-3 font-medium text-secondary">{t("from")}</th>
              <th className="text-left py-2 px-3 font-medium text-secondary">{t("to")}</th>
              <th className="text-right py-2 px-3 font-medium text-secondary">{t("amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {committed.slice(0, 40).map((m, i) => {
              const isNewStrat = m.to_bucket === "STRATEGY" && m.to_strategy && stratCreationTimes.has(m.to_strategy);
              return (
                <tr key={i} className={`hover:bg-surface-2/50 ${isNewStrat ? "bg-accent/5" : ""}`}>
                  <td className="py-1.5 px-3 text-secondary whitespace-nowrap">{m.ts.slice(0, 19).replace("T", " ")}</td>
                  <td className="py-1.5 px-3 text-secondary">
                    {m.from_bucket}{m.from_strategy ? ` — ${m.from_strategy}` : ""}
                  </td>
                  <td className="py-1.5 px-3 text-secondary">
                    {m.to_bucket}{m.to_strategy ? ` — ${m.to_strategy}` : ""}
                    {isNewStrat && <span className="ml-1.5 text-[10px] text-accent font-medium">{t("newStrategy")}</span>}
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono text-primary">{fmtAbs(m.amount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
