import { beforeEach, describe, expect, it } from "vitest";

import { selectIsAdmin, selectIsApproved, selectIsAuthed, useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";

describe("authStore selectors", () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useTokenStore.getState().clear();
  });

  it("isAuthed reflects presence of an access token", () => {
    expect(selectIsAuthed()).toBe(false);
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    expect(selectIsAuthed()).toBe(true);
  });

  it("isAdmin is true only for an admin user", () => {
    useAuthStore.getState().setUser({ id: 1, email: "a@b.c", role: "user", status: "approved", created_at: "x" });
    expect(selectIsAdmin()).toBe(false);
    useAuthStore.getState().setUser({ id: 2, email: "x@y.z", role: "admin", status: "approved", created_at: "x" });
    expect(selectIsAdmin()).toBe(true);
  });

  it("isApproved is true only when status is approved", () => {
    useAuthStore.getState().setUser({ id: 1, email: "a@b.c", role: "user", status: "pending", created_at: "x" });
    expect(selectIsApproved()).toBe(false);
    useAuthStore.getState().setUser({ id: 1, email: "a@b.c", role: "user", status: "approved", created_at: "x" });
    expect(selectIsApproved()).toBe(true);
  });
});
