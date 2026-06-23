import { useTranslation } from "react-i18next";

export default function RealizedBadge({ variant }: { variant: "header" | "caveat" }) {
  const { t } = useTranslation("dashboard");
  if (variant === "header") {
    return (
      <span className="ml-1 rounded bg-info/20 px-1 text-[10px] uppercase text-info" title={t("Equity/drawdown are realized-only — open positions not marked to market")}>
        {t("REALIZED")}
      </span>
    );
  }
  return (
    <span className="ml-1 rounded bg-warning/20 px-1 text-[10px] uppercase text-warning" title={t("Max DD may understate risk — open positions exist in this range")}>
      {t("DD caveat")}
    </span>
  );
}
