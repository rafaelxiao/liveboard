import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ComparisonRequest, ComparisonResponse } from "../lib/types";
import { postComparison } from "../api/comparison";

export function useComparison(req: ComparisonRequest | null) {
  return useQuery<ComparisonResponse>({
    queryKey: [
      "comparison",
      req?.series_ids,
      req?.baseline_entity_index ?? null,
      req?.level ?? null,
      req?.strategy_keys ?? null,
      req?.date_from ?? null,
      req?.date_to ?? null,
    ],
    queryFn: () => postComparison(req!),
    enabled: req !== null && (req.series_ids?.length ?? 0) >= 2,
    placeholderData: keepPreviousData,
    retry: false,
  });
}
