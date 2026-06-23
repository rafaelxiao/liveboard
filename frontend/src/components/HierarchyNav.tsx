import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface HierarchyNavProps {
  seriesName: string;
  seriesId: number;
  level: "account" | "strategy" | "symbol";
  strategies: string[];
  symbols: string[];
  selectedStrategy?: string;
  selectedSymbol?: string;
  onBackToOverview: () => void;
  onBackToAccount: () => void;
  onBackToStrategy: () => void;
  onSelectStrategy: (s: string) => void;
  onSelectSymbol: (s: string) => void;
}

const BTN_BASE =
  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150 cursor-pointer";

function activeBtn() {
  return `${BTN_BASE} border-accent bg-accent text-white`;
}

function inactiveBtn() {
  return `${BTN_BASE} border-border-default bg-surface text-secondary hover:bg-surface-2 hover:text-primary`;
}

export default function HierarchyNav({
  seriesName,
  level,
  strategies,
  symbols,
  selectedStrategy,
  selectedSymbol,
  onBackToOverview,
  onBackToAccount,
  onBackToStrategy,
  onSelectStrategy,
  onSelectSymbol,
}: HierarchyNavProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" onClick={onBackToOverview} className={inactiveBtn()}>
          {seriesName}
        </button>

        <ChevronRight size={14} className="text-muted shrink-0" />

        {level === "account" ? (
          <span className={activeBtn()}>{t("Account")}</span>
        ) : (
          <button type="button" onClick={onBackToAccount} className={inactiveBtn()}>
            {t("Account")}
          </button>
        )}

        {selectedStrategy && (
          <>
            <ChevronRight size={14} className="text-muted shrink-0" />
            {level === "symbol" ? (
              <button type="button" onClick={onBackToStrategy} className={inactiveBtn()}>
                {selectedStrategy}
              </button>
            ) : (
              <span className={activeBtn()}>{selectedStrategy}</span>
            )}
          </>
        )}

        {selectedSymbol && (
          <>
            <ChevronRight size={14} className="text-muted shrink-0" />
            <span className={activeBtn()}>{selectedSymbol}</span>
          </>
        )}
      </div>

      {/* Drill-down chips */}
      {level === "account" && strategies.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {strategies.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelectStrategy(s)}
              className={s === selectedStrategy ? activeBtn() : inactiveBtn()}
            >
              {s}
            </button>
          ))}
          <span className="text-[11px] text-muted ml-1">&mdash; {t("strategies")}</span>
        </div>
      )}

      {level === "strategy" && symbols.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {symbols.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelectSymbol(s)}
              className={s === selectedSymbol ? activeBtn() : inactiveBtn()}
            >
              {s}
            </button>
          ))}
          <span className="text-[11px] text-muted ml-1">&mdash; {t("symbols")}</span>
        </div>
      )}

      {level === "symbol" && selectedSymbol && (
        <p className="text-[11px] text-muted">
          {t("Symbol-level metrics for {{symbol}}", { symbol: selectedSymbol })}
        </p>
      )}
    </div>
  );
}
