import React from "react";
import { useTranslation } from "react-i18next";
import type { StrategyKey } from "../lib/types";
import type { SeriesSummary } from "../lib/types";
import { SERIES_COLORS } from "../lib/constants";

interface StrategyOption {
  series_id: number;
  series_name: string;
  name_key: string;
  name: string;
}

interface EntityPickerProps {
  level: "account" | "strategy";
  series: SeriesSummary[];
  selected: number[];
  onSelectedChange: (ids: number[]) => void;
  strategyKeys: StrategyKey[];
  onStrategyKeysChange: (keys: StrategyKey[]) => void;
  availableStrategies: StrategyOption[];
}

const EntityPicker = React.memo(function EntityPicker({
  level,
  series,
  selected,
  onSelectedChange,
  strategyKeys,
  onStrategyKeysChange,
  availableStrategies,
}: EntityPickerProps) {
  const { t } = useTranslation("compare");
  return (
    <div className="flex gap-4">
      {/* Account mode: two-column board (same layout as strategy) */}
      {level === "account" && (
        <>
          {/* Available accounts */}
          <div className="border border-border-default rounded-md bg-surface p-2 min-w-[220px] max-h-[200px] overflow-y-auto">
            <div className="text-xs text-tertiary mb-2 font-medium">
              {t("available")}
            </div>
            {series
              .filter((s) => !selected.includes(s.id))
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSelectedChange([...selected, s.id])}
                  className="w-full text-left px-2 py-1 text-sm rounded hover:bg-surface-2 text-secondary"
                >
                  {s.name}
                </button>
              ))}
            {series.filter((s) => !selected.includes(s.id)).length === 0 &&
              series.length > 0 && (
              <div className="text-xs text-tertiary px-2 py-1">
                {t("allSelected")}
              </div>
            )}
            {series.length === 0 && (
              <div className="text-xs text-tertiary px-2 py-1">
                {t("noSeries")}
              </div>
            )}
          </div>

          {/* Selected accounts */}
          <div className="border border-border-default rounded-md bg-surface p-2 min-w-[220px] max-h-[200px] overflow-y-auto">
            <div className="text-xs text-tertiary mb-2 font-medium">
              {t("selected", { count: selected.length })}
            </div>
            {selected.map((id, i) => {
              const info = series.find((s) => s.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelectedChange(selected.filter((sid) => sid !== id))}
                  className="w-full text-left px-2 py-1 text-sm rounded hover:bg-surface-2 text-secondary flex justify-between items-center"
                >
                  <span>
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{
                        backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length],
                      }}
                    />
                    {info?.name ?? `Series ${id}`}
                  </span>
                  <span className="text-tertiary text-xs ml-2">x</span>
                </button>
              );
            })}
            {selected.length === 0 && (
              <div className="text-xs text-tertiary px-2 py-1">
                {t("selectSeries")}
              </div>
            )}
          </div>
        </>
      )}

      {/* Strategy mode: two-column board */}
      {level === "strategy" && (
        <>
          {/* Available strategies */}
          <div className="border border-border-default rounded-md bg-surface p-2 min-w-[220px] max-h-[200px] overflow-y-auto">
            <div className="text-xs text-tertiary mb-2 font-medium">
              {t("available")}
            </div>
            {availableStrategies
              .filter(
                (s) =>
                  !strategyKeys.some(
                    (k) =>
                      k.series_id === s.series_id &&
                      k.name_key === s.name_key,
                  ),
              )
              .map((s) => (
                <button
                  key={`${s.series_id}-${s.name_key}`}
                  type="button"
                  onClick={() =>
                    onStrategyKeysChange([
                      ...strategyKeys,
                      { series_id: s.series_id, name_key: s.name_key },
                    ])
                  }
                  className="w-full text-left px-2 py-1 text-sm rounded hover:bg-surface-2 text-secondary"
                >
                  <span className="font-medium">{s.series_name}</span>{" "}
                  <span className="text-tertiary">{s.name}</span>
                </button>
              ))}
            {availableStrategies.filter(
              (s) =>
                !strategyKeys.some(
                  (k) =>
                    k.series_id === s.series_id &&
                    k.name_key === s.name_key,
                ),
            ).length === 0 && (
              <div className="text-xs text-tertiary px-2 py-1">
                {t("allSelected")}
              </div>
            )}
          </div>

          {/* Selected strategies */}
          <div className="border border-border-default rounded-md bg-surface p-2 min-w-[220px] max-h-[200px] overflow-y-auto">
            <div className="text-xs text-tertiary mb-2 font-medium">
              {t("selected", { count: strategyKeys.length })}
            </div>
            {strategyKeys.map((sk, i) => {
              const info = availableStrategies.find(
                (s) =>
                  s.series_id === sk.series_id && s.name_key === sk.name_key,
              );
              return (
                <button
                  key={`${sk.series_id}-${sk.name_key}`}
                  type="button"
                  onClick={() =>
                    onStrategyKeysChange(
                      strategyKeys.filter((_, j) => j !== i),
                    )
                  }
                  className="w-full text-left px-2 py-1 text-sm rounded hover:bg-surface-2 text-secondary flex justify-between items-center"
                >
                  <span>
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-2"
                      style={{
                        backgroundColor:
                          SERIES_COLORS[i % SERIES_COLORS.length],
                      }}
                    />
                    <span className="font-medium">
                      {info?.series_name ?? `S${sk.series_id}`}
                    </span>{" "}
                    <span className="text-tertiary">
                      {info?.name ?? sk.name_key}
                    </span>
                  </span>
                  <span className="text-tertiary text-xs ml-2">x</span>
                </button>
              );
            })}
            {strategyKeys.length === 0 && (
              <div className="text-xs text-tertiary px-2 py-1">
                {t("addStrategies")}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
});

export default EntityPicker;
