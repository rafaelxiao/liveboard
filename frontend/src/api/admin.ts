import type { AdminUserOut } from "../lib/types";
import { apiFetch } from "./client";

export function listUsers(): Promise<AdminUserOut[]> {
  return apiFetch<AdminUserOut[]>("/admin/users");
}

export function approveUser(id: number): Promise<void> {
  return apiFetch<void>(`/admin/users/${id}/approve`, { method: "POST" });
}

export function rejectUser(id: number): Promise<void> {
  return apiFetch<void>(`/admin/users/${id}/reject`, { method: "POST" });
}
