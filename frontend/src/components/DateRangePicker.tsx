import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import CalendarInput from "./CalendarInput";

interface DateRangePickerProps {
  from?: string;
  to?: string;
  onChange: (range: { from?: string; to?: string }) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

const PRESETS = [
  { label: "1W", f: () => daysAgo(7), t: () => today() },
  { label: "1M", f: () => daysAgo(30), t: () => today() },
  { label: "3M", f: () => daysAgo(90), t: () => today() },
  { label: "6M", f: () => daysAgo(180), t: () => today() },
  { label: "YTD", f: () => startOfYear(), t: () => today() },
  { label: "1Y", f: () => daysAgo(365), t: () => today() },
];

export default function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const { t } = useTranslation();
  const [fromStr, setFromStr] = useState(from ?? "");
  const [toStr, setToStr] = useState(to ?? "");
  const [activePreset, setActivePreset] = useState<string | null>(null);

  useEffect(() => {
    setFromStr(from ?? "");
    setToStr(to ?? "");
    // Detect active preset
    const match = PRESETS.find((p) => p.f() === from && p.t() === to);
    setActivePreset(match ? match.label : from ? null : "All");
  }, [from, to]);

  const apply = (f: string, t: string) => {
    setFromStr(f);
    setToStr(t);
    onChange({ from: f || undefined, to: t || undefined });
  };

  return (
    <div className="flex items-center gap-2 text-sm">
      {/* Preset buttons */}
      {PRESETS.map((p) => {
        const isActive = activePreset === p.label;
        return (
          <button
            key={p.label}
            type="button"
            onClick={() => apply(p.f(), p.t())}
            className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              isActive
                ? "border-accent bg-accent text-white"
                : "border-border-default bg-surface text-secondary hover:bg-surface-2"
            }`}
          >
            {p.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => { setActivePreset("All"); onChange({ from: undefined, to: undefined }); }}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
          activePreset === "All"
            ? "border-accent bg-accent text-white"
            : "border-border-default bg-surface text-secondary hover:bg-surface-2"
        }`}
      >
        {t("All")}
      </button>

      {/* Divider */}
      <div className="h-5 w-px bg-border-default" />

      {/* Custom calendar inputs */}
      <CalendarInput
        value={fromStr}
        onChange={(v) => { setFromStr(v); setActivePreset(null); onChange({ from: v || undefined, to: to || undefined }); }}
        placeholder={t("From")}
      />
      <span className="text-muted text-xs">–</span>
      <CalendarInput
        value={toStr}
        onChange={(v) => { setToStr(v); setActivePreset(null); onChange({ from: from || undefined, to: v || undefined }); }}
        placeholder={t("To")}
      />
    </div>
  );
}
