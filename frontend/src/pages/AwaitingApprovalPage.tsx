import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useAuth } from "../auth/AuthContext";
import AuthShell from "../components/AuthShell";

export default function AwaitingApprovalPage() {
  const { user, logout, refreshMe } = useAuth();
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onCheck = async () => {
    setChecking(true);
    setNote(null);
    setError(null);
    try {
      const fresh = await refreshMe();
      if (fresh.status === "approved") {
        navigate("/dashboard", { replace: true });
      } else {
        setNote("Still pending — check back later.");
      }
    } catch {
      setError("Couldn't reach the server, retry.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <AuthShell>
      <div className="flex flex-col items-center text-center">
        <Clock size={40} className="mb-3 text-warning" aria-hidden />
        <h1 className="text-lg font-semibold text-primary">{t("Your account is pending approval")}</h1>
        <p className="mt-2 text-sm text-muted">
          {t("Your account is pending review.")} ({user?.email})
        </p>
        <ul className="mt-4 space-y-1 text-left text-sm text-muted">
          <li>{t("• You'll be able to log in once approved.")}</li>
          <li>{t("• API keys can't be created yet.")}</li>
        </ul>
        {note && <p className="mt-4 text-sm text-warning">{note}</p>}
        {error && (
          <p role="alert" className="mt-4 text-sm text-danger-ui">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onCheck} disabled={checking}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            {checking ? t("Checking...") : t("Check status")}
          </button>
          <button type="button" onClick={() => { logout(); navigate("/login"); }}
            className="rounded-md border border-border-default px-4 py-2 text-sm text-secondary hover:bg-surface-2">
            {t("Log out")}
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
