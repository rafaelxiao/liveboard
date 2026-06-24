import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ApiKeyCreatedModal from "./ApiKeyCreatedModal";
import { renderWithProviders } from "../lib/test-utils";

const KEY = { id: 1, name: "ingest-bot", key: "lb_8f3a2c91d4e77b_full_secret" };

describe("ApiKeyCreatedModal", () => {
  it("shows the key masked by default", () => {
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={() => {}} />);
    // Key should be masked (only first 8 chars visible, rest dots)
    const input = screen.getByDisplayValue(/lb_8f3a2/);
    expect(input).toBeInTheDocument();
    // Full key should NOT be visible
    expect(screen.queryByDisplayValue(KEY.key)).not.toBeInTheDocument();
  });

  it("toggles to show full key on eye click", async () => {
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={() => {}} />);
    await userEvent.click(screen.getByTitle("Show key"));
    expect(screen.getByDisplayValue(KEY.key)).toBeInTheDocument();
  });

  it("renders nothing when createdKey is null", () => {
    renderWithProviders(<ApiKeyCreatedModal createdKey={null} onClose={() => {}} />);
    expect(screen.queryByDisplayValue(/lb_8f3a2/)).not.toBeInTheDocument();
  });

  it("copy button copies the full key", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    // The "I've copied it" text replaces the button
    expect(screen.getByText(/I've copied it/)).toBeInTheDocument();
  });

  it("Done button calls onClose", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={onClose} />);
    await userEvent.click(screen.getByText("Done"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
