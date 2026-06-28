import { useTranslation } from "react-i18next";
import type { Balances, StagedMove } from "./useStaging";

function fmtAbs(v: string): string {
  const n = parseFloat(v);
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  accountTotal: string;
  strategiesCount: number;
  totalNet: string;
  balances: Balances;
  staged: StagedMove[];
}

export default function BalanceCards({ accountTotal, strategiesCount, totalNet, balances, staged }: Props) {
  const { t } = useTranslation("capital");
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-lg border border-border-default bg-surface p-3">
        <div className="text-[10px] text-secondary uppercase">{t("accountTotal")}</div>
        <div className="text-base font-mono font-semibold text-primary mt-0.5">{fmtAbs(accountTotal)}</div>
      </div>
      <div className="rounded-lg border border-border-default bg-surface p-3">
        <div className="text-[10px] text-secondary uppercase">{t("freeCash")}</div>
        <div className="text-base font-mono font-semibold text-primary mt-0.5">
          {fmtAbs(String(balances.curFree))}
          {staged.length > 0 && (
            <span className="text-[10px] text-muted ml-1">→ {fmtAbs(String(balances.projFree ?? 0))}</span>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-border-default bg-surface p-3">
        <div className="text-[10px] text-secondary uppercase">{t("strategies")}</div>
        <div className="text-base font-mono font-semibold text-primary mt-0.5">{strategiesCount}</div>
      </div>
      <div className="rounded-lg border border-border-default bg-surface p-3">
        <div className="text-[10px] text-secondary uppercase">{t("totalNetValue")}</div>
        <div className="text-base font-mono font-semibold text-primary mt-0.5">{fmtAbs(totalNet)}</div>
      </div>
    </div>
  );
}
