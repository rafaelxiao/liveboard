import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Calendar } from "lucide-react";

interface CalendarInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfMonth(year: number, month: number): number {
  // 0 = Monday, 6 = Sunday
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1;
}

function formatDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function CalendarInput({ value, onChange, placeholder }: CalendarInputProps) {
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => {
    if (value) return parseInt(value.slice(0, 4));
    return new Date().getFullYear();
  });
  const [viewMonth, setViewMonth] = useState(() => {
    if (value) return parseInt(value.slice(5, 7)) - 1;
    return new Date().getMonth();
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setViewYear(parseInt(value.slice(0, 4)));
      setViewMonth(parseInt(value.slice(5, 7)) - 1);
    }
  }, [value]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleOutside);
      return () => document.removeEventListener("mousedown", handleOutside);
    }
  }, [open]);

  const selectedDate = value || null;
  const today = formatDate(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };
  const prevYear = () => setViewYear(viewYear - 1);
  const nextYear = () => setViewYear(viewYear + 1);

  const firstDay = firstDayOfMonth(viewYear, viewMonth);
  const totalDays = daysInMonth(viewYear, viewMonth);
  const weeks: (number | null)[][] = [];
  let day = 1;
  for (let w = 0; w < 6 && day <= totalDays; w++) {
    const week: (number | null)[] = [];
    for (let d = 0; d < 7; d++) {
      if (w === 0 && d < firstDay) week.push(null);
      else if (day > totalDays) week.push(null);
      else week.push(day++);
    }
    weeks.push(week);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 py-1.5 text-sm text-secondary hover:bg-surface-2 transition-colors duration-150 min-w-[130px]"
      >
        <Calendar size={14} className="text-muted shrink-0" />
        <span className={value ? "text-primary" : "text-muted"}>
          {value || placeholder || "yyyy-mm-dd"}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border border-border-default bg-surface p-3 shadow-2xl" style={{ width: "260px" }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevYear} className="p-0.5 text-muted hover:text-primary transition-colors" title="Previous year">
              <ChevronsLeft size={14} />
            </button>
            <button type="button" onClick={prevMonth} className="p-0.5 text-muted hover:text-primary transition-colors" title="Previous month">
              <ChevronLeft size={14} />
            </button>
            <span className="text-[13px] font-medium text-primary min-w-[100px] text-center">
              {MONTHS[viewMonth]} {viewYear}
            </span>
            <button type="button" onClick={nextMonth} className="p-0.5 text-muted hover:text-primary transition-colors" title="Next month">
              <ChevronRight size={14} />
            </button>
            <button type="button" onClick={nextYear} className="p-0.5 text-muted hover:text-primary transition-colors" title="Next year">
              <ChevronsRight size={14} />
            </button>
          </div>

          {/* Day names */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[10px] text-muted py-0.5">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((d, di) => {
                if (d === null) return <div key={di} className="h-7" />;
                const dateStr = formatDate(viewYear, viewMonth, d);
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === today;
                return (
                  <button
                    key={di}
                    type="button"
                    onClick={() => { onChange(dateStr); setOpen(false); }}
                    className={`h-7 text-[12px] rounded transition-colors duration-100 ${
                      isSelected
                        ? "bg-accent text-white font-medium"
                        : isToday
                          ? "text-accent font-medium hover:bg-surface-2"
                          : "text-secondary hover:bg-surface-2"
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
