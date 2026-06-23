import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { KeyRound, LineChart, Shield, GitCompare } from "lucide-react";

import { useAuthStore } from "../auth/authStore";

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
    isActive
      ? "border-l-[3px] border-accent bg-surface-3 text-primary"
      : "text-secondary hover:bg-surface-2",
  ].join(" ");

export default function Sidebar() {
  const { t } = useTranslation();
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  return (
    <nav aria-label="Primary" className="sidebar-collapsible flex w-60 flex-col gap-1 bg-surface p-3">
      <span className="sidebar-brand px-3 py-2 text-lg font-semibold text-primary">{t("LiveBoard")}</span>
      <NavLink to="/dashboard" className={navClass}>
        <LineChart size={18} aria-hidden /> <span className="sidebar-label">{t("Dashboard")}</span>
      </NavLink>
      <NavLink to="/compare" className={navClass}>
        <GitCompare size={18} aria-hidden /> <span className="sidebar-label">{t("Compare")}</span>
      </NavLink>
      <hr className="my-2 border-border-subtle" />
      <NavLink to="/settings" className={navClass}>
        <KeyRound size={18} aria-hidden /> <span className="sidebar-label">{t("Settings")}</span>
      </NavLink>
      {isAdmin && (
        <NavLink to="/admin/users" className={navClass}>
          <Shield size={18} aria-hidden /> <span className="sidebar-label">{t("Admin")}</span>
        </NavLink>
      )}
    </nav>
  );
}
