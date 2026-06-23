import type { AccessToken, TokenPair, UserOut } from "../lib/types";
import { apiFetch } from "./client";

export function register(email: string, password: string): Promise<UserOut> {
  return apiFetch<UserOut>("/auth/register", { method: "POST", body: { email, password } });
}

export function login(email: string, password: string): Promise<TokenPair> {
  return apiFetch<TokenPair>("/auth/login", { method: "POST", body: { email, password } });
}

export function refresh(refresh_token: string): Promise<AccessToken> {
  return apiFetch<AccessToken>("/auth/refresh", { method: "POST", body: { refresh_token } });
}

export function me(): Promise<UserOut> {
  return apiFetch<UserOut>("/auth/me");
}
