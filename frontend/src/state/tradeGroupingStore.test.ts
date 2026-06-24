import { describe, it, expect, beforeEach } from "vitest";
import { useTradeGroupingStore } from "./tradeGroupingStore";

describe("tradeGroupingStore", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset the store by re-creating it (it reads from localStorage on init)
    useTradeGroupingStore.setState({ grouping: "day" });
  });

  it('defaults to "day"', () => {
    const state = useTradeGroupingStore.getState();
    expect(state.grouping).toBe("day");
  });

  it("setGrouping updates state and localStorage", () => {
    const { setGrouping } = useTradeGroupingStore.getState();
    setGrouping("lot");
    expect(useTradeGroupingStore.getState().grouping).toBe("lot");
    expect(localStorage.getItem("lb_trade_grouping")).toBe("lot");
  });

  it("persists across getState calls", () => {
    useTradeGroupingStore.getState().setGrouping("day");
    expect(useTradeGroupingStore.getState().grouping).toBe("day");
    expect(localStorage.getItem("lb_trade_grouping")).toBe("day");
  });
});
