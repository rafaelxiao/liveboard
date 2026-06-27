import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createApiKey, listApiKeys, revokeApiKey } from "../api/apiKeys";
import { apiFetch } from "../api/client";
import type { ShareLinkOut } from "../lib/types";
import AlertBanner from "../components/AlertBanner";
import ApiKeyCreatedModal from "../components/ApiKeyCreatedModal";
import ConfirmPopover from "../components/ConfirmPopover";
import EmptyState from "../components/EmptyState";
import PnlColorToggle from "../components/PnlColorToggle";
import TradeGroupingToggle from "../components/TradeGroupingToggle";
import { useToast } from "../components/Toast";
import { formatRelative } from "../lib/format";
import type { ApiKeyCreatedOut } from "../lib/types";

export default function SettingsPage() {
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
    <div>
      <h1 className="text-xl font-semibold text-primary mb-6">{t("pageTitle")}</h1>

      {/* Display settings */}
      <section className="rounded-lg border border-border-default bg-surface p-5 mb-6">
        <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-4">{t("display")}</h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-primary">{t("pnlColors")}</p>
              <p className="text-xs text-muted mt-0.5">{t("pnlColorsDescription")}</p>
            </div>
            <PnlColorToggle />
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
            <div>
              <p className="text-sm font-medium text-primary">{t("tradeGrouping")}</p>
              <p className="text-xs text-muted mt-0.5">{t("tradeGroupingDescription")}</p>
            </div>
            <TradeGroupingToggle />
          </div>
        </div>
      </section>

      {/* API Keys */}
      <section className="rounded-lg border border-border-default bg-surface p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide">{t("apiKeys")}</h2>
            <p className="text-xs text-muted mt-1">{t("apiKeysDescription")}</p>
          </div>
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

      {/* Share Links */}
      <ShareLinksSection />
    </div>
  );
}

function ShareLinksSection() {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();
  const { notify } = useToast();

  const sharesQuery = useQuery({
    queryKey: ["share-links-all"],
    queryFn: () => apiFetch<ShareLinkOut[]>("/series/shares"),
  });

  const revokeMutation = useMutation({
    mutationFn: ({ seriesId, linkId }: { seriesId: number; linkId: number }) =>
      apiFetch(`/series/${seriesId}/shares/${linkId}`, { method: "DELETE" }),
    onSuccess: () => {
      notify(t("share.revoked"));
      qc.invalidateQueries({ queryKey: ["share-links-all"] });
    },
  });

  const shareUrl = (data: { token: string; slug?: string }) =>
    `${window.location.origin}${import.meta.env.BASE_URL}share/${data.slug || data.token}`;

  return (
    <section className="rounded-lg border border-border-default bg-surface p-5 mb-6">
      <h2 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-1">{t("share.manageTitle")}</h2>
      <p className="text-xs text-muted mb-4">{t("share.manageDescription")}</p>

      {sharesQuery.isLoading && (
        <div className="text-xs text-muted">Loading...</div>
      )}
      {sharesQuery.data && sharesQuery.data.length === 0 && (
        <div className="text-xs text-muted">{t("share.noLinks")}</div>
      )}
      {sharesQuery.data && sharesQuery.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2">{t("share.seriesColumn")}</th>
              <th>{t("share.linkColumn")}</th>
              <th>{t("share.expiryColumn")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sharesQuery.data.map((link: ShareLinkOut) => (
              <tr key={link.id} className="border-t border-border-subtle">
                <td className="py-2 text-secondary">{link.series_name || `S${link.series_id}`}</td>
                <td className="py-2">
                  <a href={shareUrl(link)} target="_blank" rel="noopener" className="text-accent hover:underline text-xs font-mono">
                    {shareUrl(link)}
                  </a>
                </td>
                <td className="py-2 text-muted text-xs">
                  {link.expires_at
                    ? new Date(link.expires_at).toLocaleDateString()
                    : t("share.neverExpires")}
                </td>
                <td className="py-2 text-right">
                  <button
                    onClick={() => {
                      const url = shareUrl(link);
                      if (navigator.clipboard) {
                        navigator.clipboard.writeText(url);
                      } else {
                        const ta = document.createElement("textarea");
                        ta.value = url;
                        ta.style.position = "fixed"; ta.style.opacity = "0";
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand("copy");
                        document.body.removeChild(ta);
                      }
                      notify(t("copied"));
                    }}
                    className="text-xs text-secondary hover:text-primary mr-3"
                  >
                    {t("copy")}
                  </button>
                  <button
                    onClick={() => revokeMutation.mutate({ seriesId: link.series_id!, linkId: link.id })}
                    className="text-xs text-danger-ui hover:underline"
                  >
                    {t("revoke")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
