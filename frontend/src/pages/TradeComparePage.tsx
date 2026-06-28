import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import * as echarts from "echarts/core";
import { ScatterChart, LineChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  ScatterChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  CanvasRenderer,
]);

import { useSeriesList } from "../state/useSeries";
import { useTradeData } from "./tradeCompare/useTradeData";
import { useCalendarNav } from "./tradeCompare/useCalendarNav";
import { calcDailyPnl } from "./tradeCompare/helpers";
import CalendarSidebar from "./tradeCompare/CalendarSidebar";
import TradeScatterChart from "./tradeCompare/TradeScatterChart";
import DayNavigation from "./tradeCompare/DayNavigation";
import PnLSummaryBar from "./tradeCompare/PnLSummaryBar";

export default function TradeComparePage() {
  const { t } = useTranslation("tradeCompare");
  const [searchParams] = useSearchParams();
  const series1 = Number(searchParams.get("series_1") || "0");
  const series2 = Number(searchParams.get("series_2") || "0");
  const strategy = searchParams.get("strategy") || "";

  const { data: seriesList } = useSeriesList();
  const name1 = (seriesList as { id: number; name: string }[] | undefined)?.find((s) => s.id === series1)?.name || `Series ${series1}`;
  const name2 = (seriesList as { id: number; name: string }[] | undefined)?.find((s) => s.id === series2)?.name || `Series ${series2}`;

  const { fills1, fills2, loading, allDates, datesByKind, fillsByDate1, fillsByDate2 } = useTradeData(series1, series2, strategy);
  const cal = useCalendarNav(allDates, datesByKind);

  if (!series1 || !series2 || !strategy) {
    return (
      <div className="p-8 text-secondary">
        Missing parameters. Use{" "}
        <code className="text-primary">?series_1=4&amp;series_2=5&amp;strategy=vwap_intra_day_2</code>
      </div>
    );
  }

  const selF1 = cal.selectedDate ? fillsByDate1.get(cal.selectedDate) || [] : [];
  const selF2 = cal.selectedDate ? fillsByDate2.get(cal.selectedDate) || [] : [];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-default flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-base font-semibold text-primary">
            {strategy} — {name1} vs {name2} · {t("title")}
          </h2>
          <p className="text-xs text-secondary mt-0.5">
            {fills1.length + fills2.length} {t("fills")} · {allDates.length} {t("tradingDays")}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-secondary">{t("loading")}</div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          <CalendarSidebar
            calendarDays={cal.calendarDays}
            calYear={cal.calYear}
            calMonth={cal.calMonth}
            selectedDate={cal.selectedDate}
            monthNames={cal.monthNames}
            dayNames={cal.dayNames}
            name1={name1}
            name2={name2}
            onDateSelect={cal.setSelectedDate}
            onPrevMonth={cal.prevMonth}
            onNextMonth={cal.nextMonth}
          />

          <div className="flex-1 flex flex-col min-w-0">
            <TradeScatterChart
              fills1={selF1}
              fills2={selF2}
              name1={name1}
              name2={name2}
              selectedDate={cal.selectedDate || ""}
            />

            <DayNavigation
              selectedDate={cal.selectedDate}
              onPrev={() => cal.navigateDay(-1)}
              onNext={() => cal.navigateDay(1)}
              onFirst={cal.goFirst}
              onLast={cal.goLast}
            />

            <PnLSummaryBar
              name1={name1}
              name2={name2}
              fills1Count={selF1.length}
              fills2Count={selF2.length}
              pnl1={calcDailyPnl(selF1)}
              pnl2={calcDailyPnl(selF2)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
