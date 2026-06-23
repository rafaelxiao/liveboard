import type { SeriesSummary, SeriesDetail } from "../lib/types";
import { apiFetch } from "./client";

export function getSeries(): Promise<SeriesSummary[]> {
  return apiFetch<SeriesSummary[]>("/series");
}

export function getSeriesDetail(id: number): Promise<SeriesDetail> {
  return apiFetch<SeriesDetail>(`/series/${id}`);
}

export function createSeries(body: {
  name: string;
  tag?: string;
  notes?: string;
  base_currency: string;
  session_tz: string;
}): Promise<{ series_id: number }> {
  return apiFetch<{ series_id: number }>("/series", { method: "POST", body });
}
