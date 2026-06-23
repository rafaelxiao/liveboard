# LiveBoard Phase 6 — Frontend Shell & Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the React 18 + TypeScript + Vite frontend shell for LiveBoard — design-token theming (dark default + light; P/L color scheme red-up default), an error-normalized API client that attaches the JWT, a token store with silent refresh on 401, auth context + route guards (`RequireAuth`/`RequireAdmin`), the authenticated app shell (sidebar/topbar + theme & P/L toggles), and the auth/api-key/admin pages (Login with 403 awaiting-approval handling, Register → pending confirmation, AwaitingApproval, ApiKeys with copy-once modal, AdminUsers approve/reject) — so Phases 7–8 can drop the Dashboard and Comparison pages into a fully-wired, guarded, themeable shell.

**Architecture:** A `frontend/` package root (separate toolchain from `backend/`). The SPA boots in `main.tsx` (QueryClientProvider + BrowserRouter + AuthProvider), renders `App.tsx` (the routed outlet), and resolves routes in `routes.tsx` (public / protected / admin). All HTTP goes through `api/client.ts`, which prefixes `VITE_API_BASE_URL` (default `/api`, proxied to `:8000` in dev), serializes JSON, normalizes errors into a typed `ApiError`, attaches the access token, and on a `401` performs a single silent refresh then retries. Auth/session/theme/pnl-scheme live in Zustand stores (persisted to `localStorage`); `AuthContext` exposes `login`/`logout`/`user` over the auth store. The frontend performs **no financial computation** — these pages never touch metrics; they only fetch auth/api-key/admin resources, render states, format display strings, and apply presentation preferences (theme, P/L scheme). Tailwind's theme maps the UX §1 design tokens to CSS variables so a `data-theme`/`data-pnl` attribute on `<html>` flips the whole app. Tests are Vitest + React Testing Library; MSW (or fetch mocks) simulate the backend responses (201/403/401/204) so guards, state transitions, and the copy-once modal are asserted without a live server.

**Tech Stack:** Node ≥20, React ^18, TypeScript ^5, Vite ^5, @tanstack/react-query ^5, zustand ^4, react-router-dom ^6, tailwindcss ^3, Radix UI primitives (`@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@radix-ui/react-toast`, `@radix-ui/react-tooltip`), lucide-react, Vitest ^1, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom, jsdom, msw. Fonts: Fira Sans (UI) + Fira Code (numeric). Backend contract: design §8 (auth/api-key/admin endpoints).

## Global Constraints

- All money/qty are `Decimal` → `NUMERIC(28,10)`; rates `NUMERIC(28,12)`; JSON numbers serialized as **strings**; every metric field carries a `units` entry.
- All `ts` are ISO-8601 **UTC** (reject naive/non-UTC); trade date derived in series `session_tz`.
- **No financial computation in the frontend.** If a number is shown, the backend produced it. Responses carry data + metadata only (no colors, no formatted strings, no UI labels).
- Business logic only in `app/services/*` (framework-free, callable without HTTP); routers parse → call one service → serialize.
- TDD: each unit of logic gets a failing test first; frequent commits; `ruff` + `pytest` green before a phase gate.
- Per-user data isolation everywhere; voided rows excluded from all computation.

---

## File Structure

Every file this phase creates or modifies (all paths relative to the repo root `LiveBoard/`):

| File | Responsibility |
|------|----------------|
| `frontend/package.json` | Scripts (`dev`/`build`/`preview`/`lint`/`test`) + React/Vite/Tailwind/Query/Zustand/Radix/Vitest deps |
| `frontend/vite.config.ts` | Vite + React plugin, dev proxy `/api → http://localhost:8000`, Vitest config (jsdom, setup file) |
| `frontend/tsconfig.json` | TS compiler options (strict, path alias `@/*`) |
| `frontend/tsconfig.node.json` | TS config for `vite.config.ts` |
| `frontend/tailwind.config.ts` | Tailwind theme: design tokens (dark/light) + P/L semantic tokens mapped to CSS variables; Fira fonts; radii |
| `frontend/postcss.config.js` | PostCSS pipeline (tailwind + autoprefixer) |
| `frontend/index.html` | SPA entry; Fira font `<link>`; `<html data-theme>` bootstrap script |
| `frontend/.env.example` | `VITE_API_BASE_URL` (defaults to `/api` via proxy) |
| `frontend/.eslintrc.cjs` | ESLint (react-hooks, ts) config |
| `frontend/src/main.tsx` | React root: QueryClientProvider + BrowserRouter + AuthProvider + ToastProvider |
| `frontend/src/App.tsx` | Top-level routed outlet (delegates to `routes.tsx`) |
| `frontend/src/routes.tsx` | Route table: public (`/login`,`/register`), pending (`/awaiting-approval`), protected, admin |
| `frontend/src/index.css` | Tailwind layers + CSS-variable token definitions for `[data-theme]` and `[data-pnl]` |
| `frontend/src/lib/types.ts` | Shared TS types mirroring backend auth/api-key/admin schemas + `ApiError` |
| `frontend/src/lib/format.ts` | Display formatting: relative/absolute dates, prefix masking (no financial math) |
| `frontend/src/lib/test-utils.tsx` | RTL `renderWithProviders` (router + query client + auth) + MSW handlers helper |
| `frontend/src/test/setup.ts` | Vitest setup: jest-dom matchers, MSW server lifecycle, `matchMedia`/`clipboard` mocks |
| `frontend/src/api/client.ts` | fetch wrapper: base URL, JSON, error normalization, JWT attach, 401 silent-refresh-retry |
| `frontend/src/api/auth.ts` | `register`/`login`/`refresh`/`me` calls |
| `frontend/src/api/apiKeys.ts` | `createApiKey`/`listApiKeys`/`revokeApiKey` |
| `frontend/src/api/admin.ts` | `listUsers`/`approveUser`/`rejectUser` |
| `frontend/src/auth/tokenStore.ts` | Zustand store: access+refresh persistence + `silentRefresh` + subscribe |
| `frontend/src/auth/authStore.ts` | Zustand store: current user + status; derived `isAuthed`/`isAdmin`/`isApproved` |
| `frontend/src/auth/AuthContext.tsx` | Provider exposing `user`/`login`/`logout`/`refreshMe` over the stores |
| `frontend/src/auth/RequireAuth.tsx` | Guard: redirect unauthed → `/login?next=`; pending → `/awaiting-approval` |
| `frontend/src/auth/RequireAdmin.tsx` | Guard: redirect non-admin → `/series` (403) |
| `frontend/src/state/themeStore.ts` | Zustand store: `theme` (dark/light) persisted; applies `data-theme` to `<html>` |
| `frontend/src/state/pnlStore.ts` | Zustand store: `pnl_color_scheme` (red-up default) persisted; applies `data-pnl` |
| `frontend/src/components/AppShell.tsx` | Authenticated layout: `<Sidebar>` + `<Topbar>` + `<Outlet>` |
| `frontend/src/components/Sidebar.tsx` | Left nav (Series/Dashboard/Compare/API Keys/Admin*); admin item role-gated; collapse |
| `frontend/src/components/Topbar.tsx` | Slim top bar: hamburger, page title, ThemeToggle, user menu (RoleChip + P/L toggle + Logout) |
| `frontend/src/components/AuthShell.tsx` | Centered single-column card layout for Login/Register/AwaitingApproval |
| `frontend/src/components/ThemeToggle.tsx` | Dark/light switch wired to `themeStore` |
| `frontend/src/components/PnlColorToggle.tsx` | red-up/green-up switch wired to `pnlStore` |
| `frontend/src/components/RoleChip.tsx` | `USER`/`ADMIN` chip |
| `frontend/src/components/StatusChip.tsx` | `pending`/`approved`/`rejected` chip (neutral/amber/emerald/rose dot) |
| `frontend/src/components/AlertBanner.tsx` | `role="alert"` error/success banner + optional Retry |
| `frontend/src/components/Toast.tsx` | Radix-toast provider + `useToast()` hook for transient success |
| `frontend/src/components/EmptyState.tsx` | Reusable icon + message + CTA |
| `frontend/src/components/CopyButton.tsx` | Clipboard copy with "Copied ✓" feedback |
| `frontend/src/components/ConfirmPopover.tsx` | Radix-popover inline confirm for destructive actions (revoke/reject) |
| `frontend/src/components/ApiKeyCreatedModal.tsx` | Copy-once full-key Radix dialog with dismissal guard |
| `frontend/src/pages/LoginPage.tsx` | Login form; 401 wrong-creds + 403 awaiting-approval/rejected handling; success → `/series` |
| `frontend/src/pages/RegisterPage.tsx` | Register form; 201 → pending-confirmation panel (not Dashboard); 409 email-exists |
| `frontend/src/pages/AwaitingApprovalPage.tsx` | Pending-state page; Check status (`/auth/me`) + Logout |
| `frontend/src/pages/ApiKeysPage.tsx` | Keys table (name/prefix/last_used/created) + create + revoke; copy-once modal; approved-only |
| `frontend/src/pages/AdminUsersPage.tsx` | Users table; approve/reject; live update |

> **Note on ordering vs Phases 7–8.** This plan deliberately omits `pages/SeriesListPage`, `pages/SeriesDetailPage`, `pages/DashboardPage`, `pages/ComparisonPage`, the chart/metric components, and `state/useSeries|useMetrics|useComparison`. `routes.tsx` registers `/series` as the post-login landing with a **placeholder** `SeriesListPlaceholder` so the guards and redirects are testable now; Phase 7 replaces the placeholder with the real page. `api/series.ts`, `api/metrics.ts`, `api/comparison.ts` are also Phase 7/8.

---

## Tasks

> Work from `frontend/`. All `npm` and `npx vitest` commands run **from `frontend/`** unless a path says otherwise. The backend (design §8) is the contract; tests mock it with MSW. Reusable atoms (`AlertBanner`, `Toast`, `EmptyState`, `CopyButton`, `ConfirmPopover`, `RoleChip`, `StatusChip`) are introduced folded into the first task that needs them, then reused.

---

### Task 1: Vite + TS + Tailwind + Vitest bootstrap (config, tokens, fonts, trivial render test)

**Files:**
- Create: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/tailwind.config.ts`, `frontend/postcss.config.js`, `frontend/.eslintrc.cjs`, `frontend/.env.example`
- Create: `frontend/index.html`, `frontend/src/index.css`, `frontend/src/main.tsx`, `frontend/src/App.tsx`
- Create: `frontend/src/test/setup.ts`
- Create: `frontend/src/lib/test-utils.tsx`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - An installable Vite/React/TS project named `liveboard-frontend` with the dependency set every later task uses, and `npm run test` wired to Vitest (jsdom + setup file).
  - The Tailwind token theme: CSS variables for dark (default) + light themes and the P/L semantic tokens (`pnl-gain`/`pnl-loss`) resolved from a `[data-pnl]` attribute, mapped into `tailwind.config.ts` `theme.extend.colors` so classes like `bg-app`, `text-primary`, `text-pnl-gain` exist.
  - `renderWithProviders(ui, {route})` in `lib/test-utils.tsx` — wraps a component in a fresh `QueryClientProvider` + `MemoryRouter`; every later test imports it.
  - The MSW `server` + a `setHandlers` helper exported from `test/setup.ts` for per-test API mocking.

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/App.test.tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import App from "./App";
import { renderWithProviders } from "./lib/test-utils";

describe("App bootstrap", () => {
  it("renders the LiveBoard brand wordmark", () => {
    renderWithProviders(<App />, { route: "/login" });
    expect(screen.getByText(/LiveBoard/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/App.test.tsx`
Expected: FAIL — before `package.json`/deps exist, `npm` cannot resolve the `test` script / Vitest; after deps install but before `App.tsx` exists, it fails with "Failed to resolve import './App'".

- [ ] **Step 3: Write minimal implementation**

`frontend/package.json`:
```json
{
  "name": "liveboard-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@radix-ui/react-dialog": "^1.0.5",
    "@radix-ui/react-popover": "^1.0.7",
    "@radix-ui/react-toast": "^1.1.5",
    "@radix-ui/react-tooltip": "^1.0.7",
    "@tanstack/react-query": "^5.0.0",
    "lucide-react": "^0.400.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.22.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^14.2.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "eslint": "^8.57.0",
    "eslint-plugin-react-hooks": "^4.6.0",
    "eslint-plugin-react-refresh": "^0.4.5",
    "jsdom": "^24.0.0",
    "msw": "^2.2.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0",
    "vite": "^5.1.0",
    "vitest": "^1.4.0"
  }
}
```

`frontend/vite.config.ts`:
```ts
/// <reference types="vitest" />
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
  },
});
```

`frontend/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": { "@/*": ["src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`frontend/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

`frontend/postcss.config.js`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

`frontend/tailwind.config.ts` — tokens reference CSS variables (defined in `index.css`) so `[data-theme]`/`[data-pnl]` flips them at runtime (UX §1.2):
```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "rgb(var(--bg-app) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--bg-surface-2) / <alpha-value>)",
        "surface-3": "rgb(var(--bg-surface-3) / <alpha-value>)",
        "border-subtle": "rgb(var(--border-subtle) / <alpha-value>)",
        "border-default": "rgb(var(--border-default) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        primary: "rgb(var(--text-primary) / <alpha-value>)",
        secondary: "rgb(var(--text-secondary) / <alpha-value>)",
        muted: "rgb(var(--text-muted) / <alpha-value>)",
        disabled: "rgb(var(--text-disabled) / <alpha-value>)",
        accent: "rgb(var(--accent-primary) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-primary-hover) / <alpha-value>)",
        // P/L semantic tokens — resolved from [data-pnl] scheme (UX §1.2)
        "pnl-gain": "rgb(var(--pnl-gain) / <alpha-value>)",
        "pnl-loss": "rgb(var(--pnl-loss) / <alpha-value>)",
        "pnl-neutral": "rgb(var(--pnl-neutral) / <alpha-value>)",
        // hue-FIXED UI status (never follow pnl scheme — UX §1.2 critical #2)
        "success-ui": "rgb(var(--success-ui) / <alpha-value>)",
        "danger-ui": "rgb(var(--danger-ui) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["'Fira Sans'", "system-ui", "sans-serif"],
        mono: ["'Fira Code'", "ui-monospace", "monospace"],
      },
      borderRadius: { sm: "6px", md: "8px", lg: "12px" },
      ringColor: { focus: "rgb(var(--focus-ring))" },
    },
  },
  plugins: [],
};

export default config;
```

`frontend/src/index.css` — token values per UX §1.2 (dark default; light under `[data-theme="light"]`; P/L hues swapped by `[data-pnl]`):
```css
@import url("https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap");
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Physical hues (UX §1.2) */
:root {
  --hue-red: 244 63 94;      /* #F43F5E rose-500 */
  --hue-green: 16 185 129;   /* #10B981 emerald-500 */
}

/* Dark mode (default) */
:root,
[data-theme="dark"] {
  --bg-app: 11 17 32;          /* #0B1120 */
  --bg-surface: 15 23 42;      /* #0F172A */
  --bg-surface-2: 30 41 59;    /* #1E293B */
  --bg-surface-3: 39 52 73;    /* #273449 */
  --border-subtle: 30 41 59;
  --border-default: 51 65 85;  /* #334155 */
  --border-strong: 71 85 105;  /* #475569 */
  --text-primary: 248 250 252; /* #F8FAFC */
  --text-secondary: 203 213 225;
  --text-muted: 148 163 184;   /* #94A3B8 */
  --text-disabled: 100 116 139;
  --accent-primary: 59 130 246;     /* #3B82F6 */
  --accent-primary-hover: 96 165 250;
  --focus-ring: 147 197 253;        /* #93C5FD */
  --pnl-neutral: 148 163 184;
  --success-ui: 16 185 129;   /* fixed emerald */
  --danger-ui: 244 63 94;     /* fixed rose */
  --warning: 245 158 11;
  --info: 56 189 248;
}

/* Light mode */
[data-theme="light"] {
  --bg-app: 248 250 252;
  --bg-surface: 255 255 255;
  --bg-surface-2: 241 245 249;
  --bg-surface-3: 226 232 240;
  --border-subtle: 226 232 240;
  --border-default: 226 232 240;
  --border-strong: 203 213 225;
  --text-primary: 15 23 42;
  --text-secondary: 51 65 85;
  --text-muted: 71 85 105;
  --text-disabled: 148 163 184;
  --accent-primary: 37 99 235;
  --accent-primary-hover: 59 130 246;
  --pnl-neutral: 100 116 139;
  --hue-red: 225 29 72;     /* #E11D48 */
  --hue-green: 5 150 105;   /* #059669 */
  --success-ui: 5 150 105;
  --danger-ui: 225 29 72;
  --warning: 217 119 6;
  --info: 2 132 199;
}

/* P/L scheme resolution (UX §1.2): red-up DEFAULT, green-up alternative.
   Semantic gain/loss map onto physical hues, flipped by the scheme. */
:root,
[data-pnl="red-up"] {
  --pnl-gain: var(--hue-red);
  --pnl-loss: var(--hue-green);
}
[data-pnl="green-up"] {
  --pnl-gain: var(--hue-green);
  --pnl-loss: var(--hue-red);
}

body {
  @apply bg-app text-secondary font-sans antialiased;
}
```

`frontend/index.html` — pre-paint theme/pnl bootstrap to avoid a flash (defaults: dark unless prefers-light; pnl red-up):
```html
<!doctype html>
<html lang="en" data-theme="dark" data-pnl="red-up">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LiveBoard</title>
    <script>
      (function () {
        try {
          var t = localStorage.getItem("lb_theme");
          if (!t) {
            t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
          }
          document.documentElement.setAttribute("data-theme", t);
          var p = localStorage.getItem("lb_pnl_color_scheme") || "red-up";
          document.documentElement.setAttribute("data-pnl", p);
        } catch (e) {}
      })();
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/.env.example`:
```dotenv
# API base; defaults to /api (Vite dev proxy forwards to http://localhost:8000)
VITE_API_BASE_URL=/api
```

`frontend/.eslintrc.cjs`:
```cjs
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh"],
  rules: {
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  },
};
```

`frontend/src/App.tsx` (minimal for Task 1; Task 5 replaces the body with `<AppRoutes/>`):
```tsx
export default function App() {
  return (
    <div className="min-h-screen bg-app text-secondary">
      <span className="font-sans text-lg font-semibold text-primary">LiveBoard</span>
    </div>
  );
}
```

`frontend/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

`frontend/src/test/setup.ts` — jest-dom + MSW lifecycle + jsdom shims (`matchMedia`, `clipboard`) that the shell and copy-button rely on:
```ts
import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { setupServer } from "msw/node";

// Empty by default; each test installs handlers via server.use(...).
export const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// jsdom lacks matchMedia (theme bootstrap) — provide a stub.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// jsdom clipboard stub (CopyButton / ApiKeyCreatedModal).
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});
```

`frontend/src/lib/test-utils.tsx` — the shared render helper every later test uses:
```tsx
import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

interface RenderOptions {
  route?: string;
  wrapper?: (children: ReactNode) => ReactElement;
}

export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}) {
  const { route = "/", wrapper } = options;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const inner = wrapper ? wrapper(ui) : ui;
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{inner}</MemoryRouter>
    </QueryClientProvider>,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm install && npm run test -- src/App.test.tsx`
Expected: PASS — 1 test passes (the brand wordmark renders). Then `cd frontend && npm run build` compiles (`tsc -b && vite build`) with no type errors, and `npm run lint` reports no errors.

- [ ] **Step 5: Commit**
```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.node.json frontend/tailwind.config.ts frontend/postcss.config.js frontend/.eslintrc.cjs frontend/.env.example frontend/index.html frontend/src/index.css frontend/src/main.tsx frontend/src/App.tsx frontend/src/test/setup.ts frontend/src/lib/test-utils.tsx frontend/src/App.test.tsx
git commit -m "P6: Vite+TS+Tailwind+Vitest bootstrap — design tokens (dark/light + P/L red-up), Fira fonts, test harness"
```

---

### Task 2: `api/client.ts` — error-normalized fetch + JWT attach (+ `lib/types.ts`)

**Files:**
- Create: `frontend/src/lib/types.ts`
- Create: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Consumes: `import.meta.env.VITE_API_BASE_URL` (default `/api`); a pluggable token getter + a `onUnauthorized` callback (wired to `tokenStore` in Task 3) so the client has no hard dependency on the store (keeps it unit-testable).
- Produces:
  - `lib/types.ts`: `UserOut` (`{id, email, role: "user"|"admin", status: "pending"|"approved"|"rejected", created_at}`), `TokenPair` (`{access_token, refresh_token}`), `AccessToken` (`{access_token}`), `ApiKeyOut` (`{id, name, prefix, last_used_at, created_at}`), `ApiKeyCreatedOut` (`{id, name, key}`), `AdminUserOut` (= `UserOut`), and `ApiError` class (`{status, code, message, details}`).
  - `api/client.ts`: `apiFetch<T>(path, init?) -> Promise<T>` (JSON in/out, attaches `Authorization: Bearer`, normalizes non-2xx into a thrown `ApiError`, parses the backend `{error:{code,message,details}}` envelope), plus `configureClient({getAccessToken, refreshAndRetry})` so Task 3 injects the token source + silent-refresh hook. Mirrors backend error codes from Phase 0 `core/errors.py` (401 `unauthorized`, 403 `forbidden`, 404 `not_found`, 409 `conflict`, 413 `payload_too_large`, 422 `validation_error`).

- [ ] **Step 1: Write the failing test**
```ts
// frontend/src/api/client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../test/setup";
import { ApiError } from "../lib/types";
import { apiFetch, configureClient } from "./client";

const BASE = "/api";

describe("apiFetch", () => {
  beforeEach(() => {
    configureClient({ getAccessToken: () => null, refreshAndRetry: async () => false });
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns parsed JSON on 200", async () => {
    server.use(
      http.get(`${BASE}/auth/me`, () =>
        HttpResponse.json({ id: 1, email: "a@b.c", role: "user", status: "approved", created_at: "x" }),
      ),
    );
    const user = await apiFetch<{ email: string }>("/auth/me");
    expect(user.email).toBe("a@b.c");
  });

  it("attaches the access token as a Bearer header", async () => {
    let seen: string | null = null;
    server.use(
      http.get(`${BASE}/auth/me`, ({ request }) => {
        seen = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );
    configureClient({ getAccessToken: () => "tok-123", refreshAndRetry: async () => false });
    await apiFetch("/auth/me");
    expect(seen).toBe("Bearer tok-123");
  });

  it("normalizes a backend error envelope into a thrown ApiError", async () => {
    server.use(
      http.post(`${BASE}/auth/login`, () =>
        HttpResponse.json(
          { error: { code: "forbidden", message: "awaiting approval", details: null } },
          { status: 403 },
        ),
      ),
    );
    await expect(apiFetch("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 403,
      code: "forbidden",
      message: "awaiting approval",
    });
    await expect(apiFetch("/auth/login", { method: "POST", body: {} })).rejects.toBeInstanceOf(ApiError);
  });

  it("on 401 calls refreshAndRetry once and retries the original request", async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/api-keys`, ({ request }) => {
        calls += 1;
        if (request.headers.get("authorization") === "Bearer new-token") {
          return HttpResponse.json([{ id: 1, name: "k", prefix: "lb_x", last_used_at: null, created_at: "x" }]);
        }
        return HttpResponse.json({ error: { code: "unauthorized", message: "expired" } }, { status: 401 });
      }),
    );
    let token = "old-token";
    const refreshAndRetry = vi.fn(async () => {
      token = "new-token";
      return true;
    });
    configureClient({ getAccessToken: () => token, refreshAndRetry });
    const keys = await apiFetch<unknown[]>("/api-keys");
    expect(refreshAndRetry).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(keys).toHaveLength(1);
  });

  it("on 401 when refresh fails, throws the 401 ApiError without infinite retry", async () => {
    server.use(
      http.get(`${BASE}/api-keys`, () =>
        HttpResponse.json({ error: { code: "unauthorized", message: "expired" } }, { status: 401 }),
      ),
    );
    const refreshAndRetry = vi.fn(async () => false);
    configureClient({ getAccessToken: () => "old", refreshAndRetry });
    await expect(apiFetch("/api-keys")).rejects.toMatchObject({ status: 401 });
    expect(refreshAndRetry).toHaveBeenCalledTimes(1);
  });

  it("resolves to undefined on 204 No Content", async () => {
    server.use(http.delete(`${BASE}/api-keys/1`, () => new HttpResponse(null, { status: 204 })));
    await expect(apiFetch("/api-keys/1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/api/client.test.ts`
Expected: FAIL with "Failed to resolve import './client'" (and `../lib/types`).

- [ ] **Step 3: Write minimal implementation**

`frontend/src/lib/types.ts`:
```ts
export type UserStatus = "pending" | "approved" | "rejected";
export type UserRole = "user" | "admin";

export interface UserOut {
  id: number;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
}

export interface AccessToken {
  access_token: string;
}

export interface ApiKeyOut {
  id: number;
  name: string;
  prefix: string;
  last_used_at: string | null;
  created_at: string;
}

export interface ApiKeyCreatedOut {
  id: number;
  name: string;
  key: string; // full key — shown ONCE
}

export type AdminUserOut = UserOut;

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
```

`frontend/src/api/client.ts`:
```ts
import { ApiError } from "../lib/types";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

interface ClientConfig {
  getAccessToken: () => string | null;
  // Returns true if a refresh succeeded and the request should be retried.
  refreshAndRetry: () => Promise<boolean>;
}

let config: ClientConfig = {
  getAccessToken: () => null,
  refreshAndRetry: async () => false,
};

export function configureClient(next: ClientConfig): void {
  config = next;
}

interface FetchInit extends Omit<RequestInit, "body"> {
  body?: unknown;
}

async function doFetch(path: string, init: FetchInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const token = config.getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let body: BodyInit | undefined;
  if (init.body !== undefined && init.body !== null) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.body);
  }

  return fetch(`${BASE_URL}${path}`, { ...init, headers, body });
}

async function toError(res: Response): Promise<ApiError> {
  let code = "http_error";
  let message = res.statusText || "Request failed";
  let details: unknown = null;
  try {
    const data = await res.json();
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details ?? null;
    }
  } catch {
    // non-JSON body — keep defaults
  }
  return new ApiError(res.status, code, message, details);
}

export async function apiFetch<T = unknown>(path: string, init: FetchInit = {}): Promise<T> {
  let res = await doFetch(path, init);

  if (res.status === 401) {
    const refreshed = await config.refreshAndRetry();
    if (refreshed) {
      res = await doFetch(path, init);
    }
  }

  if (!res.ok) {
    throw await toError(res);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as T;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/api/client.test.ts`
Expected: PASS — 6 tests pass (JSON parse, Bearer attach, error normalization, single silent-refresh-then-retry, no infinite retry on refresh failure, 204 → undefined).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "P6: api/client.ts — JSON fetch, JWT attach, error normalization, 401 silent-refresh-retry + lib/types"
```

---

### Task 3: Zustand auth store + `tokenStore` (persist + silent refresh) + `api/auth.ts`

**Files:**
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/auth/tokenStore.ts`
- Create: `frontend/src/auth/authStore.ts`
- Test: `frontend/src/auth/tokenStore.test.ts`, `frontend/src/auth/authStore.test.ts`

**Interfaces:**
- Consumes: `apiFetch`/`configureClient` (Task 2), `api/auth.ts` (`refresh`), backend §8 (`POST /auth/refresh {refresh_token} → {access_token}`).
- Produces:
  - `api/auth.ts`: `register(email,password) -> Promise<UserOut>` (`POST /auth/register`, 201), `login(email,password) -> Promise<TokenPair>` (`POST /auth/login`), `refresh(refresh_token) -> Promise<AccessToken>` (`POST /auth/refresh`), `me() -> Promise<UserOut>` (`GET /auth/me`).
  - `auth/tokenStore.ts`: Zustand store `useTokenStore` with `{accessToken, refreshToken, setTokens, clear, silentRefresh}`, persisted to `localStorage` (keys `lb_access`/`lb_refresh`). `silentRefresh()` calls `refresh(refreshToken)`; on success stores the new access token and returns `true`; on failure clears tokens and returns `false`. On module load it calls `configureClient({getAccessToken: () => get().accessToken, refreshAndRetry: () => get().silentRefresh()})` so the client (Task 2) is wired to the store. Consumed by `AuthContext` (Task 4) and guards.
  - `auth/authStore.ts`: Zustand store `useAuthStore` with `{user: UserOut | null, setUser, clear}` and selector helpers `selectIsAuthed`/`selectIsAdmin`/`selectIsApproved`. Persisted user is NOT trusted for auth — tokens are the source of truth; user is a cache for chrome (RoleChip/Topbar).

- [ ] **Step 1: Write the failing test**
```ts
// frontend/src/auth/tokenStore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";

import { server } from "../test/setup";
import { useTokenStore } from "./tokenStore";

describe("tokenStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useTokenStore.getState().clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("persists tokens to localStorage on setTokens", () => {
    useTokenStore.getState().setTokens({ access_token: "a1", refresh_token: "r1" });
    expect(useTokenStore.getState().accessToken).toBe("a1");
    expect(localStorage.getItem("lb_access")).toBe("a1");
    expect(localStorage.getItem("lb_refresh")).toBe("r1");
  });

  it("clear() removes tokens from state and storage", () => {
    useTokenStore.getState().setTokens({ access_token: "a1", refresh_token: "r1" });
    useTokenStore.getState().clear();
    expect(useTokenStore.getState().accessToken).toBeNull();
    expect(localStorage.getItem("lb_access")).toBeNull();
  });

  it("silentRefresh stores a new access token and returns true on success", async () => {
    server.use(
      http.post("/api/auth/refresh", async ({ request }) => {
        const body = (await request.json()) as { refresh_token: string };
        expect(body.refresh_token).toBe("r1");
        return HttpResponse.json({ access_token: "a2" });
      }),
    );
    useTokenStore.getState().setTokens({ access_token: "a1", refresh_token: "r1" });
    const ok = await useTokenStore.getState().silentRefresh();
    expect(ok).toBe(true);
    expect(useTokenStore.getState().accessToken).toBe("a2");
    expect(useTokenStore.getState().refreshToken).toBe("r1");
  });

  it("silentRefresh clears tokens and returns false when refresh fails (logout on refresh fail)", async () => {
    server.use(
      http.post("/api/auth/refresh", () =>
        HttpResponse.json({ error: { code: "unauthorized", message: "expired" } }, { status: 401 }),
      ),
    );
    useTokenStore.getState().setTokens({ access_token: "a1", refresh_token: "r1" });
    const ok = await useTokenStore.getState().silentRefresh();
    expect(ok).toBe(false);
    expect(useTokenStore.getState().accessToken).toBeNull();
    expect(useTokenStore.getState().refreshToken).toBeNull();
  });

  it("silentRefresh returns false immediately when there is no refresh token", async () => {
    const ok = await useTokenStore.getState().silentRefresh();
    expect(ok).toBe(false);
  });
});
```

```ts
// frontend/src/auth/authStore.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { selectIsAdmin, selectIsApproved, selectIsAuthed, useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";

describe("authStore selectors", () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useTokenStore.getState().clear();
  });

  it("isAuthed reflects presence of an access token", () => {
    expect(selectIsAuthed()).toBe(false);
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    expect(selectIsAuthed()).toBe(true);
  });

  it("isAdmin is true only for an admin user", () => {
    useAuthStore.getState().setUser({ id: 1, email: "a@b.c", role: "user", status: "approved", created_at: "x" });
    expect(selectIsAdmin()).toBe(false);
    useAuthStore.getState().setUser({ id: 2, email: "x@y.z", role: "admin", status: "approved", created_at: "x" });
    expect(selectIsAdmin()).toBe(true);
  });

  it("isApproved is true only when status is approved", () => {
    useAuthStore.getState().setUser({ id: 1, email: "a@b.c", role: "user", status: "pending", created_at: "x" });
    expect(selectIsApproved()).toBe(false);
    useAuthStore.getState().setUser({ id: 1, email: "a@b.c", role: "user", status: "approved", created_at: "x" });
    expect(selectIsApproved()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/auth/tokenStore.test.ts src/auth/authStore.test.ts`
Expected: FAIL — "Failed to resolve import './tokenStore'" / './authStore'.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/api/auth.ts`:
```ts
import type { AccessToken, TokenPair, UserOut } from "../lib/types";
import { apiFetch } from "./client";

export function register(email: string, password: string): Promise<UserOut> {
  return apiFetch<UserOut>("/auth/register", { method: "POST", body: { email, password } });
}

export function login(email: string, password: string): Promise<TokenPair> {
  return apiFetch<TokenPair>("/auth/login", { method: "POST", body: { email, password } });
}

export function refresh(refresh_token: string): Promise<AccessToken> {
  return apiFetch<AccessToken>("/auth/refresh", { method: "POST", body: { refresh_token } });
}

export function me(): Promise<UserOut> {
  return apiFetch<UserOut>("/auth/me");
}
```

`frontend/src/auth/tokenStore.ts`:
```ts
import { create } from "zustand";

import { refresh } from "../api/auth";
import { configureClient } from "../api/client";
import type { TokenPair } from "../lib/types";

interface TokenState {
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (tokens: TokenPair) => void;
  clear: () => void;
  silentRefresh: () => Promise<boolean>;
}

export const useTokenStore = create<TokenState>((set, get) => ({
  accessToken: localStorage.getItem("lb_access"),
  refreshToken: localStorage.getItem("lb_refresh"),

  setTokens: ({ access_token, refresh_token }) => {
    localStorage.setItem("lb_access", access_token);
    localStorage.setItem("lb_refresh", refresh_token);
    set({ accessToken: access_token, refreshToken: refresh_token });
  },

  clear: () => {
    localStorage.removeItem("lb_access");
    localStorage.removeItem("lb_refresh");
    set({ accessToken: null, refreshToken: null });
  },

  silentRefresh: async () => {
    const token = get().refreshToken;
    if (!token) return false;
    try {
      const { access_token } = await refresh(token);
      localStorage.setItem("lb_access", access_token);
      set({ accessToken: access_token });
      return true;
    } catch {
      get().clear();
      return false;
    }
  },
}));

// Wire the API client to read tokens + perform silent refresh on 401.
configureClient({
  getAccessToken: () => useTokenStore.getState().accessToken,
  refreshAndRetry: () => useTokenStore.getState().silentRefresh(),
});
```

`frontend/src/auth/authStore.ts`:
```ts
import { create } from "zustand";

import type { UserOut } from "../lib/types";
import { useTokenStore } from "./tokenStore";

interface AuthState {
  user: UserOut | null;
  setUser: (user: UserOut | null) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
  clear: () => set({ user: null }),
}));

export const selectIsAuthed = (): boolean => Boolean(useTokenStore.getState().accessToken);
export const selectIsAdmin = (): boolean => useAuthStore.getState().user?.role === "admin";
export const selectIsApproved = (): boolean => useAuthStore.getState().user?.status === "approved";
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/auth/tokenStore.test.ts src/auth/authStore.test.ts`
Expected: PASS — tokenStore (5) + authStore (3) tests pass. Silent refresh stores a new access token (I4); refresh failure clears tokens (logout-on-refresh-fail, I4).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/auth.ts frontend/src/auth/tokenStore.ts frontend/src/auth/authStore.ts frontend/src/auth/tokenStore.test.ts frontend/src/auth/authStore.test.ts
git commit -m "P6: tokenStore (persist + silent refresh) + authStore selectors + api/auth.ts"
```

---

### Task 4: `AuthContext` + `RequireAuth`/`RequireAdmin` guards

**Files:**
- Create: `frontend/src/auth/AuthContext.tsx`
- Create: `frontend/src/auth/RequireAuth.tsx`
- Create: `frontend/src/auth/RequireAdmin.tsx`
- Test: `frontend/src/auth/RequireAuth.test.tsx`, `frontend/src/auth/RequireAdmin.test.tsx`

**Interfaces:**
- Consumes: `useTokenStore`/`useAuthStore` (Task 3), `api/auth.ts` (`login`/`me`), `react-router-dom` (`Navigate`/`useLocation`/`Outlet`).
- Produces:
  - `AuthContext.tsx`: `AuthProvider` + `useAuth()` returning `{user, isAuthed, isAdmin, isApproved, login(email,password), logout(), refreshMe()}`. `login` calls `api/auth.login`, stores tokens, then `me()` to populate the user. `logout` clears both stores. `refreshMe` re-fetches `/auth/me` (used by AwaitingApprovalPage "Check status"). Reused by Topbar, LoginPage, AwaitingApprovalPage.
  - `RequireAuth.tsx`: a guard component wrapping protected routes — if not authed → `<Navigate to="/login?next={pathname}">`; if authed but user status `pending` → `<Navigate to="/awaiting-approval">`; else renders `<Outlet/>`. (acceptance J3 — pending users redirected away from approved-only pages.)
  - `RequireAdmin.tsx`: if not admin → `<Navigate to="/series" replace>` (403 redirect); else `<Outlet/>`. (acceptance K1.)

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/auth/RequireAuth.test.tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import { renderWithProviders } from "../lib/test-utils";
import { useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";
import RequireAuth from "./RequireAuth";

function Protected() {
  return <div>protected content</div>;
}
function LoginStub() {
  return <div>login page</div>;
}
function AwaitingStub() {
  return <div>awaiting approval page</div>;
}

function renderGuarded(route: string) {
  return renderWithProviders(
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="/api-keys" element={<Protected />} />
      </Route>
      <Route path="/login" element={<LoginStub />} />
      <Route path="/awaiting-approval" element={<AwaitingStub />} />
    </Routes>,
    { route },
  );
}

describe("RequireAuth", () => {
  beforeEach(() => {
    useTokenStore.getState().clear();
    useAuthStore.getState().clear();
  });

  it("redirects an unauthenticated user to /login", () => {
    renderGuarded("/api-keys");
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("redirects an authed-but-pending user to /awaiting-approval (J3)", () => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().setUser({ id: 1, email: "p@x.c", role: "user", status: "pending", created_at: "x" });
    renderGuarded("/api-keys");
    expect(screen.getByText("awaiting approval page")).toBeInTheDocument();
  });

  it("renders the protected outlet for an approved user", () => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().setUser({ id: 1, email: "ok@x.c", role: "user", status: "approved", created_at: "x" });
    renderGuarded("/api-keys");
    expect(screen.getByText("protected content")).toBeInTheDocument();
  });
});
```

```tsx
// frontend/src/auth/RequireAdmin.test.tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import { renderWithProviders } from "../lib/test-utils";
import { useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";
import RequireAdmin from "./RequireAdmin";

function AdminPage() {
  return <div>admin users page</div>;
}
function SeriesStub() {
  return <div>series landing</div>;
}

function renderGuarded() {
  return renderWithProviders(
    <Routes>
      <Route element={<RequireAdmin />}>
        <Route path="/admin/users" element={<AdminPage />} />
      </Route>
      <Route path="/series" element={<SeriesStub />} />
    </Routes>,
    { route: "/admin/users" },
  );
}

describe("RequireAdmin (K1)", () => {
  beforeEach(() => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().clear();
  });

  it("redirects a non-admin user away from the admin route", () => {
    useAuthStore.getState().setUser({ id: 1, email: "u@x.c", role: "user", status: "approved", created_at: "x" });
    renderGuarded();
    expect(screen.getByText("series landing")).toBeInTheDocument();
    expect(screen.queryByText("admin users page")).not.toBeInTheDocument();
  });

  it("renders the admin outlet for an admin user", () => {
    useAuthStore.getState().setUser({ id: 2, email: "a@x.c", role: "admin", status: "approved", created_at: "x" });
    renderGuarded();
    expect(screen.getByText("admin users page")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/auth/RequireAuth.test.tsx src/auth/RequireAdmin.test.tsx`
Expected: FAIL — "Failed to resolve import './RequireAuth'" / './RequireAdmin'.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/auth/AuthContext.tsx`:
```tsx
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { login as apiLogin, me as apiMe } from "../api/auth";
import type { UserOut } from "../lib/types";
import { useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";

interface AuthContextValue {
  user: UserOut | null;
  isAuthed: boolean;
  isAdmin: boolean;
  isApproved: boolean;
  login: (email: string, password: string) => Promise<UserOut>;
  logout: () => void;
  refreshMe: () => Promise<UserOut>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const accessToken = useTokenStore((s) => s.accessToken);
  const setTokens = useTokenStore((s) => s.setTokens);
  const clearTokens = useTokenStore((s) => s.clear);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await apiLogin(email, password);
      setTokens(tokens);
      const fetched = await apiMe();
      setUser(fetched);
      return fetched;
    },
    [setTokens, setUser],
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, [clearTokens, setUser]);

  const refreshMe = useCallback(async () => {
    const fetched = await apiMe();
    setUser(fetched);
    return fetched;
  }, [setUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthed: Boolean(accessToken),
      isAdmin: user?.role === "admin",
      isApproved: user?.status === "approved",
      login,
      logout,
      refreshMe,
    }),
    [user, accessToken, login, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
```

`frontend/src/auth/RequireAuth.tsx`:
```tsx
import { Navigate, Outlet, useLocation } from "react-router-dom";

import { useAuthStore } from "./authStore";
import { useTokenStore } from "./tokenStore";

export default function RequireAuth() {
  const location = useLocation();
  const accessToken = useTokenStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.user);

  if (!accessToken) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  }
  if (user?.status === "pending") {
    return <Navigate to="/awaiting-approval" replace />;
  }
  return <Outlet />;
}
```

`frontend/src/auth/RequireAdmin.tsx`:
```tsx
import { Navigate, Outlet } from "react-router-dom";

import { useAuthStore } from "./authStore";

export default function RequireAdmin() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== "admin") {
    return <Navigate to="/series" replace />;
  }
  return <Outlet />;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/auth/RequireAuth.test.tsx src/auth/RequireAdmin.test.tsx`
Expected: PASS — RequireAuth (3) + RequireAdmin (2). Unauthed→login, pending→awaiting (J3), approved→outlet; non-admin→/series, admin→outlet (K1).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/auth/AuthContext.tsx frontend/src/auth/RequireAuth.tsx frontend/src/auth/RequireAdmin.tsx frontend/src/auth/RequireAuth.test.tsx frontend/src/auth/RequireAdmin.test.tsx
git commit -m "P6: AuthContext + RequireAuth (pending->awaiting) + RequireAdmin (K1) guards"
```

---

### Task 5: `routes.tsx` + `AppShell`/`Sidebar`/`Topbar`/`AuthShell` (+ shell atoms)

**Files:**
- Create: `frontend/src/components/AppShell.tsx`, `frontend/src/components/Sidebar.tsx`, `frontend/src/components/Topbar.tsx`, `frontend/src/components/AuthShell.tsx`
- Create: `frontend/src/components/RoleChip.tsx`
- Modify: `frontend/src/App.tsx`, `frontend/src/main.tsx`
- Create: `frontend/src/routes.tsx`
- Test: `frontend/src/routes.test.tsx`, `frontend/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `useAuth` (Task 4), `RequireAuth`/`RequireAdmin` (Task 4), `react-router-dom` (`Routes`/`Route`/`Outlet`/`Navigate`/`NavLink`), lucide icons.
- Produces:
  - `routes.tsx`: `<AppRoutes/>` declaring the full route table (UX §2.2): public `/login`,`/register`; pending `/awaiting-approval`; `RequireAuth` group wrapping the `AppShell` layout route with children `/series` (placeholder landing), `/api-keys`, plus a nested `RequireAdmin` group for `/admin/users`; `*` → redirect to `/series`. Phases 7–8 add `/series/:id`,`/dashboard`,`/compare` as siblings under the same shell.
  - `AppShell.tsx`: `<div>` with `<Sidebar/>` + `<Topbar/>` + `<main><Outlet/></main>` using token classes (`bg-app`, `bg-surface`).
  - `Sidebar.tsx`: nav list (Series/Dashboard/Compare/API Keys + Admin only when `isAdmin`); active link styled with `accent` left-bar; collapse toggle. Reused as the persistent nav for all app pages.
  - `Topbar.tsx`: hamburger + page title + `ThemeToggle` (Task 6) + user menu (`RoleChip`, `PnlColorToggle` (Task 6), Logout). Logout calls `useAuth().logout()` then navigates to `/login`.
  - `AuthShell.tsx`: centered card layout for the public/pending pages (brand wordmark + `{children}`).
  - `RoleChip.tsx`: `<span>` rendering `USER`/`ADMIN`.
  - `main.tsx`: now wraps `<App/>` with `<AuthProvider>` (and Task 6's `<ToastProvider>`).

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/routes.test.tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import AppRoutes from "./routes";
import { AuthProvider } from "./auth/AuthContext";
import { useAuthStore } from "./auth/authStore";
import { useTokenStore } from "./auth/tokenStore";
import { renderWithProviders } from "./lib/test-utils";

function renderApp(route: string) {
  return renderWithProviders(
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>,
    { route },
  );
}

describe("AppRoutes", () => {
  beforeEach(() => {
    useTokenStore.getState().clear();
    useAuthStore.getState().clear();
  });

  it("shows the public login page at /login without auth", () => {
    renderApp("/login");
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("redirects an unauthenticated visit to /api-keys back to login", () => {
    renderApp("/api-keys");
    expect(screen.getByRole("heading", { name: /sign in/i })).toBeInTheDocument();
  });

  it("renders the app shell with sidebar nav for an approved user at /series", () => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().setUser({ id: 1, email: "ok@x.c", role: "user", status: "approved", created_at: "x" });
    renderApp("/series");
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /API Keys/i })).toBeInTheDocument();
  });
});
```

```tsx
// frontend/src/components/Sidebar.test.tsx
import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import Sidebar from "./Sidebar";
import { useAuthStore } from "../auth/authStore";
import { renderWithProviders } from "../lib/test-utils";

describe("Sidebar", () => {
  beforeEach(() => useAuthStore.getState().clear());

  it("hides the Admin nav item for a non-admin user", () => {
    useAuthStore.getState().setUser({ id: 1, email: "u@x.c", role: "user", status: "approved", created_at: "x" });
    renderWithProviders(<Sidebar />, { route: "/series" });
    expect(screen.queryByRole("link", { name: /Admin/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Series/i })).toBeInTheDocument();
  });

  it("shows the Admin nav item for an admin user", () => {
    useAuthStore.getState().setUser({ id: 2, email: "a@x.c", role: "admin", status: "approved", created_at: "x" });
    renderWithProviders(<Sidebar />, { route: "/series" });
    expect(screen.getByRole("link", { name: /Admin/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/routes.test.tsx src/components/Sidebar.test.tsx`
Expected: FAIL — "Failed to resolve import './routes'" / './Sidebar' (and the not-yet-built `LoginPage`/`ThemeToggle` imported by routes/Topbar; build those stubs minimally here or rely on Tasks 6–7 — keep this task's `routes.tsx` importing only what exists by using a `SeriesListPlaceholder` and inlined page stubs until Task 7 lands the real `LoginPage`).

> Implementation note: to keep Task 5 self-contained and green, `routes.tsx` may import lightweight local placeholders for pages not yet built (`LoginPlaceholder`, `ApiKeysPlaceholder`, etc.). Tasks 7–12 replace each placeholder import with the real page. The Login route placeholder must still render an `<h1>Sign in</h1>` so the route test passes; Task 7 swaps in the full `LoginPage`.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/components/RoleChip.tsx`:
```tsx
import type { UserRole } from "../lib/types";

export default function RoleChip({ role }: { role: UserRole }) {
  return (
    <span className="rounded-full border border-border-default px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted">
      {role}
    </span>
  );
}
```

`frontend/src/components/Sidebar.tsx`:
```tsx
import { NavLink } from "react-router-dom";
import { KeyRound, LayoutGrid, LineChart, Shield, GitCompare } from "lucide-react";

import { useAuthStore } from "../auth/authStore";

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm",
    isActive
      ? "border-l-[3px] border-accent bg-surface-3 text-primary"
      : "text-secondary hover:bg-surface-2",
  ].join(" ");

export default function Sidebar() {
  const isAdmin = useAuthStore((s) => s.user?.role === "admin");
  return (
    <nav aria-label="Primary" className="flex w-60 flex-col gap-1 bg-surface p-3">
      <span className="px-3 py-2 text-lg font-semibold text-primary">LiveBoard</span>
      <NavLink to="/series" className={navClass}>
        <LayoutGrid size={18} aria-hidden /> Series
      </NavLink>
      <NavLink to="/dashboard" className={navClass}>
        <LineChart size={18} aria-hidden /> Dashboard
      </NavLink>
      <NavLink to="/compare" className={navClass}>
        <GitCompare size={18} aria-hidden /> Compare
      </NavLink>
      <hr className="my-2 border-border-subtle" />
      <NavLink to="/api-keys" className={navClass}>
        <KeyRound size={18} aria-hidden /> API Keys
      </NavLink>
      {isAdmin && (
        <NavLink to="/admin/users" className={navClass}>
          <Shield size={18} aria-hidden /> Admin
        </NavLink>
      )}
    </nav>
  );
}
```

`frontend/src/components/Topbar.tsx`:
```tsx
import { useNavigate } from "react-router-dom";

import { useAuth } from "../auth/AuthContext";
import PnlColorToggle from "./PnlColorToggle";
import RoleChip from "./RoleChip";
import ThemeToggle from "./ThemeToggle";

export default function Topbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="flex h-14 items-center justify-between border-b border-border-default bg-surface px-4">
      <div className="text-sm text-muted">{/* breadcrumb / page title slot */}</div>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        <PnlColorToggle />
        {user && <RoleChip role={user.role} />}
        <span className="text-sm text-secondary">{user?.email}</span>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate("/login");
          }}
          className="rounded-md px-2 py-1 text-sm text-secondary hover:bg-surface-2"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
```

`frontend/src/components/AppShell.tsx`:
```tsx
import { Outlet } from "react-router-dom";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppShell() {
  return (
    <div className="flex min-h-screen bg-app">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <Topbar />
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

`frontend/src/components/AuthShell.tsx`:
```tsx
import type { ReactNode } from "react";

export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-4">
      <div className="w-full max-w-md rounded-lg border border-border-default bg-surface p-8">
        <h2 className="mb-6 text-center text-xl font-semibold text-primary">LiveBoard</h2>
        {children}
      </div>
    </div>
  );
}
```

`frontend/src/routes.tsx` — Task 5 wires placeholders; Tasks 7–12 swap real pages in:
```tsx
import { Navigate, Route, Routes } from "react-router-dom";

import RequireAdmin from "./auth/RequireAdmin";
import RequireAuth from "./auth/RequireAuth";
import AppShell from "./components/AppShell";
import AuthShell from "./components/AuthShell";

// Placeholders replaced by real pages in later tasks.
function LoginPlaceholder() {
  return (
    <AuthShell>
      <h1 className="text-lg font-semibold text-primary">Sign in</h1>
    </AuthShell>
  );
}
function SeriesListPlaceholder() {
  return <h1 className="text-xl font-semibold text-primary">Series</h1>;
}
function ApiKeysPlaceholder() {
  return <h1 className="text-xl font-semibold text-primary">API Keys</h1>;
}
function AdminUsersPlaceholder() {
  return <h1 className="text-xl font-semibold text-primary">User Approvals</h1>;
}
function RegisterPlaceholder() {
  return (
    <AuthShell>
      <h1 className="text-lg font-semibold text-primary">Create account</h1>
    </AuthShell>
  );
}
function AwaitingPlaceholder() {
  return (
    <AuthShell>
      <h1 className="text-lg font-semibold text-primary">Awaiting approval</h1>
    </AuthShell>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPlaceholder />} />
      <Route path="/register" element={<RegisterPlaceholder />} />
      <Route path="/awaiting-approval" element={<AwaitingPlaceholder />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/series" element={<SeriesListPlaceholder />} />
          <Route path="/api-keys" element={<ApiKeysPlaceholder />} />
          <Route element={<RequireAdmin />}>
            <Route path="/admin/users" element={<AdminUsersPlaceholder />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/series" replace />} />
    </Routes>
  );
}
```

`frontend/src/App.tsx` (replace Task 1 body):
```tsx
import AppRoutes from "./routes";

export default function App() {
  return <AppRoutes />;
}
```

`frontend/src/main.tsx` (add `AuthProvider`; `ToastProvider` added in Task 6):
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
```

> Because `Topbar` imports `ThemeToggle`/`PnlColorToggle` (Task 6), either build Task 6 first or temporarily stub those two components as no-op buttons in Task 5 and let Task 6 flesh them out. The plan order assumes you create the Task 6 toggles immediately after this task; if running strictly sequentially, add 1-line placeholder toggles here and replace in Task 6.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/routes.test.tsx src/components/Sidebar.test.tsx`
Expected: PASS — routes (3) + Sidebar (2). Public login reachable; unauthed `/api-keys` → login; approved user sees the shell nav incl. API Keys; Admin item hidden for users, shown for admins.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/routes.tsx frontend/src/App.tsx frontend/src/main.tsx frontend/src/components/AppShell.tsx frontend/src/components/Sidebar.tsx frontend/src/components/Topbar.tsx frontend/src/components/AuthShell.tsx frontend/src/components/RoleChip.tsx frontend/src/routes.test.tsx frontend/src/components/Sidebar.test.tsx
git commit -m "P6: routes.tsx (public/protected/admin) + AppShell/Sidebar/Topbar/AuthShell + RoleChip"
```

---

### Task 6: `ThemeToggle` + `PnlColorToggle` (persisted) + theme/pnl Zustand stores

**Files:**
- Create: `frontend/src/state/themeStore.ts`, `frontend/src/state/pnlStore.ts`
- Create: `frontend/src/components/ThemeToggle.tsx`, `frontend/src/components/PnlColorToggle.tsx`
- Test: `frontend/src/state/themeStore.test.ts`, `frontend/src/components/ThemeToggle.test.tsx`, `frontend/src/components/PnlColorToggle.test.tsx`

**Interfaces:**
- Consumes: `document.documentElement` (`data-theme`/`data-pnl`), `localStorage` (keys `lb_theme`/`lb_pnl_color_scheme` — must match the `index.html` bootstrap script), lucide (`Sun`/`Moon`).
- Produces:
  - `themeStore.ts`: `useThemeStore` `{theme: "dark"|"light", setTheme, toggle}`; every mutation writes `localStorage["lb_theme"]` and sets `<html data-theme>`. Initial value read from the attribute the bootstrap already applied.
  - `pnlStore.ts`: `usePnlStore` `{scheme: "red-up"|"green-up", setScheme, toggle}` (default `red-up`, UX §1.2); writes `localStorage["lb_pnl_color_scheme"]` and sets `<html data-pnl>`.
  - `ThemeToggle.tsx`: a button toggling theme; reused in Topbar.
  - `PnlColorToggle.tsx`: a control switching the P/L scheme; reused in the Topbar user menu. Both persist so a reload keeps the choice (acceptance gate: "theme + P/L toggles persist").

- [ ] **Step 1: Write the failing test**
```ts
// frontend/src/state/themeStore.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { usePnlStore } from "./pnlStore";
import { useThemeStore } from "./themeStore";

describe("themeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useThemeStore.setState({ theme: "dark" });
  });

  it("toggle flips dark<->light, persists, and sets the html attribute", () => {
    useThemeStore.getState().setTheme("dark");
    useThemeStore.getState().toggle();
    expect(useThemeStore.getState().theme).toBe("light");
    expect(localStorage.getItem("lb_theme")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

describe("pnlStore (default red-up)", () => {
  beforeEach(() => {
    localStorage.clear();
    usePnlStore.setState({ scheme: "red-up" });
  });

  it("defaults to red-up and toggle persists green-up", () => {
    expect(usePnlStore.getState().scheme).toBe("red-up");
    usePnlStore.getState().toggle();
    expect(usePnlStore.getState().scheme).toBe("green-up");
    expect(localStorage.getItem("lb_pnl_color_scheme")).toBe("green-up");
    expect(document.documentElement.getAttribute("data-pnl")).toBe("green-up");
  });
});
```

```tsx
// frontend/src/components/ThemeToggle.test.tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import ThemeToggle from "./ThemeToggle";
import { useThemeStore } from "../state/themeStore";
import { renderWithProviders } from "../lib/test-utils";

describe("ThemeToggle", () => {
  beforeEach(() => useThemeStore.setState({ theme: "dark" }));

  it("clicking toggles the theme and persists it", async () => {
    renderWithProviders(<ThemeToggle />);
    await userEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(useThemeStore.getState().theme).toBe("light");
    expect(localStorage.getItem("lb_theme")).toBe("light");
  });
});
```

```tsx
// frontend/src/components/PnlColorToggle.test.tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import PnlColorToggle from "./PnlColorToggle";
import { usePnlStore } from "../state/pnlStore";
import { renderWithProviders } from "../lib/test-utils";

describe("PnlColorToggle", () => {
  beforeEach(() => usePnlStore.setState({ scheme: "red-up" }));

  it("switches the P/L scheme and persists it", async () => {
    renderWithProviders(<PnlColorToggle />);
    await userEvent.click(screen.getByRole("button", { name: /P\/L colors/i }));
    expect(usePnlStore.getState().scheme).toBe("green-up");
    expect(localStorage.getItem("lb_pnl_color_scheme")).toBe("green-up");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/state/themeStore.test.ts src/components/ThemeToggle.test.tsx src/components/PnlColorToggle.test.tsx`
Expected: FAIL — "Failed to resolve import './themeStore'" / './pnlStore' / the toggle components.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/state/themeStore.ts`:
```ts
import { create } from "zustand";

export type Theme = "dark" | "light";

function readInitial(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" ? "light" : "dark";
}

function apply(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("lb_theme", theme);
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readInitial(),
  setTheme: (theme) => {
    apply(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
```

`frontend/src/state/pnlStore.ts`:
```ts
import { create } from "zustand";

export type PnlScheme = "red-up" | "green-up";

function readInitial(): PnlScheme {
  const attr = document.documentElement.getAttribute("data-pnl");
  return attr === "green-up" ? "green-up" : "red-up"; // red-up default (UX §1.2)
}

function apply(scheme: PnlScheme): void {
  document.documentElement.setAttribute("data-pnl", scheme);
  localStorage.setItem("lb_pnl_color_scheme", scheme);
}

interface PnlState {
  scheme: PnlScheme;
  setScheme: (scheme: PnlScheme) => void;
  toggle: () => void;
}

export const usePnlStore = create<PnlState>((set, get) => ({
  scheme: readInitial(),
  setScheme: (scheme) => {
    apply(scheme);
    set({ scheme });
  },
  toggle: () => get().setScheme(get().scheme === "red-up" ? "green-up" : "red-up"),
}));
```

`frontend/src/components/ThemeToggle.tsx`:
```tsx
import { Moon, Sun } from "lucide-react";

import { useThemeStore } from "../state/themeStore";

export default function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggle = useThemeStore((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch theme (current: ${theme})`}
      className="rounded-md p-2 text-secondary hover:bg-surface-2"
    >
      {theme === "dark" ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
    </button>
  );
}
```

`frontend/src/components/PnlColorToggle.tsx`:
```tsx
import { usePnlStore } from "../state/pnlStore";

export default function PnlColorToggle() {
  const scheme = usePnlStore((s) => s.scheme);
  const toggle = usePnlStore((s) => s.toggle);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`P/L colors (current: ${scheme})`}
      className="rounded-md px-2 py-1 text-xs text-secondary hover:bg-surface-2"
    >
      P/L: {scheme === "red-up" ? "Red ▲" : "Green ▲"}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/state/themeStore.test.ts src/components/ThemeToggle.test.tsx src/components/PnlColorToggle.test.tsx`
Expected: PASS — stores (2) + toggles (2). Theme flips & persists; P/L defaults red-up and persists green-up; `<html>` attributes update so the CSS-variable tokens recolor.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/state/themeStore.ts frontend/src/state/pnlStore.ts frontend/src/components/ThemeToggle.tsx frontend/src/components/PnlColorToggle.tsx frontend/src/state/themeStore.test.ts frontend/src/components/ThemeToggle.test.tsx frontend/src/components/PnlColorToggle.test.tsx
git commit -m "P6: ThemeToggle + PnlColorToggle (red-up default) + persisted theme/pnl Zustand stores"
```

---

### Task 7: `LoginPage` (+ 403 awaiting-approval handling) + `AlertBanner`

**Files:**
- Create: `frontend/src/pages/LoginPage.tsx`
- Create: `frontend/src/components/AlertBanner.tsx`
- Modify: `frontend/src/routes.tsx` (swap `LoginPlaceholder` → `LoginPage`)
- Test: `frontend/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth().login` (Task 4), `ApiError` (Task 2), backend `POST /auth/login` (200 `TokenPair`; 401 wrong creds; 403 pending/rejected — design §8 / acceptance A3/A4), `react-router-dom` (`useNavigate`/`useSearchParams`/`Link`).
- Produces:
  - `AlertBanner.tsx`: `role="alert"` element rendering `variant` (`error`/`success`) message + optional `onRetry`. Reused by ApiKeysPage/AdminUsersPage/AwaitingApprovalPage.
  - `LoginPage.tsx`: email/password form. On submit → `login()`; on success navigate to `?next=` or `/series` (I3). On `ApiError` 403 with awaiting/pending → render the dedicated "Your account is awaiting approval." copy + a link to `/awaiting-approval` (I2 — NOT a generic error); 403 rejected → the rejected copy; 401 → "Incorrect email or password."; button disabled while submitting & until both fields filled.

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/pages/LoginPage.test.tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";

import LoginPage from "./LoginPage";
import { server } from "../test/setup";
import { AuthProvider } from "../auth/AuthContext";
import { useAuthStore } from "../auth/authStore";
import { useTokenStore } from "../auth/tokenStore";
import { renderWithProviders } from "../lib/test-utils";

function renderLogin(route = "/login") {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/series" element={<div>series landing</div>} />
        <Route path="/awaiting-approval" element={<div>awaiting page</div>} />
      </Routes>
    </AuthProvider>,
    { route },
  );
}

async function fillAndSubmit() {
  await userEvent.type(screen.getByLabelText(/email/i), "u@x.c");
  await userEvent.type(screen.getByLabelText(/password/i), "pw");
  await userEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

describe("LoginPage", () => {
  beforeEach(() => {
    useTokenStore.getState().clear();
    useAuthStore.getState().clear();
  });

  it("captures a 403 and shows 'awaiting approval' (I2), not a generic error", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ error: { code: "forbidden", message: "awaiting approval" } }, { status: 403 }),
      ),
    );
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByText(/awaiting admin approval/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /awaiting/i })).toHaveAttribute("href", "/awaiting-approval");
  });

  it("shows 'incorrect email or password' on 401", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ error: { code: "unauthorized", message: "bad creds" } }, { status: 401 }),
      ),
    );
    renderLogin();
    await fillAndSubmit();
    expect(await screen.findByText(/incorrect email or password/i)).toBeInTheDocument();
  });

  it("stores tokens and redirects to /series on success (I3)", async () => {
    server.use(
      http.post("/api/auth/login", () =>
        HttpResponse.json({ access_token: "a1", refresh_token: "r1" }),
      ),
      http.get("/api/auth/me", () =>
        HttpResponse.json({ id: 1, email: "u@x.c", role: "user", status: "approved", created_at: "x" }),
      ),
    );
    renderLogin();
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByText("series landing")).toBeInTheDocument());
    expect(useTokenStore.getState().accessToken).toBe("a1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/pages/LoginPage.test.tsx`
Expected: FAIL — "Failed to resolve import './LoginPage'" (and `../components/AlertBanner`).

- [ ] **Step 3: Write minimal implementation**

`frontend/src/components/AlertBanner.tsx`:
```tsx
interface AlertBannerProps {
  variant?: "error" | "success";
  message: string;
  onRetry?: () => void;
  children?: React.ReactNode;
}

export default function AlertBanner({ variant = "error", message, onRetry, children }: AlertBannerProps) {
  const tone = variant === "error" ? "border-danger-ui text-danger-ui" : "border-success-ui text-success-ui";
  return (
    <div role="alert" aria-live="assertive" className={`rounded-md border ${tone} bg-surface-2 px-3 py-2 text-sm`}>
      <span>{message}</span>
      {children}
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 underline">
          Retry
        </button>
      )}
    </div>
  );
}
```

`frontend/src/pages/LoginPage.tsx`:
```tsx
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

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
      navigate(params.get("next") ?? "/series", { replace: true });
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
      <h1 className="mb-1 text-center text-lg font-semibold text-primary">Sign in</h1>
      <p className="mb-6 text-center text-sm text-muted">Sign in to your account</p>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            Email
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
            Password
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
            Your account is awaiting admin approval.{" "}
            <Link to="/awaiting-approval" className="underline">
              View awaiting status
            </Link>
          </div>
        )}
        {error?.kind === "rejected" && (
          <div role="alert" className="rounded-md border border-danger-ui bg-surface-2 px-3 py-2 text-sm text-danger-ui">
            This account isn&apos;t approved for access. Contact your administrator.
          </div>
        )}
        {error?.kind === "credentials" && (
          <div role="alert" className="rounded-md border border-danger-ui bg-surface-2 px-3 py-2 text-sm text-danger-ui">
            Incorrect email or password.
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
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        No account?{" "}
        <Link to="/register" className="text-accent underline">
          Register →
        </Link>
      </p>
    </AuthShell>
  );
}
```

Modify `routes.tsx`: replace the `LoginPlaceholder` import/usage with `import LoginPage from "./pages/LoginPage";` and `<Route path="/login" element={<LoginPage />} />`.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/pages/LoginPage.test.tsx src/routes.test.tsx`
Expected: PASS — LoginPage (3) + routes still green. 403 → awaiting-approval copy + link (I2); 401 → wrong-creds copy; success stores tokens & redirects to `/series` (I3).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/components/AlertBanner.tsx frontend/src/routes.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "P6: LoginPage — 401 creds + 403 awaiting/rejected (I2) + token store & /series redirect (I3) + AlertBanner"
```

---

### Task 8: `RegisterPage` (201 → pending confirmation, not Dashboard)

**Files:**
- Create: `frontend/src/pages/RegisterPage.tsx`
- Modify: `frontend/src/routes.tsx` (swap `RegisterPlaceholder` → `RegisterPage`)
- Test: `frontend/src/pages/RegisterPage.test.tsx`

**Interfaces:**
- Consumes: `api/auth.register` (Task 3), `ApiError` (Task 2), backend `POST /auth/register` (201 `UserOut` status=pending; 409 email-exists — acceptance A1/A2), `react-router-dom` (`Link`).
- Produces: `RegisterPage.tsx` — email/password/confirm form with client-side validation (password length, confirm match). On 201 → swap the form for a confirmation panel ("Account created — pending approval" + `Go to status →` linking `/awaiting-approval`), and **do NOT** navigate to any dashboard (I1). On 409 → inline email error "This email is already registered. Sign in?".

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/pages/RegisterPage.test.tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";

import RegisterPage from "./RegisterPage";
import { server } from "../test/setup";
import { renderWithProviders } from "../lib/test-utils";

function renderRegister() {
  return renderWithProviders(
    <Routes>
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/" element={<div>dashboard-ish landing</div>} />
      <Route path="/awaiting-approval" element={<div>awaiting page</div>} />
    </Routes>,
    { route: "/register" },
  );
}

async function fill(email: string, pw: string, confirm = pw) {
  await userEvent.type(screen.getByLabelText(/^email/i), email);
  await userEvent.type(screen.getByLabelText(/^password/i), pw);
  await userEvent.type(screen.getByLabelText(/confirm/i), confirm);
  await userEvent.click(screen.getByRole("button", { name: /create account/i }));
}

describe("RegisterPage", () => {
  it("on 201 shows pending-approval confirmation and does NOT enter dashboard (I1)", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ id: 1, email: "n@x.c", role: "user", status: "pending", created_at: "x" }, { status: 201 }),
      ),
    );
    renderRegister();
    await fill("n@x.c", "longenoughpw");
    expect(await screen.findByText(/pending approval/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to status/i })).toHaveAttribute("href", "/awaiting-approval");
    expect(screen.queryByText("dashboard-ish landing")).not.toBeInTheDocument();
  });

  it("on 409 shows an email-already-registered inline error", async () => {
    server.use(
      http.post("/api/auth/register", () =>
        HttpResponse.json({ error: { code: "conflict", message: "email exists" } }, { status: 409 }),
      ),
    );
    renderRegister();
    await fill("dupe@x.c", "longenoughpw");
    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
  });

  it("blocks submit when confirm does not match (client-side validation)", async () => {
    renderRegister();
    await fill("n@x.c", "longenoughpw", "different");
    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/pages/RegisterPage.test.tsx`
Expected: FAIL — "Failed to resolve import './RegisterPage'".

- [ ] **Step 3: Write minimal implementation**
```tsx
// frontend/src/pages/RegisterPage.tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";

import { register } from "../api/auth";
import AuthShell from "../components/AuthShell";
import { ApiError } from "../lib/types";

const MIN_PASSWORD = 8;

export default function RegisterPage() {
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
          <h1 className="text-lg font-semibold text-primary">Account created — pending approval</h1>
          <p className="mt-2 text-sm text-muted">
            An administrator must approve your account before you can sign in.
          </p>
          <Link to="/awaiting-approval" className="mt-6 text-accent underline">
            Go to status →
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="mb-6 text-center text-lg font-semibold text-primary">Create account</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            Email
          </label>
          <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-secondary" />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            Password
          </label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-sm border border-border-default bg-surface-2 px-3 py-2 text-secondary" />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1 block text-xs uppercase tracking-wide text-muted">
            Confirm password
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
          {submitting ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        Already have one?{" "}
        <Link to="/login" className="text-accent underline">
          Sign in →
        </Link>
      </p>
    </AuthShell>
  );
}
```

Modify `routes.tsx`: replace `RegisterPlaceholder` with `import RegisterPage from "./pages/RegisterPage";`.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/pages/RegisterPage.test.tsx`
Expected: PASS — 3 tests. 201 → pending-confirmation panel + `Go to status` link, no dashboard navigation (I1); 409 → email-exists inline; mismatch blocked client-side.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/RegisterPage.tsx frontend/src/routes.tsx frontend/src/pages/RegisterPage.test.tsx
git commit -m "P6: RegisterPage — 201 pending confirmation (I1, not dashboard) + 409 email-exists + client validation"
```

---

### Task 9: `AwaitingApprovalPage` (check status + logout)

**Files:**
- Create: `frontend/src/pages/AwaitingApprovalPage.tsx`
- Modify: `frontend/src/routes.tsx` (swap `AwaitingPlaceholder` → `AwaitingApprovalPage`)
- Test: `frontend/src/pages/AwaitingApprovalPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`user`/`logout`/`refreshMe`), backend `GET /auth/me`, `react-router-dom` (`useNavigate`).
- Produces: `AwaitingApprovalPage.tsx` — explicit pending-state page (UX §3.3). "Check status" calls `refreshMe()`; if now `approved` → navigate `/series`; if still pending → gentle "Still pending — check back later."; on error → AlertBanner. "Log out" → `logout()` + navigate `/login`.

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/pages/AwaitingApprovalPage.test.tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { Route, Routes } from "react-router-dom";

import AwaitingApprovalPage from "./AwaitingApprovalPage";
import { server } from "../test/setup";
import { AuthProvider } from "../auth/AuthContext";
import { useAuthStore } from "../auth/authStore";
import { useTokenStore } from "../auth/tokenStore";
import { renderWithProviders } from "../lib/test-utils";

function renderPage() {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/awaiting-approval" element={<AwaitingApprovalPage />} />
        <Route path="/series" element={<div>series landing</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </AuthProvider>,
    { route: "/awaiting-approval" },
  );
}

describe("AwaitingApprovalPage", () => {
  beforeEach(() => {
    useTokenStore.getState().setTokens({ access_token: "a", refresh_token: "r" });
    useAuthStore.getState().setUser({ id: 1, email: "p@x.c", role: "user", status: "pending", created_at: "x" });
  });

  it("shows the pending explanation with the user's email", () => {
    renderPage();
    expect(screen.getByText(/awaiting approval/i)).toBeInTheDocument();
    expect(screen.getByText(/p@x\.c/)).toBeInTheDocument();
  });

  it("Check status routes to /series once the account is approved", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ id: 1, email: "p@x.c", role: "user", status: "approved", created_at: "x" }),
      ),
    );
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /check status/i }));
    await waitFor(() => expect(screen.getByText("series landing")).toBeInTheDocument());
  });

  it("Check status while still pending shows a gentle still-pending note", async () => {
    server.use(
      http.get("/api/auth/me", () =>
        HttpResponse.json({ id: 1, email: "p@x.c", role: "user", status: "pending", created_at: "x" }),
      ),
    );
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /check status/i }));
    expect(await screen.findByText(/still pending/i)).toBeInTheDocument();
  });

  it("Log out clears tokens and returns to /login", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: /log out/i }));
    await waitFor(() => expect(screen.getByText("login page")).toBeInTheDocument());
    expect(useTokenStore.getState().accessToken).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/pages/AwaitingApprovalPage.test.tsx`
Expected: FAIL — "Failed to resolve import './AwaitingApprovalPage'".

- [ ] **Step 3: Write minimal implementation**
```tsx
// frontend/src/pages/AwaitingApprovalPage.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock } from "lucide-react";

import { useAuth } from "../auth/AuthContext";
import AuthShell from "../components/AuthShell";

export default function AwaitingApprovalPage() {
  const { user, logout, refreshMe } = useAuth();
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
        navigate("/series", { replace: true });
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
        <h1 className="text-lg font-semibold text-primary">You&apos;re awaiting approval</h1>
        <p className="mt-2 text-sm text-muted">
          Your account ({user?.email}) is in a PENDING state. An administrator must approve it before you can sign in.
        </p>
        <ul className="mt-4 space-y-1 text-left text-sm text-muted">
          <li>• You&apos;ll be able to log in once approved.</li>
          <li>• API keys can&apos;t be created yet.</li>
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
            {checking ? "Checking…" : "Check status"}
          </button>
          <button type="button" onClick={() => { logout(); navigate("/login"); }}
            className="rounded-md border border-border-default px-4 py-2 text-sm text-secondary hover:bg-surface-2">
            Log out
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
```

Modify `routes.tsx`: replace `AwaitingPlaceholder` with `import AwaitingApprovalPage from "./pages/AwaitingApprovalPage";`.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/pages/AwaitingApprovalPage.test.tsx`
Expected: PASS — 4 tests. Pending copy + email; approve → `/series`; still-pending note; logout clears tokens → `/login`.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/pages/AwaitingApprovalPage.tsx frontend/src/routes.tsx frontend/src/pages/AwaitingApprovalPage.test.tsx
git commit -m "P6: AwaitingApprovalPage — check status (/auth/me) + still-pending + logout"
```

---

### Task 10: `ApiKeysPage` list/create/revoke (+ `EmptyState`, `CopyButton`, `ConfirmPopover`, `Toast`) + `api/apiKeys.ts`

**Files:**
- Create: `frontend/src/api/apiKeys.ts`
- Create: `frontend/src/pages/ApiKeysPage.tsx`
- Create: `frontend/src/components/EmptyState.tsx`, `frontend/src/components/CopyButton.tsx`, `frontend/src/components/ConfirmPopover.tsx`, `frontend/src/components/Toast.tsx`
- Modify: `frontend/src/routes.tsx` (swap `ApiKeysPlaceholder` → `ApiKeysPage`), `frontend/src/main.tsx` (add `ToastProvider`)
- Test: `frontend/src/pages/ApiKeysPage.test.tsx`

**Interfaces:**
- Consumes: backend `GET /api-keys` (`ApiKeyOut[]`), `POST /api-keys {name}` (201 `ApiKeyCreatedOut` — full key once), `DELETE /api-keys/{id}` (204) — design §8 / acceptance B1–B4, J2; `@tanstack/react-query` (`useQuery`/`useMutation`/`useQueryClient`).
- Produces:
  - `api/apiKeys.ts`: `listApiKeys()`, `createApiKey(name)`, `revokeApiKey(id)`.
  - `EmptyState.tsx`: reusable `{icon?, title, description?, action?}`. `CopyButton.tsx`: copies given text → "Copied ✓" (uses `navigator.clipboard`). `ConfirmPopover.tsx`: Radix popover with a confirm/cancel for destructive actions. `Toast.tsx`: Radix-toast `ToastProvider` + `useToast()`.
  - `ApiKeysPage.tsx`: table of keys (name / `prefix` / `last_used_at` (relative+absolute) / `created_at` / Revoke) (J2); `+ New key` → name dialog → create → opens `ApiKeyCreatedModal` (Task 11) with the full key; empty/loading/error states; revoke via `ConfirmPopover` → `DELETE` → row removed + success toast. Page is rendered behind `RequireAuth` (approved-only — J3, enforced by the guard in Task 4/5).

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/pages/ApiKeysPage.test.tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import ApiKeysPage from "./ApiKeysPage";
import { server } from "../test/setup";
import { ToastProvider } from "../components/Toast";
import { renderWithProviders } from "../lib/test-utils";

function renderPage() {
  return renderWithProviders(
    <ToastProvider>
      <ApiKeysPage />
    </ToastProvider>,
    { route: "/api-keys" },
  );
}

describe("ApiKeysPage", () => {
  it("renders an empty state when there are no keys", async () => {
    server.use(http.get("/api/api-keys", () => HttpResponse.json([])));
    renderPage();
    expect(await screen.findByText(/no api keys yet/i)).toBeInTheDocument();
  });

  it("lists keys with name, prefix, last used and created (J2)", async () => {
    server.use(
      http.get("/api/api-keys", () =>
        HttpResponse.json([
          { id: 1, name: "ingest-bot", prefix: "lb_8f3a", last_used_at: "2026-06-18T14:02:00Z", created_at: "2026-06-01T00:00:00Z" },
        ]),
      ),
    );
    renderPage();
    expect(await screen.findByText("ingest-bot")).toBeInTheDocument();
    expect(screen.getByText(/lb_8f3a/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument();
  });

  it("revokes a key and removes it from the list (J2)", async () => {
    let listed = [
      { id: 1, name: "ingest-bot", prefix: "lb_8f3a", last_used_at: null, created_at: "2026-06-01T00:00:00Z" },
    ];
    server.use(
      http.get("/api/api-keys", () => HttpResponse.json(listed)),
      http.delete("/api/api-keys/1", () => {
        listed = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /revoke/i }));
    await userEvent.click(await screen.findByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(screen.queryByText("ingest-bot")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/pages/ApiKeysPage.test.tsx`
Expected: FAIL — "Failed to resolve import './ApiKeysPage'" (and the new atoms).

- [ ] **Step 3: Write minimal implementation**

`frontend/src/api/apiKeys.ts`:
```ts
import type { ApiKeyCreatedOut, ApiKeyOut } from "../lib/types";
import { apiFetch } from "./client";

export function listApiKeys(): Promise<ApiKeyOut[]> {
  return apiFetch<ApiKeyOut[]>("/api-keys");
}

export function createApiKey(name: string): Promise<ApiKeyCreatedOut> {
  return apiFetch<ApiKeyCreatedOut>("/api-keys", { method: "POST", body: { name } });
}

export function revokeApiKey(id: number): Promise<void> {
  return apiFetch<void>(`/api-keys/${id}`, { method: "DELETE" });
}
```

`frontend/src/components/EmptyState.tsx`:
```tsx
import type { ReactNode } from "react";

export default function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-border-default bg-surface p-10 text-center">
      <p className="text-base font-medium text-primary">{title}</p>
      {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

`frontend/src/components/CopyButton.tsx`:
```tsx
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button type="button" onClick={onCopy}
      className="inline-flex items-center gap-1 rounded-md border border-border-default px-2 py-1 text-sm text-secondary hover:bg-surface-2">
      {copied ? <Check size={14} className="text-success-ui" aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? "Copied ✓" : label}
    </button>
  );
}
```

`frontend/src/components/ConfirmPopover.tsx`:
```tsx
import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";

export default function ConfirmPopover({
  trigger,
  message,
  confirmLabel = "Confirm",
  onConfirm,
}: {
  trigger: ReactNode;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="z-20 w-64 rounded-md border border-border-default bg-surface-2 p-3 text-sm text-secondary shadow-lg">
          <p className="mb-3">{message}</p>
          <div className="flex justify-end gap-2">
            <Popover.Close asChild>
              <button type="button" className="rounded-md px-2 py-1 text-secondary hover:bg-surface-3">
                Cancel
              </button>
            </Popover.Close>
            <Popover.Close asChild>
              <button type="button" onClick={onConfirm}
                className="rounded-md bg-danger-ui px-2 py-1 text-white hover:opacity-90">
                {confirmLabel}
              </button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

`frontend/src/components/Toast.tsx`:
```tsx
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import * as RToast from "@radix-ui/react-toast";

interface ToastCtx {
  notify: (message: string) => void;
}
const ToastContext = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const notify = useCallback((msg: string) => {
    setMessage(msg);
    setOpen(true);
  }, []);
  return (
    <ToastContext.Provider value={{ notify }}>
      <RToast.Provider swipeDirection="right">
        {children}
        <RToast.Root open={open} onOpenChange={setOpen}
          className="rounded-md border border-success-ui bg-surface-2 px-3 py-2 text-sm text-success-ui">
          <RToast.Title>{message}</RToast.Title>
        </RToast.Root>
        <RToast.Viewport className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2" />
      </RToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
```

`frontend/src/pages/ApiKeysPage.tsx`:
```tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createApiKey, listApiKeys, revokeApiKey } from "../api/apiKeys";
import AlertBanner from "../components/AlertBanner";
import ApiKeyCreatedModal from "../components/ApiKeyCreatedModal";
import ConfirmPopover from "../components/ConfirmPopover";
import EmptyState from "../components/EmptyState";
import { useToast } from "../components/Toast";
import { formatRelative } from "../lib/format";
import type { ApiKeyCreatedOut } from "../lib/types";

export default function ApiKeysPage() {
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
      notify("Key revoked");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-primary">API Keys</h1>
          <p className="text-sm text-muted">Use these to push trading data via X-API-Key. Keys are shown once.</p>
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
            placeholder="key name"
            className="rounded-sm border border-border-default bg-surface-2 px-2 py-1 text-sm text-secondary"
          />
          <button type="submit" disabled={createMutation.isPending || !newName.trim()}
            className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50">
            + New key
          </button>
        </form>
      </div>

      {keysQuery.isError && <AlertBanner message="Couldn't load API keys." onRetry={() => keysQuery.refetch()} />}

      {keysQuery.isSuccess && keysQuery.data.length === 0 && (
        <EmptyState title="No API keys yet." description="Create one to start pushing data." />
      )}

      {keysQuery.isSuccess && keysQuery.data.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2">Name</th>
              <th>Prefix</th>
              <th>Last used</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keysQuery.data.map((k) => (
              <tr key={k.id} className="border-t border-border-subtle">
                <td className="py-2 text-secondary">{k.name}</td>
                <td className="font-mono text-secondary">{k.prefix}••••</td>
                <td title={k.last_used_at ?? ""} className="text-muted">
                  {k.last_used_at ? formatRelative(k.last_used_at) : "— (never used)"}
                </td>
                <td className="text-muted">{formatRelative(k.created_at)}</td>
                <td className="text-right">
                  <ConfirmPopover
                    message={`Revoke "${k.name}"? Scripts using it will get 401.`}
                    confirmLabel="Confirm"
                    onConfirm={() => revokeMutation.mutate(k.id)}
                    trigger={
                      <button type="button" className="text-danger-ui hover:underline">
                        Revoke
                      </button>
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ApiKeyCreatedModal createdKey={created} onClose={() => setCreated(null)} />
    </div>
  );
}
```

`frontend/src/lib/format.ts` (display-only — NO financial math):
```ts
// Presentation helpers only. No financial computation lives in the frontend.
export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  if (abs < 3600) return `${Math.round(abs / 60)}m ago`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
```

Modify `routes.tsx`: replace `ApiKeysPlaceholder` with `import ApiKeysPage from "./pages/ApiKeysPage";`. Modify `main.tsx`: wrap `<App/>` with `<ToastProvider>` (inside `AuthProvider`).

> Note: `ApiKeysPage` imports `ApiKeyCreatedModal` (Task 11). To keep this task green, create a minimal `ApiKeyCreatedModal` stub that renders nothing when `createdKey` is null (Task 11 fleshes out the copy-once behavior + its own tests). The ApiKeysPage tests here do not assert modal contents.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/pages/ApiKeysPage.test.tsx`
Expected: PASS — 3 tests. Empty state shown for `[]`; list renders name/prefix/last-used/created + Revoke (J2); revoke confirm → `DELETE` → row removed (J2).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/apiKeys.ts frontend/src/pages/ApiKeysPage.tsx frontend/src/components/EmptyState.tsx frontend/src/components/CopyButton.tsx frontend/src/components/ConfirmPopover.tsx frontend/src/components/Toast.tsx frontend/src/lib/format.ts frontend/src/routes.tsx frontend/src/main.tsx frontend/src/pages/ApiKeysPage.test.tsx
git commit -m "P6: ApiKeysPage list/create/revoke (J2) + EmptyState/CopyButton/ConfirmPopover/Toast atoms + api/apiKeys"
```

---

### Task 11: `ApiKeyCreatedModal` (copy-once with dismissal guard)

**Files:**
- Create/replace: `frontend/src/components/ApiKeyCreatedModal.tsx` (replaces the Task 10 stub)
- Test: `frontend/src/components/ApiKeyCreatedModal.test.tsx`

**Interfaces:**
- Consumes: `ApiKeyCreatedOut` (the 201 response with the full `key`), `CopyButton` (Task 10), `@radix-ui/react-dialog`. The full key is held in props/component state only — **never** written to query cache, URL, or storage (acceptance J1).
- Produces: `ApiKeyCreatedModal.tsx` — a Radix dialog that opens when `createdKey` is non-null, shows the full key once (Fira Code, pre-selected), a `Copy` button, and a primary "I've copied it — done" dismissal. Closing without copying triggers a confirm guard. On close it calls `onClose()` (the parent discards the key from state) so the full key is unrecoverable afterward. Reused only by ApiKeysPage.

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/components/ApiKeyCreatedModal.test.tsx
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ApiKeyCreatedModal from "./ApiKeyCreatedModal";
import { renderWithProviders } from "../lib/test-utils";

const KEY = { id: 1, name: "ingest-bot", key: "lb_8f3a2c91d4e77b_full_secret" };

describe("ApiKeyCreatedModal (copy-once, J1)", () => {
  it("shows the full key exactly once when open", () => {
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={() => {}} />);
    expect(screen.getByText(KEY.key)).toBeInTheDocument();
    expect(screen.getByText(/only time the full key is shown/i)).toBeInTheDocument();
  });

  it("renders nothing (key not present) when createdKey is null", () => {
    renderWithProviders(<ApiKeyCreatedModal createdKey={null} onClose={() => {}} />);
    expect(screen.queryByText(KEY.key)).not.toBeInTheDocument();
  });

  it("copying then 'I've copied it — done' dismisses and discards the key", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    await userEvent.click(screen.getByRole("button", { name: /i've copied it/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closing without copying triggers the dismissal guard, then confirms", async () => {
    const onClose = vi.fn();
    renderWithProviders(<ApiKeyCreatedModal createdKey={KEY} onClose={onClose} />);
    // Attempt to close (button) before copying → guard appears, onClose not yet called.
    await userEvent.click(screen.getByRole("button", { name: /i've copied it/i }));
    expect(await screen.findByText(/close without copying/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /close anyway/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

> The guard semantics: the primary "I've copied it — done" only closes immediately **after** a copy has occurred; if pressed before copying, it shows the "Close without copying? You can't retrieve this key later." guard with a "Close anyway" affordance. (UX §3.10.)

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/components/ApiKeyCreatedModal.test.tsx`
Expected: FAIL — the Task 10 stub renders nothing, so the "shows the full key" and guard assertions fail.

- [ ] **Step 3: Write minimal implementation**
```tsx
// frontend/src/components/ApiKeyCreatedModal.tsx
import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { KeyRound } from "lucide-react";

import CopyButton from "./CopyButton";
import type { ApiKeyCreatedOut } from "../lib/types";

export default function ApiKeyCreatedModal({
  createdKey,
  onClose,
}: {
  createdKey: ApiKeyCreatedOut | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [guarding, setGuarding] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const open = createdKey !== null;

  useEffect(() => {
    if (open) {
      setCopied(false);
      setGuarding(false);
      // focus + pre-select the key for easy manual copy
      requestAnimationFrame(() => fieldRef.current?.select());
    }
  }, [open, createdKey]);

  const requestClose = () => {
    if (copied) {
      onClose();
    } else {
      setGuarding(true);
    }
  };

  if (!createdKey) return null;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) requestClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content
          aria-modal
          className="fixed left-1/2 top-1/2 z-50 w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-default bg-surface-2 p-6"
        >
          <Dialog.Title className="flex items-center gap-2 text-lg font-semibold text-primary">
            <KeyRound size={18} aria-hidden /> API key created
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            Copy it now — you won&apos;t be able to see it again.
          </Dialog.Description>

          <div className="mt-4 flex items-center gap-2">
            <input
              ref={fieldRef}
              readOnly
              value={createdKey.key}
              aria-label="API key"
              className="flex-1 rounded-sm border border-border-default bg-surface px-2 py-2 font-mono text-sm text-secondary"
            />
            <span onClick={() => setCopied(true)}>
              <CopyButton value={createdKey.key} />
            </span>
          </div>

          <p className="mt-3 text-xs text-warning">⚠ This is the only time the full key is shown.</p>

          {guarding ? (
            <div className="mt-5 rounded-md border border-warning bg-surface px-3 py-2 text-sm text-warning">
              Close without copying? You can&apos;t retrieve this key later.
              <div className="mt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setGuarding(false)}
                  className="rounded-md px-2 py-1 text-secondary hover:bg-surface-3">
                  Keep it open
                </button>
                <button type="button" onClick={onClose}
                  className="rounded-md bg-danger-ui px-2 py-1 text-white hover:opacity-90">
                  Close anyway
                </button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={requestClose}
              className="mt-5 w-full rounded-md bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover">
              I&apos;ve copied it — done
            </button>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/components/ApiKeyCreatedModal.test.tsx src/pages/ApiKeysPage.test.tsx`
Expected: PASS — modal (4) + ApiKeysPage still green. Full key shown once (J1); null → key absent; copy-then-done dismisses; close-before-copy triggers the guard then "Close anyway" confirms. After `onClose`, the parent sets `created=null` so the key is gone (J1 dismissal guard + unrecoverable).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/components/ApiKeyCreatedModal.tsx frontend/src/components/ApiKeyCreatedModal.test.tsx
git commit -m "P6: ApiKeyCreatedModal — copy-once full key (J1) + dismissal guard, key held in state only"
```

---

### Task 12: `AdminUsersPage` (approve/reject, live update) + `StatusChip` + `api/admin.ts`

**Files:**
- Create: `frontend/src/api/admin.ts`
- Create: `frontend/src/pages/AdminUsersPage.tsx`
- Create: `frontend/src/components/StatusChip.tsx`
- Modify: `frontend/src/routes.tsx` (swap `AdminUsersPlaceholder` → `AdminUsersPage`)
- Test: `frontend/src/pages/AdminUsersPage.test.tsx`, `frontend/src/components/StatusChip.test.tsx`

**Interfaces:**
- Consumes: backend `GET /admin/users` (`AdminUserOut[]`), `POST /admin/users/{id}/approve` (204), `POST /admin/users/{id}/reject` (204) — design §8 / acceptance K2; `@tanstack/react-query`; `ConfirmPopover` (Task 10, for reject); `useToast` (Task 10).
- Produces:
  - `api/admin.ts`: `listUsers()`, `approveUser(id)`, `rejectUser(id)`.
  - `StatusChip.tsx`: renders `pending` (amber dot) / `approved` (emerald) / `rejected` (rose). Reused wherever user status appears.
  - `AdminUsersPage.tsx`: filterable users table (default Pending); Approve → `approve` mutation → invalidate list (chip flips, K2) + success toast; Reject → `ConfirmPopover` → `reject`. Empty/loading/error states. Rendered behind `RequireAdmin` (K1, Task 4/5).

- [ ] **Step 1: Write the failing test**
```tsx
// frontend/src/components/StatusChip.test.tsx
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import StatusChip from "./StatusChip";
import { renderWithProviders } from "../lib/test-utils";

describe("StatusChip", () => {
  it("renders the status label", () => {
    renderWithProviders(<StatusChip status="pending" />);
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });
});
```

```tsx
// frontend/src/pages/AdminUsersPage.test.tsx
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";

import AdminUsersPage from "./AdminUsersPage";
import { server } from "../test/setup";
import { ToastProvider } from "../components/Toast";
import { renderWithProviders } from "../lib/test-utils";

function renderPage() {
  return renderWithProviders(
    <ToastProvider>
      <AdminUsersPage />
    </ToastProvider>,
    { route: "/admin/users" },
  );
}

describe("AdminUsersPage (K2)", () => {
  it("lists pending users with approve/reject actions", async () => {
    server.use(
      http.get("/api/admin/users", () =>
        HttpResponse.json([
          { id: 1, email: "a@firm.com", role: "user", status: "pending", created_at: "2026-06-18T00:00:00Z" },
        ]),
      ),
    );
    renderPage();
    expect(await screen.findByText("a@firm.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });

  it("approving a user updates the list (chip flips to approved)", async () => {
    let users = [
      { id: 1, email: "a@firm.com", role: "user", status: "pending", created_at: "2026-06-18T00:00:00Z" },
    ];
    server.use(
      http.get("/api/admin/users", () => HttpResponse.json(users)),
      http.post("/api/admin/users/1/approve", () => {
        users = [{ ...users[0], status: "approved" }];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /approve/i }));
    await waitFor(() => expect(screen.getByText(/approved/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `cd frontend && npm run test -- src/pages/AdminUsersPage.test.tsx src/components/StatusChip.test.tsx`
Expected: FAIL — "Failed to resolve import './AdminUsersPage'" / './StatusChip'.

- [ ] **Step 3: Write minimal implementation**

`frontend/src/api/admin.ts`:
```ts
import type { AdminUserOut } from "../lib/types";
import { apiFetch } from "./client";

export function listUsers(): Promise<AdminUserOut[]> {
  return apiFetch<AdminUserOut[]>("/admin/users");
}

export function approveUser(id: number): Promise<void> {
  return apiFetch<void>(`/admin/users/${id}/approve`, { method: "POST" });
}

export function rejectUser(id: number): Promise<void> {
  return apiFetch<void>(`/admin/users/${id}/reject`, { method: "POST" });
}
```

`frontend/src/components/StatusChip.tsx`:
```tsx
import type { UserStatus } from "../lib/types";

const DOT: Record<UserStatus, string> = {
  pending: "bg-warning",
  approved: "bg-success-ui",
  rejected: "bg-danger-ui",
};

export default function StatusChip({ status }: { status: UserStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-secondary">
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} aria-hidden />
      {status}
    </span>
  );
}
```

`frontend/src/pages/AdminUsersPage.tsx`:
```tsx
import { useState } from "react";
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
  const qc = useQueryClient();
  const { notify } = useToast();
  const [filter, setFilter] = useState<UserStatus | "all">("pending");

  const usersQuery = useQuery({ queryKey: ["admin-users"], queryFn: listUsers });

  const approveMutation = useMutation({
    mutationFn: (id: number) => approveUser(id),
    onSuccess: () => {
      notify("User approved");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
  const rejectMutation = useMutation({
    mutationFn: (id: number) => rejectUser(id),
    onSuccess: () => {
      notify("User rejected");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });

  const rows = (usersQuery.data ?? []).filter((u) => filter === "all" || u.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-primary">User Approvals</h1>
        <select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => setFilter(e.target.value as UserStatus | "all")}
          className="rounded-sm border border-border-default bg-surface-2 px-2 py-1 text-sm text-secondary"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>

      {usersQuery.isError && <AlertBanner message="Couldn't load users." onRetry={() => usersQuery.refetch()} />}

      {usersQuery.isSuccess && rows.length === 0 && (
        <EmptyState title="No users awaiting approval." description="All caught up." />
      )}

      {rows.length > 0 && (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="py-2">Email</th>
              <th>Status</th>
              <th>Role</th>
              <th>Registered</th>
              <th>Actions</th>
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
                        Approve
                      </button>
                      <ConfirmPopover
                        message={`Reject ${u.email}? They won't be able to sign in.`}
                        confirmLabel="Reject"
                        onConfirm={() => rejectMutation.mutate(u.id)}
                        trigger={
                          <button type="button" className="rounded-md border border-border-default px-2 py-1 text-xs text-danger-ui">
                            Reject
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
```

Modify `routes.tsx`: replace `AdminUsersPlaceholder` with `import AdminUsersPage from "./pages/AdminUsersPage";`.

- [ ] **Step 4: Run test to verify it passes**
Run: `cd frontend && npm run test -- src/pages/AdminUsersPage.test.tsx src/components/StatusChip.test.tsx`
Expected: PASS — AdminUsersPage (2) + StatusChip (1). Pending list with approve/reject; approve → list invalidated → chip flips to approved and the Approve button disappears (K2).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/api/admin.ts frontend/src/pages/AdminUsersPage.tsx frontend/src/components/StatusChip.tsx frontend/src/routes.tsx frontend/src/pages/AdminUsersPage.test.tsx frontend/src/components/StatusChip.test.tsx
git commit -m "P6: AdminUsersPage approve/reject (K2) + StatusChip + api/admin"
```

---

### Task 13: Phase 6 acceptance-gate verification (full green run)

**Files:**
- Modify: none (verification + any small fixes surfaced).

**Interfaces:**
- Consumes: everything above.
- Produces: a recorded, reproducible pass of the full Phase 6 acceptance gate (verified against the **live backend** for the manual flow, and against MSW for the automated suite).

- [ ] **Step 1: Full test suite**
Run: `cd frontend && npm run test`
Expected: PASS — every Vitest file green (App, client, tokenStore, authStore, RequireAuth, RequireAdmin, routes, Sidebar, themeStore, ThemeToggle, PnlColorToggle, LoginPage, RegisterPage, AwaitingApprovalPage, ApiKeysPage, ApiKeyCreatedModal, AdminUsersPage, StatusChip).

- [ ] **Step 2: Lint + type-check + build**
Run: `cd frontend && npm run lint && npm run build`
Expected: PASS — ESLint clean; `tsc -b` no type errors; `vite build` produces `dist/`.

- [ ] **Step 3: Manual smoke against the live backend (I3/I4 end-to-end)**
With Postgres + backend up (Phase 0/1) and `npm run dev` running:
- Register a new user → see the pending-confirmation panel (I1), not a dashboard.
- Try to log in while pending → "awaiting approval" copy (I2).
- Approve the user from an admin session at `/admin/users` (K1/K2).
- Log in as the approved user → tokens stored, redirect to `/series` (I3).
- Let the access token expire (or shorten `ACCESS_TOKEN_TTL_MIN`) and trigger a protected call → silent refresh keeps you in; revoke the refresh path → logout to `/login` (I4).
- Create an API key → copy-once modal shows the full key once; dismiss; confirm the list shows only the prefix (J1/J2).
- Toggle theme + P/L scheme, reload → both persist.
Expected: each step behaves as described.

- [ ] **Step 4: Commit (only if fixes were needed)**
```bash
git add -A
git commit -m "P6: acceptance-gate verification — vitest green, lint+build clean, live auth/api-key/admin smoke"
```

---

## Self-Review — Phase 6 acceptance-gate coverage (验收标准 I, J, K)

Each frontend acceptance criterion maps to the task and the test that proves it:

| Criterion | Requirement | Task | Proof (test) |
|-----------|-------------|------|--------------|
| **I1** | register → pending confirmation, NOT dashboard | **Task 8** | `RegisterPage.test.tsx`: 201 → "pending approval" panel + `Go to status` link; asserts the dashboard route is NOT rendered |
| **I2** | pending login → "awaiting approval" (403 captured, not generic) | **Task 7** | `LoginPage.test.tsx`: mocked 403 → "awaiting admin approval" copy + link to `/awaiting-approval` |
| **I3** | approved login stores tokens → redirect `/series` | **Task 7** (+ Task 3 store, Task 4 context) | `LoginPage.test.tsx`: 200+`/auth/me` → tokens in `useTokenStore`, navigates to "series landing" |
| **I4** | silent refresh on expiry; logout on refresh fail | **Task 2** (client retry) + **Task 3** (`silentRefresh`) | `client.test.ts`: 401 → single refresh + retry / no infinite retry; `tokenStore.test.ts`: refresh success stores new token, failure clears tokens |
| **J1** | copy-once modal shows full key once + dismissal guard | **Task 11** | `ApiKeyCreatedModal.test.tsx`: full key shown when open / absent when null; copy-then-done closes; close-before-copy triggers guard then confirms; key held in state only (never cached) |
| **J2** | list shows name/prefix/last_used/created + revoke | **Task 10** | `ApiKeysPage.test.tsx`: list renders all four columns + Revoke; revoke confirm → `DELETE 204` → row removed |
| **J3** | only approved users can use the page | **Task 4** (`RequireAuth`) + **Task 5** (route placement) | `RequireAuth.test.tsx`: authed-but-pending → `/awaiting-approval`; `routes.test.tsx`: unauthed `/api-keys` → login |
| **K1** | admin-only route guard | **Task 4** (`RequireAdmin`) | `RequireAdmin.test.tsx`: non-admin → `/series`; admin → outlet. `Sidebar.test.tsx`: Admin nav hidden for non-admin |
| **K2** | pending users list + approve/reject updates | **Task 12** | `AdminUsersPage.test.tsx`: lists pending with approve/reject; approve → list invalidated → chip flips to approved, Approve button gone |

**Roadmap Phase 6 scope coverage:** Vite+TS+Tailwind setup with design tokens (dark default + light + P/L red-up via CSS variables flipped by `[data-theme]`/`[data-pnl]`), Fira fonts, Lucide, Radix primitives (Task 1, 6, 10, 11). `api/client.ts` (base URL + JSON + error normalization + JWT attach), `api/auth.ts`, `api/apiKeys.ts`, `api/admin.ts` (Tasks 2, 3, 10, 12). `auth/` AuthContext + tokenStore (access+refresh + silent refresh on 401) + RequireAuth/RequireAdmin (Tasks 3, 4). Zustand stores: auth/session (Task 3), theme + pnl_color_scheme (Task 6). `routes.tsx` (public/protected/admin), `App.tsx`, AppShell/Sidebar/Topbar (Task 5). ThemeToggle, PnlColorToggle (Task 6). Atoms RoleChip (Task 5), StatusChip (Task 12), AlertBanner (Task 7), Toast/EmptyState/CopyButton/ConfirmPopover (Task 10). Pages: LoginPage with 403 awaiting handling (Task 7), RegisterPage 201→pending (Task 8), AwaitingApprovalPage (Task 9), ApiKeysPage + ApiKeyCreatedModal copy-once (Tasks 10, 11), AdminUsersPage approve/reject (Task 12).

**Thin-frontend constraint honored:** these pages perform **no financial computation** — `lib/format.ts` holds only display helpers (relative dates / prefix masking). All metric/chart work and `state/useSeries|useMetrics|useComparison` + `api/series|metrics|comparison` are deferred to Phases 7–8, which drop their pages into the `RequireAuth`/`AppShell` route group this phase establishes. The theme + P/L preference machinery recolors values without ever changing them (UX §1.2), and the API client/guards keep per-user isolation enforced at the transport + routing layers.

