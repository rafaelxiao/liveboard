import { useTranslation } from "react-i18next";
import { usePnlStore } from "../state/pnlStore";

export default function PnlColorToggle() {
  const { t } = useTranslation("settings");
  const scheme = usePnlStore((s) => s.scheme);
  const setScheme = usePnlStore((s) => s.setScheme);

  return (
    <div role="radiogroup" aria-label={t("pnlColorsTitle")} className="inline-flex rounded-md border border-border-default">
      <button
        type="button"
        role="radio"
        aria-checked={scheme === "red-up"}
        onClick={() => setScheme("red-up")}
        className={`px-3 py-1.5 text-sm transition-colors duration-150 rounded-l-md ${
          scheme === "red-up" ? "bg-accent text-white" : "bg-surface text-secondary hover:bg-surface-2"
        }`}
      >
        {t("redUp")}
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={scheme === "green-up"}
        onClick={() => setScheme("green-up")}
        className={`px-3 py-1.5 text-sm transition-colors duration-150 rounded-r-md ${
          scheme === "green-up" ? "bg-accent text-white" : "bg-surface text-secondary hover:bg-surface-2"
        }`}
      >
        {t("greenUp")}
      </button>
    </div>
  );
}
