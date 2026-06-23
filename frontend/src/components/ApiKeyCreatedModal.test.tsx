import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ApiKeyCreatedModal from "./ApiKeyCreatedModal";
import { renderWithProviders } from "../lib/test-utils";

const KEY = { id: 1, name: "ingest-bot", key: "lb_8f3a2c91d4e77b_full_secret" };

describe("ApiKeyCreatedModal (copy-once, J1)", () => {
  it("shows the full key exactly once when open", () => {
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={() => {}} />);
    expect(screen.getByDisplayValue(KEY.key)).toBeInTheDocument();
    expect(screen.getByText(/only time the full key is shown/i)).toBeInTheDocument();
  });

  it("renders nothing (key not present) when createdKey is null", () => {
    renderWithProviders(<ApiKeyCreatedModal createdKey={null} onClose={() => {}} />);
    expect(screen.queryByDisplayValue(KEY.key)).not.toBeInTheDocument();
  });

  it("copying then 'I've copied it — done' dismisses and discards the key", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    await userEvent.click(screen.getByRole("button", { name: /i've copied it/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closing without copying triggers the dismissal guard, then confirms", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={onClose} />);
    // Attempt to close (button) before copying → guard appears, onClose not yet called.
    await userEvent.click(screen.getByRole("button", { name: /i've copied it/i }));
    expect(await screen.findByText(/close without copying/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /close anyway/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
