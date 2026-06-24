import { http, HttpResponse } from "msw";
import { comparison2Series, comparison3SeriesBaseline, comparisonCurrencyMismatch,
         comparisonUnmatched, comparisonPage2 } from "../fixtures/comparison";

export const comparisonHandlers = [
  http.post("/liveboard/api/v1/comparisons", async ({ request }) => {
    const body = (await request.json()) as { series_ids: number[]; per_trade_page?: number };
    if (body.per_trade_page === 2) return HttpResponse.json(comparisonPage2);
    if (body.series_ids.length >= 3) return HttpResponse.json(comparison3SeriesBaseline);
    return HttpResponse.json(comparison2Series);
  }),
  // special paths for variant response tests
  http.post("/liveboard/api/v1/comparisons-currency-mismatch", () => HttpResponse.json(comparisonCurrencyMismatch)),
  http.post("/liveboard/api/v1/comparisons-unmatched", () => HttpResponse.json(comparisonUnmatched)),
];
