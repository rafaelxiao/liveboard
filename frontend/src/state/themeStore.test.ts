import { beforeEach, describe, expect, it } from "vitest";

import { usePnlStore } from "./pnlStore";
import { useThemeStore } from "./themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useThemeStore.setState({ theme: "dark" });
  });

  it("toggle flips dark<->light, persists, and sets the html attribute", () => {
    useThemeStore.getState().setTheme("dark");
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe("light");
    expect(localStorage.getItem("lb_theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("pnlStore (default red-up)", () => {
  beforeEach(() => {
    localStorage.clear();
    usePnlStore.setState({ scheme: "red-up" });
  });

  it("defaults to red-up and toggle persists green-up", () => {
    expect(usePnlStore.getState().scheme).toBe("red-up");
    usePnlStore.getState().toggle();
    expect(usePnlStore.getState().scheme).toBe("green-up");
    expect(localStorage.getItem("lb_pnl_color_scheme")).toBe("green-up");
    expect(document.documentElement.getAttribute("data-pnl")).toBe("green-up");
  });
});
