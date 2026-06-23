import type { ComparisonRequest, ComparisonResponse } from "../lib/types";
import { apiFetch } from "./client";

export function postComparison(body: ComparisonRequest): Promise<ComparisonResponse> {
  return apiFetch<ComparisonResponse>("/comparisons", { method: "POST", body });
}
