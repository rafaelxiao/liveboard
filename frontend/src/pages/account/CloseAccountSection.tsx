import { useTranslation } from "react-i18next";

interface Props {
  closing: boolean;
  closeError: string;
  onClose: () => void;
}

export default function CloseAccountSection({ closing, closeError, onClose }: Props) {
  const { t } = useTranslation("capital");
  return (
    <div className="rounded-lg border border-border-default bg-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-primary">{t("closeAccount")}</span>
          <p className="text-[11px] text-muted mt-0.5">{t("closeHint")}</p>
        </div>
        <button
          onClick={onClose}
          disabled={closing}
          className="rounded-md border border-pnl-loss/30 bg-pnl-loss/10 text-pnl-loss px-3 py-1.5 text-xs font-medium hover:bg-pnl-loss/20 disabled:opacity-50"
        >
          {closing ? "..." : t("closeAccount")}
        </button>
      </div>
      {closeError && <p className="mt-2 text-xs text-pnl-loss">{closeError}</p>}
    </div>
  );
}
