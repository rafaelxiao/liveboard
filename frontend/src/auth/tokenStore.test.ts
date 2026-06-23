import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTokenStore } from "./tokenStore";

// Mock apiFetch - MSW doesn't intercept fetch in this context properly
vi.mock("../api/client", () => ({
  configureClient: vi.fn(),
  apiFetch: vi.fn(),
}));

import * as clientModule from "../api/client";

describe("tokenStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useTokenStore.getState().clear();
    vi.clearAllMocks();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it("persists tokens to localStorage on setTokens", () => {
    useTokenStore.getState().setTokens({ access_token: "a1", refresh_token: "r1" });
    expect(useTokenStore.getState().accessToken).toBe("a1");
    expect(localStorage.getItem("lb_access")).toBe("a1");
    expect(localStorage.getItem("lb_refresh")).toBe("r1");
  });

  it("clear() removes tokens from state and storage", () => {
    useTokenStore.getState().setTokens({ access_token: "a1", refresh_token: "r1" });
    useTokenStore.getState().clear();
    expect(useTokenStore.getState().accessToken).toBeNull();
    expect(localStorage.getItem("lb_access")).toBeNull();
  });

  it("silentRefresh stores a new access token and returns true on success", async () => {
    vi.mocked(clientModule.apiFetch).mockResolvedValueOnce({ access_token: "a2" });
    useTokenStore.getState().setTokens({ access_token: "a1", refresh_token: "r1" });
    const ok = await useTokenStore.getState().silentRefresh();
    expect(ok).toBe(true);
    expect(useTokenStore.getState().accessToken).toBe("a2");
    expect(useTokenStore.getState().refreshToken).toBe("r1");
  });

  it("silentRefresh clears tokens and returns false when refresh fails", async () => {
    vi.mocked(clientModule.apiFetch).mockRejectedValueOnce(new Error("fail"));
    useTokenStore.getState().setTokens({ access_token: "a1", refresh_token: "r1" });
    const ok = await useTokenStore.getState().silentRefresh();
    expect(ok).toBe(false);
    expect(useTokenStore.getState().accessToken).toBeNull();
    expect(useTokenStore.getState().refreshToken).toBeNull();
  });

  it("silentRefresh returns false immediately when there is no refresh token", async () => {
    const ok = await useTokenStore.getState().silentRefresh();
    expect(ok).toBe(false);
  });
});
