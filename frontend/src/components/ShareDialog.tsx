import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Share2, X, Copy, Check } from "lucide-react";
import { apiFetch } from "../api/client";
import type { ShareLinkOut } from "../lib/types";

interface ShareDialogProps {
  seriesId: number;
  seriesName: string;
  tradeStart?: string | null;
}

export default function ShareDialog({ seriesId, seriesName, tradeStart }: ShareDialogProps) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [pnlScheme, setPnlScheme] = useState(localStorage.getItem("lb_pnl_color_scheme") || "red-up");
  const [lang, setLang] = useState(
    localStorage.getItem("lb_lang") || (navigator.language.startsWith("zh") ? "zh" : "en")
  );
  const [customSlug, setCustomSlug] = useState("");
  const [dateFrom, setDateFrom] = useState(tradeStart || "");
  const [copied, setCopied] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch<ShareLinkOut>(`/series/${seriesId}/shares`, {
        method: "POST",
        body: {
          expires_in_days: expiresIn || undefined,
          pnl_color_scheme: pnlScheme,
          trade_grouping: localStorage.getItem("lb_trade_grouping") || "day",
          lang: lang,
          custom_slug: customSlug || undefined,
          date_from: dateFrom || undefined,
        },
      }),
    onSuccess: () => {},
  });

  const shareUrl = (data: { token: string; slug?: string }) =>
    `${window.location.origin}/liveboard/share/${data.slug || data.token}`;

  const copyLink = (text: string) => {
    // Fallback for HTTP where navigator.clipboard is unavailable
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(text);
        setTimeout(() => setCopied(null), 2000);
      }).catch(() => {});
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(text);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const EXPIRY_OPTIONS = [
    { value: "", label: t("share.neverExpires") },
    { value: "1", label: t("share.days", { count: 1 }) },
    { value: "7", label: t("share.days", { count: 7 }) },
    { value: "30", label: t("share.days", { count: 30 }) },
    { value: "90", label: t("share.days", { count: 90 }) },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs text-secondary hover:bg-surface-2 transition-colors"
      >
        <Share2 size={14} />
        {t("share.title")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-lg border border-border-default bg-surface-2 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-primary">
                {t("share.dialogTitle", { name: seriesName })}
              </h2>
              <button onClick={() => { setOpen(false); createMutation.reset(); }} className="text-muted hover:text-secondary">
                <X size={18} />
              </button>
            </div>

            {/* Create new link */}
            <div className="mb-4 p-3 rounded-md border border-border-default bg-surface space-y-3">
              <div className="text-xs text-secondary">{t("share.createLabel")}</div>

              {/* Expiry */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted w-20">{t("share.expiry")}</span>
                <select
                  value={expiresIn ?? ""}
                  onChange={(e) => setExpiresIn(e.target.value ? Number(e.target.value) : null)}
                  className="flex-1 h-8 rounded-sm border border-border-default bg-surface px-2 text-xs text-secondary"
                >
                  {EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* PnL Colors */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted w-20">{t("share.pnlColors")}</span>
                <select
                  value={pnlScheme}
                  onChange={(e) => setPnlScheme(e.target.value)}
                  className="flex-1 h-8 rounded-sm border border-border-default bg-surface px-2 text-xs text-secondary"
                >
                  <option value="red-up">{t("share.redUp")}</option>
                  <option value="green-up">{t("share.greenUp")}</option>
                </select>
              </div>

              {/* Language */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted w-20">{t("share.pageLang")}</span>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="flex-1 h-8 rounded-sm border border-border-default bg-surface px-2 text-xs text-secondary"
                >
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                </select>
              </div>

              {/* Custom slug */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted w-20">{t("share.customSlug")}</span>
                <input
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                  placeholder={t("share.slugPlaceholder")}
                  className="flex-1 h-8 rounded-sm border border-border-default bg-surface px-2 text-xs text-secondary"
                />
              </div>

              {/* Start date */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted w-20">{t("share.dateFrom")}</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="flex-1 h-8 rounded-sm border border-border-default bg-surface px-2 text-xs text-secondary"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending}
                  className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {createMutation.isPending ? "..." : t("share.create")}
                </button>
              </div>
            </div>

            {/* Create result */}
            {createMutation.isSuccess && createMutation.data && (
              <div className="mb-4 p-3 rounded border border-border-default bg-surface">
                <div className="text-xs text-secondary mb-1">{t("share.linkCreated")}</div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-secondary truncate flex-1 font-mono">{shareUrl(createMutation.data)}</div>
                  <button onClick={() => copyLink(shareUrl(createMutation.data))} className="p-1 text-muted hover:text-secondary" title="Copy">
                    {copied === shareUrl(createMutation.data) ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}

            {createMutation.isError && (
              <div className="text-xs text-pnl-loss mb-2">{t("share.loadError")}</div>
            )}

            <div className="mt-4 text-[10px] text-muted">
              {t("share.footerNote")}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
