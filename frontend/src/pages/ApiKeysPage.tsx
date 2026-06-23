import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createApiKey, listApiKeys, revokeApiKey } from "../api/apiKeys";
import AlertBanner from "../components/AlertBanner";
import ApiKeyCreatedModal from "../components/ApiKeyCreatedModal";
import ConfirmPopover from "../components/ConfirmPopover";
import EmptyState from "../components/EmptyState";
import PnlColorToggle from "../components/PnlColorToggle";
import { useToast } from "../components/Toast";
import { formatRelative } from "../lib/format";
import type { ApiKeyCreatedOut } from "../lib/types";

export default function ApiKeysPage() {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();
  const { notify } = useToast();
  const [newName, setNewName] = useState("");
  const [created, setCreated] = useState<ApiKeyCreatedOut | null>(null);

  const keysQuery = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys });

  const createMutation = useMutation({
    mutationFn: (name: string) => createApiKey(name),
    onSuccess: (data) => {
      setCreated(data); // hand the full key to the copy-once modal (Task 11)
      setNewName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => revokeApiKey(id),
    onSuccess: () => {
      notify(t("keyRevoked"));
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-primary">{t("pageTitle")}</h1>

      {/* Display settings */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-secondary uppercase tracking-wide">{t("display")}</h2>
        <div className="rounded-lg border border-border-default bg-surface p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-primary">{t("pnlColors")}</p>
              <p className="text-xs text-muted mt-0.5">{t("pnlColorsDescription")}</p>
            </div>
            <PnlColorToggle />
          </div>
        </div>
      </section>

      {/* API Keys */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">{t("apiKeys")}</h2>
          <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) createMutation.mutate(newName.trim());
          }}
          className="flex gap-2"
        >
          <input
            aria-label="New key name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t("keyNamePlaceholder")}
            className="rounded-sm border border-border-default bg-surface-2 px-2 py-1 text-sm text-secondary"
          />
          <button type="submit" disabled={createMutation.isPending || !newName.trim()}
            className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                        {t("newKey")}
          </button>
        </form>
      </div>

      <p className="text-sm text-muted">{t("apiKeysDescription")}</p>

      {keysQuery.isError && <AlertBanner message={t("apiKeysLoadError")} onRetry={() => keysQuery.refetch()} />}

      {keysQuery.isSuccess && keysQuery.data.length === 0 && (
        <EmptyState title={t("apiKeysEmpty")} description={t("apiKeysEmptyDescription")} />
      )}

      {keysQuery.isSuccess && keysQuery.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2">{t("table.name")}</th>
              <th>{t("table.prefix")}</th>
              <th>{t("table.lastUsed")}</th>
              <th>{t("table.created")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keysQuery.data.map((k) => (
              <tr key={k.id} className="border-t border-border-subtle">
                <td className="py-2 text-secondary">{k.name}</td>
                <td className="font-mono text-secondary">{k.prefix}••••</td>
                <td title={k.last_used_at ?? ""} className="text-muted">
                  {k.last_used_at ? formatRelative(k.last_used_at) : t("neverUsed")}
                </td>
                <td className="text-muted">{formatRelative(k.created_at)}</td>
                <td className="text-right">
                  <ConfirmPopover
                    message={t("revokeConfirm", { name: k.name })}
                    confirmLabel={t("confirm")}
                    onConfirm={() => revokeMutation.mutate(k.id)}
                    trigger={
                      <button type="button" className="text-danger-ui hover:underline">
                        {t("revoke")}
                      </button>
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      </section>

      <ApiKeyCreatedModal createdKey={created} onClose={() => setCreated(null)} />
    </div>
  );
}
