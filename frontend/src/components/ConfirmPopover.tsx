import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";

export default function ConfirmPopover({
  trigger,
  message,
  confirmLabel = "Confirm",
  onConfirm,
}: {
  trigger: ReactNode;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="z-20 w-64 rounded-md border border-border-default bg-surface-2 p-3 text-sm text-secondary shadow-lg">
          <p className="mb-3">{message}</p>
          <div className="flex justify-end gap-2">
            <Popover.Close asChild>
              <button type="button" className="rounded-md px-2 py-1 text-secondary hover:bg-surface-3">
                Cancel
              </button>
            </Popover.Close>
            <Popover.Close asChild>
              <button type="button" onClick={onConfirm}
                className="rounded-md bg-danger-ui px-2 py-1 text-white hover:opacity-90">
                {confirmLabel}
              </button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
