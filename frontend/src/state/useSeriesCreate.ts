import { apiFetch } from "../api/client";

interface CreateSeriesInput {
  name: string;
  tag?: "live" | "sim";
  base_currency: string;
  session_tz: string;
}

export async function createSeries(input: CreateSeriesInput): Promise<number> {
  const res = await apiFetch<{ series_id: number }>("/series", {
    method: "POST",
    body: input,
  });
  return res.series_id;
}
