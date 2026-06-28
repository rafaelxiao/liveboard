import { useTranslation } from "react-i18next";
import { ymd } from "./helpers";
import type { CalendarDay } from "./useCalendarNav";

interface Props {
  calendarDays: CalendarDay[];
  calYear: number;
  calMonth: number;
  selectedDate: string | null;
  monthNames: string[];
  dayNames: string[];
  name1: string;
  name2: string;
  onDateSelect: (ds: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

export default function CalendarSidebar({
  calendarDays, calYear, calMonth, selectedDate,
  monthNames, dayNames, name1, name2,
  onDateSelect, onPrevMonth, onNextMonth,
}: Props) {
  const { t } = useTranslation("tradeCompare");
  return (
    <div className="w-[260px] shrink-0 border-r border-border-default p-3 overflow-y-auto flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          onClick={onPrevMonth}
          className="text-secondary hover:text-primary text-sm px-1"
        >&lt;</button>
        <span className="text-primary text-sm font-medium">{monthNames[calMonth]} {calYear}</span>
        <button
          onClick={onNextMonth}
          className="text-secondary hover:text-primary text-sm px-1"
        >&gt;</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {dayNames.map((d) => <div key={d} className="text-[10px] text-secondary py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {calendarDays.map((d, i) => {
          const ds = ymd(d.date);
          const isSelected = ds === selectedDate;
          const inMonth = d.date.getMonth() === calMonth;
          let bgClass = "bg-surface-2/50 text-secondary/40";
          if (d.kind === "shared") bgClass = "bg-[#4caf50] text-white";
          else if (d.kind === "simOnly") bgClass = "bg-[#4fc3f7] text-white";
          else if (d.kind === "liveOnly") bgClass = "bg-[#ff8a65] text-white";
          if (!inMonth) bgClass = "text-secondary/30";
          return (
            <button
              key={i}
              onClick={() => d.kind !== "none" && onDateSelect(ds)}
              disabled={d.kind === "none"}
              className={`w-full aspect-square rounded text-[11px] flex items-center justify-center ${isSelected ? "ring-2 ring-white" : ""} ${d.isToday ? "font-bold" : ""} ${d.kind !== "none" ? "hover:opacity-80 cursor-pointer" : ""} ${bgClass}`}
            >
              {d.date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="text-[10px] text-secondary mt-2 space-y-1">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#4caf50]"></span> {t("bothTraded")}</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#4fc3f7]"></span> {t("simOnly", { name: name1 })}</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#ff8a65]"></span> {t("liveOnly", { name: name2 })}</div>
        <div className="mt-3 pt-3 border-t border-border-subtle space-y-1">
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#4fc3f7]"></span> {name1} {t("buy")}</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[#4fc3f7] rotate-45"></span> {name1} {t("sell")}</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#ff8a65]"></span> {name2} {t("buy")}</div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-[#ff8a65] rotate-45"></span> {name2} {t("sell")}</div>
        </div>
      </div>
    </div>
  );
}

