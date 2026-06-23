import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useAuth } from "../auth/AuthContext";
import AuthShell from "../components/AuthShell";
import { ApiError } from "../lib/types";

type LoginError =
  | { kind: "awaiting" }
  | { kind: "rejected" }
  | { kind: "credentials" }
  | { kind: "generic"; message: string }
  | null;

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useTranslation("auth");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginError>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(params.get("next") ?? "/dashboard", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(/reject/i.test(err.message) ? { kind: "rejected" } : { kind: "awaiting" });
      } else if (err instanceof ApiError && err.status === 401) {
        setError({ kind: "credentials" });
      } else {
        setError({ kind: "generic", message: err instanceof Error ? err.message : "Login failed" });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell>
      <h1 className="mb-1 text-center text-lg font-semibold text-primary">{t("Sign In")}</h1>
      <p className="mb-6 text-center text-sm text-muted">{t("Sign in to your account")}</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            {t("Email")}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={submitting}
            className="w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-secondary"
          />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            {t("Password")}
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            className="w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-secondary"
          />
        </div>

        {error?.kind === "awaiting" && (
          <div role="alert" className="rounded-md border border-warning bg-surface-2 px-3 py-2 text-sm text-warning">
            {t("Your account is awaiting admin approval.")}{" "}
            <Link to="/awaiting-approval" className="underline">
              {t("View awaiting status")}
            </Link>
          </div>
        )}
        {error?.kind === "rejected" && (
          <div role="alert" className="rounded-md border border-danger-ui bg-surface-2 px-3 py-2 text-sm text-danger-ui">
            {t("This account isn't approved for access. Contact your administrator.")}
          </div>
        )}
        {error?.kind === "credentials" && (
          <div role="alert" className="rounded-md border border-danger-ui bg-surface-2 px-3 py-2 text-sm text-danger-ui">
            {t("Incorrect email or password.")}
          </div>
        )}
        {error?.kind === "generic" && (
          <div role="alert" className="rounded-md border border-danger-ui bg-surface-2 px-3 py-2 text-sm text-danger-ui">
            {error.message}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !email || !password}
          className="w-full rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? t("Signing in...") : t("Sign In")}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        {t("Don't have an account?")}{" "}
        <Link to="/register" className="text-accent underline">
          {t("Register")} →
        </Link>
      </p>
      <p className="mt-2 text-center text-sm text-muted">
        <Link to="/docs" className="text-secondary hover:text-primary underline underline-offset-2">
          {t("Docs", { ns: "common" })}
        </Link>
      </p>
    </AuthShell>
  );
}
