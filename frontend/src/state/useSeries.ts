import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SeriesSummary, SeriesDetail } from "../lib/types";
import { getSeries, getSeriesDetail, createSeries } from "../api/series";

export function useSeriesList() {
  return useQuery<SeriesSummary[]>({ queryKey: ["series"], queryFn: getSeries });
}

export function useSeriesDetail(id: number) {
  return useQuery<SeriesDetail>({
    queryKey: ["series", id],
    queryFn: () => getSeriesDetail(id),
    enabled: !!id,
  });
}

export function useCreateSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSeries,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["series"] });
    },
  });
}
