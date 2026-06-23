import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../test/setup";
import { ApiError } from "../lib/types";
import { apiFetch, configureClient } from "./client";

const BASE = "/api";

describe("apiFetch", () => {
  beforeEach(() => {
    configureClient({ getAccessToken: () => null, refreshAndRetry: async () => false });
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns parsed JSON on 200", async () => {
    server.use(
      http.get(`${BASE}/auth/me`, () =>
        HttpResponse.json({ id: 1, email: "a@b.c", role: "user", status: "approved", created_at: "x" }),
      ),
    );
    const user = await apiFetch<{ email: string }>("/auth/me");
    expect(user.email).toBe("a@b.c");
  });

  it("attaches the access token as a Bearer header", async () => {
    let seen: string | null = null;
    server.use(
      http.get(`${BASE}/auth/me`, ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );
    configureClient({ getAccessToken: () => "tok-123", refreshAndRetry: async () => false });
    await apiFetch("/auth/me");
    expect(seen).toBe("Bearer tok-123");
  });

  it("normalizes a backend error envelope into a thrown ApiError", async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json(
          { error: { code: "forbidden", message: "awaiting approval", details: null } },
          { status: 403 },
        ),
      ),
    );
    await expect(apiFetch("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "awaiting approval",
    });
    await expect(apiFetch("/auth/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(ApiError);
  });

  it("on 401 calls refreshAndRetry once and retries the original request", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/api-keys`, ({ request }) => {
        calls += 1;
        if (request.headers.get("authorization") === "Bearer new-token") {
          return HttpResponse.json([{ id: 1, name: "k", prefix: "lb_x", last_used_at: null, created_at: "x" }]);
        }
        return HttpResponse.json({ error: { code: "unauthorized", message: "expired" } }, { status: 401 });
      }),
    );
    let token = "old-token";
    const refreshAndRetry = vi.fn(async () => {
      token = "new-token";
      return true;
    });
    configureClient({ getAccessToken: () => token, refreshAndRetry });
    const keys = await apiFetch<unknown[]>("/api-keys");
    expect(refreshAndRetry).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(keys).toHaveLength(1);
  });

  it("on 401 when refresh fails, throws the 401 ApiError without infinite retry", async () => {
    server.use(
      http.get(`${BASE}/api-keys`, () =>
        HttpResponse.json({ error: { code: "unauthorized", message: "expired" } }, { status: 401 }),
      ),
    );
    const refreshAndRetry = vi.fn(async () => false);
    configureClient({ getAccessToken: () => "old", refreshAndRetry });
    await expect(apiFetch("/api-keys")).rejects.toMatchObject({ status: 401 });
    expect(refreshAndRetry).toHaveBeenCalledTimes(1);
  });

  it("resolves to undefined on 204 No Content", async () => {
    server.use(http.delete(`${BASE}/api-keys/1`, () => new HttpResponse(null, { status: 204 })));
    await expect(apiFetch("/api-keys/1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
