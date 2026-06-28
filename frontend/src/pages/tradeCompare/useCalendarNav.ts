import { useCallback, useEffect, useMemo, useState } from "react";
import { ymd } from "./helpers";

export interface CalendarDay {
  date: Date;
  kind: "shared" | "simOnly" | "liveOnly" | "none";
  isToday: boolean;
}

export function useCalendarNav(
  allDates: string[],
  datesByKind: { shared: string[]; simOnly: string[]; liveOnly: string[] },
) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calYear, setCalYear] = useState(0);
  const [calMonth, setCalMonth] = useState(0);

  useEffect(() => {
    if (allDates.length > 0 && !selectedDate) {
      const latest = allDates[allDates.length - 1];
      setSelectedDate(latest);
      const d = new Date(latest);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
    }
  }, [allDates, selectedDate]);

  useEffect(() => {
    if (selectedDate) {
      const d = new Date(selectedDate);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
    }
  }, [selectedDate]);

  const navigateDay = useCallback(
    (dir: number) => {
      if (!selectedDate || allDates.length === 0) return;
      const idx = allDates.indexOf(selectedDate);
      if (idx === -1) return;
      setSelectedDate(allDates[Math.max(0, Math.min(allDates.length - 1, idx + dir))]);
    },
    [selectedDate, allDates],
  );
  const goFirst = useCallback(() => setSelectedDate(allDates[0]), [allDates]);
  const goLast = useCallback(() => setSelectedDate(allDates[allDates.length - 1]), [allDates]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") navigateDay(-1);
      else if (e.key === "ArrowRight") navigateDay(1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigateDay]);

  const todayStr = ymd(new Date());
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayNames = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  const calendarDays: CalendarDay[] = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1);
    const lastDay = new Date(calYear, calMonth + 1, 0);
    const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
    const days: CalendarDay[] = [];
    for (let i = 0; i < startPad; i++) {
      days.push({ date: new Date(calYear, calMonth, -startPad + i + 1), kind: "none", isToday: false });
    }
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dt = new Date(calYear, calMonth, d);
      const ds = ymd(dt);
      let kind: CalendarDay["kind"] = "none";
      if (datesByKind.shared.includes(ds)) kind = "shared";
      else if (datesByKind.simOnly.includes(ds)) kind = "simOnly";
      else if (datesByKind.liveOnly.includes(ds)) kind = "liveOnly";
      days.push({ date: dt, kind, isToday: ds === todayStr });
    }
    while (days.length % 7 !== 0) {
      const last = days[days.length - 1].date;
      days.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), kind: "none", isToday: false });
    }
    return days;
  }, [calYear, calMonth, datesByKind, todayStr]);

  const prevMonth = () => {
    const m = calMonth - 1;
    if (m < 0) { setCalMonth(11); setCalYear(calYear - 1); } else setCalMonth(m);
  };
  const nextMonth = () => {
    const m = calMonth + 1;
    if (m > 11) { setCalMonth(0); setCalYear(calYear + 1); } else setCalMonth(m);
  };

  return {
    selectedDate, setSelectedDate,
    calYear, calMonth,
    calendarDays, monthNames, dayNames,
    navigateDay, goFirst, goLast,
    prevMonth, nextMonth,
  };
}
