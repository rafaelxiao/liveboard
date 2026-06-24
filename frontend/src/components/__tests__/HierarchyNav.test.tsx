import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import HierarchyNav from "../HierarchyNav";

describe("HierarchyNav", () => {
  const baseProps = {
    seriesName: "apex",
    strategies: ["day_night_shift", "vwap_intra_day_1", "vwap_intra_day_2"],
    symbols: ["159792.SZ", "513300.SH"],
    selectedStrategy: undefined as string | undefined,
    selectedSymbol: undefined as string | undefined,
    onBackToOverview: vi.fn(),
    onSelectStrategy: vi.fn(),
    onSelectSymbol: vi.fn(),
  };

  it("renders breadcrumb with series name and Account", () => {
    render(
      <MemoryRouter>
        <HierarchyNav {...baseProps} />
      </MemoryRouter>
    );
    expect(screen.getByText("apex")).toBeDefined();
    expect(screen.getByText("Account")).toBeDefined();
  });

  it("always shows all strategy chips", () => {
    render(
      <MemoryRouter>
        <HierarchyNav {...baseProps} />
      </MemoryRouter>
    );
    expect(screen.getByText("day_night_shift")).toBeDefined();
    expect(screen.getByText("vwap_intra_day_1")).toBeDefined();
    expect(screen.getByText("vwap_intra_day_2")).toBeDefined();
  });

  it("shows ALL + symbol chips when symbols exist", () => {
    render(
      <MemoryRouter>
        <HierarchyNav {...baseProps} />
      </MemoryRouter>
    );
    expect(screen.getByText("ALL")).toBeDefined();
    expect(screen.getByText("159792.SZ")).toBeDefined();
    expect(screen.getByText("513300.SH")).toBeDefined();
  });

  it("highlights selected strategy", () => {
    render(
      <MemoryRouter>
        <HierarchyNav {...baseProps} selectedStrategy="day_night_shift" />
      </MemoryRouter>
    );
    const btn = screen.getByText("day_night_shift");
    expect(btn.className).toContain("bg-accent");
  });

  it("highlights selected symbol", () => {
    render(
      <MemoryRouter>
        <HierarchyNav {...baseProps} selectedSymbol="513300.SH" />
      </MemoryRouter>
    );
    const btn = screen.getByText("513300.SH");
    expect(btn.className).toContain("bg-accent");
  });

  it("calls onSelectStrategy when a strategy chip is clicked", () => {
    const onSelect = vi.fn();
    render(
      <MemoryRouter>
        <HierarchyNav {...baseProps} onSelectStrategy={onSelect} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("vwap_intra_day_1"));
    expect(onSelect).toHaveBeenCalledWith("vwap_intra_day_1");
  });

  it("calls onSelectSymbol when ALL or a symbol chip is clicked", () => {
    const onSelect = vi.fn();
    render(
      <MemoryRouter>
        <HierarchyNav {...baseProps} onSelectSymbol={onSelect} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText("ALL"));
    expect(onSelect).toHaveBeenCalledWith(undefined);
    fireEvent.click(screen.getByText("159792.SZ"));
    expect(onSelect).toHaveBeenCalledWith("159792.SZ");
  });

  it("hides symbol row when symbols array is empty", () => {
    render(
      <MemoryRouter>
        <HierarchyNav {...baseProps} symbols={[]} />
      </MemoryRouter>
    );
    expect(screen.queryByText("ALL")).toBeNull();
  });
});
