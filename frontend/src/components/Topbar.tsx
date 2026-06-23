import { useState, useRef, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAuth } from "../auth/AuthContext";
import { useBreadcrumbStore } from "../state/breadcrumbStore";
import { ChevronRight, BookOpen, ChevronDown, LogOut } from "lucide-react";
import LangToggle from "./LangToggle";
import ThemeToggle from "./ThemeToggle";

export default function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const segments = useBreadcrumbStore((s) => s.segments);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <header className="flex h-14 items-center justify-between border-b border-border-default bg-surface px-4">
      <div className="flex items-center gap-1 text-sm">
        {segments.length > 0 ? (
          segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="text-muted" />}
              {seg.onClick ? (
                <button onClick={seg.onClick} className="text-secondary hover:text-primary transition-colors">
                  {seg.label}
                </button>
              ) : (
                <span className="text-primary font-medium">{seg.label}</span>
              )}
            </span>
          ))
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <LangToggle />
        <Link to="/docs" className="text-secondary hover:text-primary transition-colors" title={t("Docs")}>
          <BookOpen size={16} />
        </Link>
        <ThemeToggle />
        {user && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-secondary hover:bg-surface-2 transition-colors"
            >
              <span>{user.email}</span>
              <ChevronDown size={14} className={`transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-border-default bg-surface p-1 shadow-lg z-50">
                <div className="px-3 py-2 text-xs text-muted border-b border-border-subtle">
                  {t("Role")}: {user.role === "admin" ? t("Admin") : t("User")}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    logout();
                    navigate("/login");
                  }}
                  className="flex items-center gap-2 w-full rounded px-3 py-2 text-sm text-secondary hover:bg-surface-2 transition-colors"
                >
                  <LogOut size={14} />
                  {t("Logout")}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
