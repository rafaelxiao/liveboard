import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { approveUser, listUsers, rejectUser } from "../api/admin";
import AlertBanner from "../components/AlertBanner";
import ConfirmPopover from "../components/ConfirmPopover";
import EmptyState from "../components/EmptyState";
import StatusChip from "../components/StatusChip";
import { useToast } from "../components/Toast";
import { formatRelative } from "../lib/format";
import type { UserStatus } from "../lib/types";

export default function AdminUsersPage() {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();
  const { notify } = useToast();
  const [filter, setFilter] = useState<UserStatus | "all">("pending");

  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: listUsers });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approveUser(id),
    onSuccess: () => {
      notify(t("userApproved"));
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
  const rejectMutation = useMutation({
    mutationFn: (id: number) => rejectUser(id),
    onSuccess: () => {
      notify(t("userRejected"));
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const rows = (usersQuery.data ?? []).filter((u) => filter === "all" || u.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-primary">{t("adminTitle")}</h1>
        <select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => setFilter(e.target.value as UserStatus | "all")}
          className="rounded-sm border border-border-default bg-surface-2 px-2 py-1 text-sm text-secondary"
        >
          <option value="pending">{t("adminFilter.pending")}</option>
          <option value="approved">{t("adminFilter.approved")}</option>
          <option value="rejected">{t("adminFilter.rejected")}</option>
          <option value="all">{t("adminFilter.all")}</option>
        </select>
      </div>

      {usersQuery.isError && <AlertBanner message={t("adminLoadError")} onRetry={() => usersQuery.refetch()} />}

      {usersQuery.isSuccess && rows.length === 0 && (
        <EmptyState title={t("adminEmpty")} description={t("adminEmptyDescription")} />
      )}

      {rows.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2">{t("adminTable.email")}</th>
              <th>{t("adminTable.status")}</th>
              <th>{t("adminTable.role")}</th>
              <th>{t("adminTable.registered")}</th>
              <th>{t("adminTable.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-border-subtle">
                <td className="py-2 text-secondary">{u.email}</td>
                <td><StatusChip status={u.status} /></td>
                <td className="text-muted">{u.role}</td>
                <td className="text-muted">{formatRelative(u.created_at)}</td>
                <td>
                  {u.status === "pending" ? (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => approveMutation.mutate(u.id)}
                        className="rounded-md bg-accent px-2 py-1 text-xs text-white hover:bg-accent-hover">
                        {t("approve")}
                      </button>
                      <ConfirmPopover
                        message={t("rejectConfirm", { email: u.email })}
                        confirmLabel={t("reject")}
                        onConfirm={() => rejectMutation.mutate(u.id)}
                        trigger={
                          <button type="button" className="rounded-md border border-border-default px-2 py-1 text-xs text-danger-ui">
                            {t("reject")}
                          </button>
                        }
                      />
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
