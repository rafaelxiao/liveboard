import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "../auth/authStore";
import LangToggle from "../components/LangToggle";

type Lang = "curl" | "python" | "javascript";

const LANG_OPTIONS: { value: Lang; label: string }[] = [
  { value: "curl", label: "cURL" },
  { value: "python", label: "Python" },
  { value: "javascript", label: "JavaScript" },
];

function getExample(lang: Lang, code: Record<Lang, string>): string {
  return code[lang];
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-[#0D1117] p-4 text-[13px] leading-relaxed text-[#C9D1D9] border border-border-subtle">
      <code className={`language-${lang}`}>{code}</code>
    </pre>
  );
}

function EndpointExample({
  method,
  path,
  auth,
  description,
  curl,
  python,
  javascript,
}: {
  method: "POST" | "GET";
  path: string;
  auth: string;
  description: string;
  curl: string;
  python: string;
  javascript: string;
}) {
  const { t } = useTranslation("docs");
  const [lang, setLang] = useState<Lang>("curl");
  const examples: Record<Lang, string> = { curl, python, javascript };

  return (
    <div className="mb-10 rounded-lg border border-border-default bg-surface p-6">
      <div className="mb-2 flex items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${method === "POST" ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"}`}>
          {method}
        </span>
        <code className="text-sm text-secondary">{path}</code>
      </div>
      <div className="mb-3 flex items-center gap-2 text-[11px] text-muted">
        <span>{t("reference.auth")}: {auth}</span>
      </div>
      <p className="mb-4 text-sm text-secondary">{description}</p>

      <div className="mb-3 flex gap-1">
        {LANG_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => setLang(o.value)}
            className={`rounded px-2 py-1 text-[11px] ${
              lang === o.value
                ? "bg-accent text-white"
                : "bg-surface-2 text-muted hover:text-secondary"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <CodeBlock code={getExample(lang, examples)} lang={lang === "curl" ? "bash" : lang} />
    </div>
  );
}

export default function DocsPage() {
  const { t } = useTranslation("docs");
  const isLoggedIn = !!useAuthStore((s) => s.user);
  const BASE = "/liveboard/api/v1";  // or https://your-host/liveboard/api/v1
  const HEADER = "X-API-Key: $LIVEBOARD_API_KEY";

  return (
    <div className="min-h-screen bg-app text-secondary">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border-default bg-surface/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link to="/docs" className="text-lg font-semibold text-primary font-mono">
            LiveBoard
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <LangToggle />
            <a href="#ingestion" className="text-muted hover:text-secondary transition-colors">{t("nav.ingestion")}</a>
            <a href="#reference" className="text-muted hover:text-secondary transition-colors">{t("nav.reference")}</a>
            <Link to={isLoggedIn ? "/dashboard" : "/login"} className="rounded-md bg-accent px-3 py-1 text-white hover:bg-accent-hover transition-colors">
              {isLoggedIn ? t("nav.dashboard") : t("nav.signIn")}
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {/* Hero */}
        <section className="mb-12">
          <h1 className="mb-2 text-3xl font-bold text-primary font-mono">{t("hero.title")}</h1>
          <p className="max-w-2xl text-secondary">
            {t("hero.description")}
          </p>
          <div className="mt-4 flex gap-3">
            <a href="#ingestion" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors">
              {t("hero.getStarted")}
            </a>
            <a href="#reference" className="rounded-md border border-border-default px-4 py-2 text-sm text-secondary hover:bg-surface-2 transition-colors">
              {t("hero.apiReference")}
            </a>
          </div>
        </section>

        {/* Quickstart */}
        <section className="mb-12">
          <h2 className="mb-4 text-xl font-semibold text-primary font-mono">{t("quickstart.title")}</h2>
          <div className="space-y-3 text-sm text-secondary">
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-primary">1</span>
              <div>
                <p className="font-medium text-primary">{t("quickstart.step1Title")}</p>
                <p className="text-xs text-muted mt-0.5">{t("quickstart.step1Desc")}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-primary">2</span>
              <div>
                <p className="font-medium text-primary">{t("quickstart.step2Title")}</p>
                <p className="text-xs text-muted mt-0.5">{t("quickstart.step2Desc")}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-primary">3</span>
              <div>
                <p className="font-medium text-primary">{t("quickstart.step3Title")}</p>
                <p className="text-xs text-muted mt-0.5">{t("quickstart.step3Desc")}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-primary">4</span>
              <div>
                <p className="font-medium text-primary">{t("quickstart.step4Title")}</p>
                <p className="text-xs text-muted mt-0.5">{t("quickstart.step4Desc")}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-primary">5</span>
              <div>
                <p className="font-medium text-primary">{t("quickstart.step5Title")}</p>
                <p className="text-xs text-muted mt-0.5">{t("quickstart.step5Desc")}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Core Concepts */}
        <section className="mb-12">
          <h2 className="mb-4 text-xl font-semibold text-primary font-mono">{t("concepts.title")}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {[
              { title: t("concepts.series.title"), desc: t("concepts.series.desc"), icon: "L" },
              { title: t("concepts.strategy.title"), desc: t("concepts.strategy.desc"), icon: "S" },
              { title: t("concepts.instrument.title"), desc: t("concepts.instrument.desc"), icon: "I" },
              { title: t("concepts.fill.title"), desc: t("concepts.fill.desc"), icon: "F" },
            ].map((c) => (
              <div key={c.title} className="rounded-lg border border-border-default bg-surface p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/20 text-[11px] font-bold text-accent font-mono">{c.icon}</span>
                  <h3 className="font-semibold text-primary text-sm">{c.title}</h3>
                </div>
                <p className="text-xs text-secondary">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Ingestion Endpoints */}
        <section id="ingestion" className="mb-12">
          <h2 className="mb-6 text-xl font-semibold text-primary font-mono">{t("ingestion.title")}</h2>

          <EndpointExample
            method="POST"
            path="/series"
            auth="API Key"
            description={t("ingestion.createSeries")}
            curl={`curl -X POST ${BASE}/series \\\\
  -H "${HEADER}" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "name": "Alpha-Real",
    "tag": "live",
    "base_currency": "USD",
    "session_tz": "America/New_York"
  }'`}
            python={`import requests

resp = requests.post(
    "${BASE}/series",
    headers={"X-API-Key": "$LIVEBOARD_API_KEY"},
    json={
        "name": "Alpha-Real",
        "tag": "live",
        "base_currency": "USD",
        "session_tz": "America/New_York",
    },
)
series_id = resp.json()["series_id"]`}
            javascript={`const resp = await fetch("${BASE}/series", {
  method: "POST",
  headers: {
    "X-API-Key": "$LIVEBOARD_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    name: "Alpha-Real",
    tag: "live",
    base_currency: "USD",
    session_tz: "America/New_York",
  }),
});
const { series_id } = await resp.json();`}
          />

          <EndpointExample
            method="POST"
            path="/series/{series_id}/instruments"
            auth="API Key"
            description={t("ingestion.registerInstruments")}
            curl={`curl -X POST ${BASE}/series/1/instruments \\\\
  -H "${HEADER}" \\\\
  -H "Content-Type: application/json" \\\\
  -d '[
    {"symbol": "ES", "asset_class": "future", "multiplier": "50", "currency": "USD"},
    {"symbol": "NQ", "asset_class": "future", "multiplier": "20", "currency": "USD"},
    {"symbol": "BTC-USD", "asset_class": "crypto", "multiplier": "1", "currency": "USD"},
    {"symbol": "EUR-USD", "asset_class": "fx", "multiplier": "1", "currency": "EUR"}
  ]'`}
            python={`requests.post(
    "${BASE}/series/{series_id}/instruments",
    headers={"X-API-Key": "$LIVEBOARD_API_KEY"},
    json=[
        {"symbol": "ES", "asset_class": "future", "multiplier": "50", "currency": "USD"},
        {"symbol": "NQ", "asset_class": "future", "multiplier": "20", "currency": "USD"},
        {"symbol": "BTC-USD", "asset_class": "crypto", "multiplier": "1", "currency": "USD"},
        {"symbol": "EUR-USD", "asset_class": "fx", "multiplier": "1", "currency": "EUR"},
    ],
)`}
            javascript={`await fetch("${BASE}/series/{series_id}/instruments", {
  method: "POST",
  headers: {
    "X-API-Key": "$LIVEBOARD_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify([
    { symbol: "ES", asset_class: "future", multiplier: "50", currency: "USD" },
    { symbol: "NQ", asset_class: "future", multiplier: "20", currency: "USD" },
    { symbol: "BTC-USD", asset_class: "crypto", multiplier: "1", currency: "USD" },
    { symbol: "EUR-USD", asset_class: "fx", multiplier: "1", currency: "EUR" },
  ]),
});`}
          />

          <EndpointExample
            method="POST"
            path="/series/{series_id}/fx-rates"
            auth="API Key"
            description={t("ingestion.postFxRates")}
            curl={`curl -X POST ${BASE}/series/1/fx-rates \\\\
  -H "${HEADER}" \\\\
  -H "Content-Type: application/json" \\\\
  -d '[
    {"ccy_from": "EUR", "ccy_to": "USD", "ts": "2024-01-02T12:00:00Z", "rate": "1.0950"},
    {"ccy_from": "GBP", "ccy_to": "USD", "ts": "2024-01-02T12:00:00Z", "rate": "1.2720"}
  ]'`}
            python={`requests.post(
    "${BASE}/series/{series_id}/fx-rates",
    headers={"X-API-Key": "$LIVEBOARD_API_KEY"},
    json=[
        {"ccy_from": "EUR", "ccy_to": "USD", "ts": "2024-01-02T12:00:00Z", "rate": "1.0950"},
        {"ccy_from": "GBP", "ccy_to": "USD", "ts": "2024-01-02T12:00:00Z", "rate": "1.2720"},
    ],
)`}
            javascript={`await fetch("${BASE}/series/{series_id}/fx-rates", {
  method: "POST",
  headers: {
    "X-API-Key": "$LIVEBOARD_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify([
    { ccy_from: "EUR", ccy_to: "USD", ts: "2024-01-02T12:00:00Z", rate: "1.0950" },
    { ccy_from: "GBP", ccy_to: "USD", ts: "2024-01-02T12:00:00Z", rate: "1.2720" },
  ]),
});`}
          />

          <EndpointExample
            method="POST"
            path="/series/{series_id}/fund-movements"
            auth="API Key"
            description={t("ingestion.postFundMovements")}
            curl={`curl -X POST ${BASE}/series/1/fund-movements \\\\
  -H "${HEADER}" \\\\
  -H "Content-Type: application/json" \\\\
  -d '[
    {"client_movement_id": "dep-001", "ts": "2024-01-01T09:00:00Z", "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH", "amount": "2000000", "currency": "USD"},
    {"client_movement_id": "alloc-001", "ts": "2024-01-02T08:00:00Z", "from_bucket": "FREE_CASH", "to_bucket": "STRATEGY", "to_strategy": "momentum-equity", "amount": "800000", "currency": "USD"},
    {"client_movement_id": "xfer-001", "ts": "2025-06-01T08:00:00Z", "from_bucket": "STRATEGY", "from_strategy": "momentum-equity", "to_bucket": "STRATEGY", "to_strategy": "mean-rev-crypto", "amount": "100000", "currency": "USD"}
  ]'`}
            python={`requests.post(
    "${BASE}/series/{series_id}/fund-movements",
    headers={"X-API-Key": "$LIVEBOARD_API_KEY"},
    json=[
        {"client_movement_id": "dep-001", "ts": "2024-01-01T09:00:00Z", "from_bucket": "EXTERNAL", "to_bucket": "FREE_CASH", "amount": "2000000", "currency": "USD"},
        {"client_movement_id": "alloc-001", "ts": "2024-01-02T08:00:00Z", "from_bucket": "FREE_CASH", "to_bucket": "STRATEGY", "to_strategy": "momentum-equity", "amount": "800000", "currency": "USD"},
        {"client_movement_id": "xfer-001", "ts": "2025-06-01T08:00:00Z", "from_bucket": "STRATEGY", "from_strategy": "momentum-equity", "to_bucket": "STRATEGY", "to_strategy": "mean-rev-crypto", "amount": "100000", "currency": "USD"},
    ],
)`}
            javascript={`await fetch("${BASE}/series/{series_id}/fund-movements", {
  method: "POST",
  headers: {
    "X-API-Key": "$LIVEBOARD_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify([
    { ts: "2024-01-01T09:00:00Z", from_bucket: "EXTERNAL", to_bucket: "FREE_CASH", amount: "2000000", currency: "USD" },
    { ts: "2024-01-02T08:00:00Z", from_bucket: "FREE_CASH", to_bucket: "STRATEGY", to_strategy: "momentum-equity", amount: "800000", currency: "USD" },
    { ts: "2025-06-01T08:00:00Z", from_bucket: "STRATEGY", from_strategy: "momentum-equity", to_bucket: "STRATEGY", to_strategy: "mean-rev-crypto", amount: "100000", currency: "USD" },
  ]),
});`}
          />

          <EndpointExample
            method="POST"
            path="/series/{series_id}/fills:batch"
            auth="API Key"
            description={t("ingestion.postFills")}
            curl={`curl -X POST ${BASE}/series/1/fills:batch \\\\
  -H "${HEADER}" \\\\
  -H "Content-Type: application/json" \\\\
  -d '{
    "fills": [
      {
        "client_fill_id": "fill-001",
        "strategy": "momentum-equity",
        "symbol": "ES",
        "side": "buy",
        "qty": "2",
        "price": "4850.25",
        "ts": "2024-01-02T14:30:00Z",
        "commission": "2.50",
        "exchange_fee": "1.50",
        "regulatory_fee": "0.02",
        "financing_fee": "0"
      }
    ]
  }'`}
            python={`resp = requests.post(
    "${BASE}/series/{series_id}/fills:batch",
    headers={"X-API-Key": "$LIVEBOARD_API_KEY"},
    json={
        "fills": [
            {
                "client_fill_id": "fill-001",
                "strategy": "momentum-equity",
                "symbol": "ES",
                "side": "buy",
                "qty": "2",
                "price": "4850.25",
                "ts": "2024-01-02T14:30:00Z",
                "commission": "2.50",
                "exchange_fee": "1.50",
                "regulatory_fee": "0.02",
                "financing_fee": "0",
            }
        ]
    },
)
result = resp.json()
print(f"Inserted: {result['inserted']}, Updated: {result['updated']}, Rejected: {result['rejected']}")`}
            javascript={`const resp = await fetch("${BASE}/series/{series_id}/fills:batch", {
  method: "POST",
  headers: {
    "X-API-Key": "$LIVEBOARD_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    fills: [
      {
        client_fill_id: "fill-001",
        strategy: "momentum-equity",
        symbol: "ES",
        side: "buy",
        qty: "2",
        price: "4850.25",
        ts: "2024-01-02T14:30:00Z",
        commission: "2.50",
        exchange_fee: "1.50",
        regulatory_fee: "0.02",
        financing_fee: "0",
      },
    ],
  }),
});
const { inserted, updated, rejected } = await resp.json();
console.log(\`Inserted: \${inserted}, Updated: \${updated}, Rejected: \${rejected}\`);`}
          />
        </section>

          <EndpointExample
            method="GET"
            path="/series/{series_id}/fills"
            auth="JWT / API Key"
            description={t("ingestion.getFills")}
            curl={`curl "${BASE}/series/1/fills?strategy_name=vwap_intra_day_2&date_from=2026-05-01&limit=10" \\
  -H "${HEADER}"`}
            python={`import requests\n\nresp = requests.get(\n    f"${BASE}/series/1/fills",\n    headers=HEADERS,\n    params={\"strategy_name\": \"vwap_intra_day_2\", \"date_from\": \"2026-05-01\", \"limit\": 10},\n)\nfills = resp.json()\nfor f in fills:\n    print(f\"{f['ts']} {f['side']} {f['qty']} @ {f['price']}\")`}
            javascript={`const resp = await fetch(\n  \`${BASE}/series/1/fills?strategy_name=vwap_intra_day_2&date_from=2026-05-01&limit=10\`,\n  { headers: DEFAULT_HEADERS }\n);\nconst fills = await resp.json();\nfills.forEach(f => console.log(\`\${f.ts} \${f.side} \${f.qty} @ \${f.price}\`));`}
          />

        {/* Reference */}
        <section id="reference" className="mb-12">
          <h2 className="mb-6 text-xl font-semibold text-primary font-mono">{t("reference.title")}</h2>

          <div className="overflow-x-auto rounded-lg border border-border-default">
            <table className="w-full text-sm">
              <thead className="border-b border-border-default bg-surface-2 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium text-primary">{t("reference.method")}</th>
                  <th className="px-4 py-3 font-medium text-primary">{t("reference.endpoint")}</th>
                  <th className="px-4 py-3 font-medium text-primary">{t("reference.auth")}</th>
                  <th className="px-4 py-3 font-medium text-primary">{t("reference.description")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {[
                  ["POST", "/v1/series", "API Key", t("endpoints.createSeries")],
                  ["GET", "/v1/series", "JWT / Key", t("endpoints.listSeries")],
                  ["GET", "/v1/series/{id}", "JWT / Key", t("endpoints.getSeries")],
                  ["GET", "/v1/series/{id}/validation-config", "JWT / Key", t("endpoints.getValidationConfig")],
                  ["GET", "/v1/series/{id}/fills", "JWT / Key", t("endpoints.getFills")],
                  ["PATCH", "/v1/series/{id}/validation-config", "JWT / Key", t("endpoints.updateValidationConfig")],
                  ["POST", "/v1/series/{id}/instruments", "API Key", t("endpoints.registerInstruments")],
                  ["POST", "/v1/series/{id}/fx-rates", "API Key", t("endpoints.postFxRates")],
                  ["GET", "/v1/series/{id}/fund-movements", "JWT / Key", t("endpoints.getFundMovements")],
                  ["POST", "/v1/series/{id}/fund-movements", "API Key", t("endpoints.postFundMovements")],
                  ["POST", "/v1/series/{id}/fills:batch", "API Key", t("endpoints.postFills")],
                  ["POST", "/v1/series/{id}/fills:void", "API Key", t("endpoints.voidFills")],
                  ["DELETE", "/v1/series/{id}/fills?strategy=...", "API Key", t("endpoints.deleteFillsByStrategy")],
                  ["GET", "/v1/series/{id}/metrics", "JWT / Key", t("endpoints.getMetrics")],
                  ["POST", "/v1/series/{id}/benchmark", "API Key", t("endpoints.postBenchmark")],
                  ["POST", "/v1/comparisons", "JWT / Key", t("endpoints.compare")],
                  ["POST", "/v1/auth/register", "None", t("endpoints.register")],
                  ["POST", "/v1/auth/login", "None", t("endpoints.login")],
                  ["POST", "/v1/auth/refresh", "Refresh", t("endpoints.refresh")],
                  ["GET", "/v1/auth/me", "JWT", t("endpoints.getMe")],
                  ["POST", "/v1/series/{id}/shares", "JWT / Key", t("endpoints.createShare")],
                  ["GET", "/v1/series/{id}/shares", "JWT / Key", t("endpoints.listShares")],
                  ["DELETE", "/v1/series/{id}/shares/{linkId}", "JWT / Key", t("endpoints.revokeShare")],
                  ["GET", "/v1/public/share/{token}", "None", t("endpoints.viewShared")],
                  ["POST", "/v1/api-keys", "JWT", t("endpoints.createApiKey")],
                  ["GET", "/v1/api-keys", "JWT", t("endpoints.listApiKeys")],
                  ["DELETE", "/v1/api-keys/{id}", "JWT", t("endpoints.revokeApiKey")],
                  ["GET", "/v1/health", "None", t("endpoints.health")],
                ].map(([method, path, auth, desc]) => (
                  <tr key={`${method}-${path}`} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${method === "POST" ? "bg-amber-500/20 text-amber-400" : method === "DELETE" ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"}`}>
                        {method}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[13px]">{path}</td>
                    <td className="px-4 py-2.5 text-[12px] text-muted">{auth}</td>
                    <td className="px-4 py-2.5 text-secondary">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Footer */}
        <footer className="mt-16 border-t border-border-default pt-6 text-center text-xs text-muted">
          <p>
            {t("footer.platform")} &middot;{" "}
            <Link to="/login" className="text-accent hover:underline">{t("footer.signIn")}</Link>{" "}
            &middot;{" "}
            <Link to="/register" className="text-accent hover:underline">{t("footer.register")}</Link>
          </p>
        </footer>
      </main>
    </div>
  );
}
