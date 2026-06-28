import { useTranslation } from "react-i18next";
import { fmtPnl } from "./helpers";

interface Props {
  name1: string;
  name2: string;
  fills1Count: number;
  fills2Count: number;
  pnl1: number;
  pnl2: number;
}

export default function PnLSummaryBar({ name1, name2, fills1Count, fills2Count, pnl1, pnl2 }: Props) {
  const { t } = useTranslation("tradeCompare");
  return (
    <div className="flex items-center gap-6 px-4 py-1.5 border-t border-border-default text-xs shrink-0">
      <span>
        <span className="text-[#4fc3f7] font-medium">{name1}:</span>{" "}
        <span className="text-secondary">{fills1Count} {t("fills")}</span>
        {" · "}
        <span className={pnl1 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(pnl1)}</span>
      </span>
      <span>
        <span className="text-[#ff8a65] font-medium">{name2}:</span>{" "}
        <span className="text-secondary">{fills2Count} {t("fills")}</span>
        {" · "}
        <span className={pnl2 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(pnl2)}</span>
      </span>
      <span>
        <span className="text-secondary">{t("delta")}:</span>{" "}
        <span className={pnl1 - pnl2 >= 0 ? "text-pnl-gain" : "text-pnl-loss"}>{fmtPnl(pnl1 - pnl2)}</span>
      </span>
    </div>
  );
}
