import { useTranslation } from "react-i18next";
import { useTradeGroupingStore } from "../state/tradeGroupingStore";

export default function TradeGroupingToggle() {
  const { t } = useTranslation("settings");
  const grouping = useTradeGroupingStore((s) => s.grouping);
  const setGrouping = useTradeGroupingStore((s) => s.setGrouping);

  return (
    <div role="radiogroup" aria-label={t("tradeGrouping")} className="inline-flex rounded-md border border-border-default">
      <button
        type="button"
        role="radio"
        aria-checked={grouping !== "day"}
        onClick={() => setGrouping("lot")}
        className={`px-3 py-1.5 text-sm transition-colors duration-150 rounded-l-md ${
          grouping !== "day" ? "bg-accent text-white" : "bg-surface text-secondary hover:bg-surface-2"
        }`}
      >
        {t("perTrade")}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={grouping === "day"}
        onClick={() => setGrouping("day")}
        className={`px-3 py-1.5 text-sm transition-colors duration-150 rounded-r-md ${
          grouping === "day" ? "bg-accent text-white" : "bg-surface text-secondary hover:bg-surface-2"
        }`}
      >
        {t("perDay")}
      </button>
    </div>
  );
}
