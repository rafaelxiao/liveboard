import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { register } from "../api/auth";
import AuthShell from "../components/AuthShell";
import { ApiError } from "../lib/types";

const MIN_PASSWORD = 8;

export default function RegisterPage() {
  const { t } = useTranslation("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await register(email, password);
      setSubmitted(true); // I1: show confirmation, never navigate to dashboard
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("This email is already registered. Sign in?");
      } else {
        setError(err instanceof Error ? err.message : "Registration failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center text-center">
          <CheckCircle2 size={40} className="mb-3 text-success-ui" aria-hidden />
          <h1 className="text-lg font-semibold text-primary">{t("Account created — pending approval")}</h1>
          <p className="mt-2 text-sm text-muted">
            {t("An administrator must approve your account before you can sign in.")}
          </p>
          <Link to="/awaiting-approval" className="mt-6 text-accent underline">
            {t("Go to status")} →
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="mb-6 text-center text-lg font-semibold text-primary">{t("Create Account")}</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            {t("Email")}
          </label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-secondary" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            {t("Password")}
          </label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-secondary" />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            {t("Confirm password")}
          </label>
          <input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-secondary" />
        </div>
        {error && (
          <div role="alert" className="rounded-md border border-danger-ui bg-surface-2 px-3 py-2 text-sm text-danger-ui">
            {error}
          </div>
        )}
        <button type="submit" disabled={submitting || !email || !password || !confirm}
          className="w-full rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {submitting ? t("Creating...") : t("Create Account")}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t("Already have an account?")}{" "}
        <Link to="/login" className="text-accent underline">
          {t("Sign In")} →
        </Link>
      </p>
    </AuthShell>
  );
}
