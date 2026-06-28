import { useTranslation } from "react-i18next";

interface Props {
  selectedDate: string | null;
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
}

export default function DayNavigation({ selectedDate, onPrev, onNext, onFirst, onLast }: Props) {
  const { t } = useTranslation("tradeCompare");
  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border-default bg-surface shrink-0">
      <div className="flex items-center gap-1">
        <button onClick={onFirst} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">|◀</button>
        <button onClick={onPrev} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">{t("prev")}</button>
      </div>
      <span className="text-sm font-mono text-primary">{selectedDate || "—"}</span>
      <div className="flex items-center gap-1">
        <button onClick={onNext} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">{t("next")}</button>
        <button onClick={onLast} className="px-2 py-1 text-xs text-secondary hover:text-primary rounded hover:bg-surface-2">▶|</button>
      </div>
    </div>
  );
}
