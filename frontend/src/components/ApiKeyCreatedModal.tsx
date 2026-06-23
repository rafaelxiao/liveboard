import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { KeyRound } from "lucide-react";

import CopyButton from "./CopyButton";
import type { ApiKeyCreatedOut } from "../lib/types";

export default function ApiKeyCreatedModal({
  createdKey,
  onClose,
}: {
  createdKey: ApiKeyCreatedOut | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("settings");
  const [copied, setCopied] = useState(false);
  const [guarding, setGuarding] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const open = createdKey !== null;

  useEffect(() => {
    if (open) {
      setCopied(false);
      setGuarding(false);
      // focus + pre-select the key for easy manual copy
      requestAnimationFrame(() => fieldRef.current?.select());
    }
  }, [open, createdKey]);

  const requestClose = () => {
    if (copied) {
      onClose();
    } else {
      setGuarding(true);
    }
  };

  if (!createdKey) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content
          aria-modal
          className="fixed left-1/2 top-1/2 z-50 w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-2 p-6"
        >
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-primary">
            <KeyRound size={18} aria-hidden /> {t("keyCreated")}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            {t("copyNow")}
          </Dialog.Description>

          <div className="mt-4 flex items-center gap-2">
            <input
              ref={fieldRef}
              readOnly
              value={createdKey.key}
              aria-label="API key"
              className="flex-1 rounded-sm border border-border-default bg-surface px-2 py-2 font-mono text-sm text-secondary"
            />
            <span onClick={() => setCopied(true)}>
              <CopyButton value={createdKey.key} label={t("copy")} copiedLabel={t("copied")} />
            </span>
          </div>

          <p className="mt-3 text-xs text-warning">⚠ {t("onlyTimeShown")}</p>

          {guarding ? (
            <div className="mt-5 rounded-md border border-warning bg-surface px-3 py-2 text-sm text-warning">
              {t("closeGuardTitle")}
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setGuarding(false)}
                  className="rounded-md px-2 py-1 text-secondary hover:bg-surface-3">
                  {t("keepOpen")}
                </button>
                <button type="button" onClick={onClose}
                  className="rounded-md bg-danger-ui px-2 py-1 text-white hover:opacity-90">
                  {t("closeAnyway")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={requestClose}
              className="mt-5 w-full rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover">
              {t("copiedDone")}
            </button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
