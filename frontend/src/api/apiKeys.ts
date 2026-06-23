import type { ApiKeyCreatedOut, ApiKeyOut } from "../lib/types";
import { apiFetch } from "./client";

export function listApiKeys(): Promise<ApiKeyOut[]> {
  return apiFetch<ApiKeyOut[]>("/api-keys");
}

export function createApiKey(name: string): Promise<ApiKeyCreatedOut> {
  return apiFetch<ApiKeyCreatedOut>("/api-keys", { method: "POST", body: { name } });
}

export function revokeApiKey(id: number): Promise<void> {
  return apiFetch<void>(`/api-keys/${id}`, { method: "DELETE" });
}
