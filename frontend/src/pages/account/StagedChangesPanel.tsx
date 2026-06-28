import { useTranslation } from "react-i18next";
import type { StagedMove } from "./useStaging";

function fmtAbs(v: string): string {
  const n = parseFloat(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  staged: StagedMove[];
  committing: boolean;
  commitOk: string;
  onRemove: (idx: number) => void;
  onCommit: () => void;
}

export default function StagedChangesPanel({ staged, committing, commitOk, onRemove, onCommit }: Props) {
  const { t } = useTranslation("capital");
  if (staged.length === 0) return null;

  return (
    <>
      <div className="rounded-lg border border-accent/30 bg-accent/5 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-accent/20 flex items-center justify-between">
          <h3 className="text-sm font-medium text-accent">{t("stagedChanges")} ({staged.length})</h3>
          <span className="text-[10px] text-muted">{t("notYetPersisted")}</span>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border-default">
              <th className="text-left py-2 px-3 font-medium text-secondary w-8">#</th>
              <th className="text-left py-2 px-3 font-medium text-secondary">{t("action")}</th>
              <th className="text-right py-2 px-3 font-medium text-secondary">{t("amount")}</th>
              <th className="text-right py-2 px-3 font-medium text-secondary w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {staged.map((s, idx) => (
              <tr key={s.id} className="hover:bg-surface-2/50">
                <td className="py-1.5 px-3 text-muted">{idx + 1}</td>
                <td className="py-1.5 px-3 text-primary">{s.label}</td>
                <td className="py-1.5 px-3 text-right font-mono text-primary">{fmtAbs(String(s.amount))}</td>
                <td className="py-1.5 px-3 text-right">
                  <button
                    onClick={() => onRemove(idx)}
                    className="text-[10px] text-pnl-loss hover:underline"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-accent/20 flex justify-end">
          <button
            onClick={onCommit}
            disabled={committing}
            className="rounded-md bg-accent text-white px-6 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {committing ? t("committing") : t("commitAll")}
          </button>
        </div>
      </div>
      {commitOk && <p className="text-xs text-pnl-gain text-center">{t("committed")}</p>}
    </>
  );
}
