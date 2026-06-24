import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface HierarchyNavProps {
  seriesName: string;
  strategies: string[];
  symbols: string[];
  selectedStrategy?: string;
  selectedSymbol?: string;
  onBackToOverview: () => void;
  onSelectStrategy: (s: string) => void;
  onSelectSymbol: (s: string | undefined) => void;
}

const CHIP_BASE =
  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150 cursor-pointer";

function activeChip() {
  return `${CHIP_BASE} border-accent bg-accent text-white`;
}

function inactiveChip() {
  return `${CHIP_BASE} border-border-default bg-surface text-secondary hover:bg-surface-2 hover:text-primary`;
}

export default function HierarchyNav({
  seriesName,
  strategies,
  symbols,
  selectedStrategy,
  selectedSymbol,
  onBackToOverview,
  onSelectStrategy,
  onSelectSymbol,
}: HierarchyNavProps) {
  const { t } = useTranslation();

  // Line 1: breadcrumb (apex > Account) + all strategy chips
  // Line 2: ALL + all symbol chips (never collapses)

  return (
    <div className="space-y-2">
      {/* ── Line 1: Breadcrumb + strategies ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={onBackToOverview} className={inactiveChip()}>
          {seriesName}
        </button>

        <ChevronRight size={14} className="text-muted shrink-0" />

        {!selectedStrategy ? (
          <span className={activeChip()}>{t("Account")}</span>
        ) : (
          <button
            type="button"
            onClick={() => onSelectStrategy("")}
            className={inactiveChip()}
          >
            {t("Account")}
          </button>
        )}

        {strategies.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelectStrategy(s)}
            className={s === selectedStrategy ? activeChip() : inactiveChip()}
          >
            {s}
          </button>
        ))}
      </div>

      {/* ── Line 2: ALL + symbols ── */}
      {symbols.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSelectSymbol(undefined)}
            className={!selectedSymbol ? activeChip() : inactiveChip()}
          >
            ALL
          </button>
          {symbols.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelectSymbol(s)}
              className={s === selectedSymbol ? activeChip() : inactiveChip()}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
