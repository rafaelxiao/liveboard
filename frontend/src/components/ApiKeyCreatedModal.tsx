import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import * as Dialog from "@radix-ui/react-dialog";
import { KeyRound, Eye, EyeOff } from "lucide-react";

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
  const [visible, setVisible] = useState(false);
  const open = createdKey !== null;

  useEffect(() => {
    if (open) {
      setCopied(false);
      setVisible(false);
    }
  }, [open, createdKey]);

  if (!createdKey) return null;

  const masked = createdKey.key.slice(0, 8) + "•".repeat(Math.max(createdKey.key.length - 8, 24));

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
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
              readOnly
              value={visible ? createdKey.key : masked}
              aria-label="API key"
              className="flex-1 rounded-sm border border-border-default bg-surface px-2 py-2 font-mono text-sm text-secondary"
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="rounded-md p-2 text-secondary hover:bg-surface-3"
              title={visible ? t("hideKey") : t("showKey")}
            >
              {visible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <span onClick={() => setCopied(true)}>
              <CopyButton value={createdKey.key} label={t("copy")} copiedLabel={t("copied")} />
            </span>
          </div>

          <p className="mt-3 text-xs text-warning">⚠ {t("onlyTimeShown")}</p>

          <button type="button" onClick={onClose}
            className="mt-5 w-full rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover">
            {copied ? t("copiedDone") : t("done")}
          </button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
