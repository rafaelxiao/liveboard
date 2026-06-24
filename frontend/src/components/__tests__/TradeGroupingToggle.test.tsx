import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TradeGroupingToggle from "../TradeGroupingToggle";

// Mock the store
const storeState = { grouping: "day" };
vi.mock("../../state/tradeGroupingStore", () => ({
  useTradeGroupingStore: (selector: (s: any) => any) => selector({
    grouping: storeState.grouping,
    setGrouping: (v: string) => { storeState.grouping = v; },
  }),
}));

describe("TradeGroupingToggle", () => {
  beforeEach(() => {
    storeState.grouping = "day";
  });

  it("renders Per Trade and Per Day buttons", () => {
    render(<TradeGroupingToggle />);
    expect(screen.getByText("perTrade")).toBeDefined();
    expect(screen.getByText("perDay")).toBeDefined();
  });

  it('highlights Per Day by default', () => {
    render(<TradeGroupingToggle />);
    const dayBtn = screen.getByText("perDay");
    expect(dayBtn.getAttribute("aria-checked")).toBe("true");
  });

  it('switches to Per Trade on click', () => {
    render(<TradeGroupingToggle />);
    fireEvent.click(screen.getByText("perTrade"));
    expect(storeState.grouping).toBe("lot");
  });

  it('switches to Per Day on click', () => {
    storeState.grouping = "lot";
    render(<TradeGroupingToggle />);
    fireEvent.click(screen.getByText("perDay"));
    expect(storeState.grouping).toBe("day");
  });
});
