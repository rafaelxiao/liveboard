# LiveBoard — UX Design Specification

**Date:** 2026-06-19
**Status:** UX design (elaborates the approved design & structure specs; does not change them)
**Source of truth:**
- `2026-06-19-liveboard-design.md` (product/domain/API)
- `2026-06-19-liveboard-structure-and-acceptance.md` (structure + acceptance criteria; frontend tree & component names)

**Design intelligence:** grounded in the `ui-ux-pro-max` skill (style: *Dark Mode / OLED*; color: *Fintech/Crypto*; typography: *Fira Code + Fira Sans — dashboards/analytics*; chart guidance: *Trend-over-time line, multi-series distinct colors + pattern overlays, area for drawdown*).

> Scope note: this is a **UX specification**, not application code. Wireframes are ASCII. Component names map 1:1 to `frontend/src/components/*` and `pages/*` in the structure doc so engineering can implement directly.

> **Thin-frontend principle (design spec §2):** the frontend performs **no financial computation**. Every metric, curve point, drawdown value, and per-trade diff is computed by the backend and returned render-ready; the UI only fetches, lays out, charts, and **formats for display** (currency/percent/locale) + applies presentation preferences (theme, P/L color scheme). Presentation choices like the P/L color scheme (§1.2) recolor backend-provided values — they never change the values themselves. The backend is a portable data service; this UI is its first consumer.

---

## 1. Design Language

### 1.1 Chosen UI style — Dark Mode (OLED), data-dense "quant terminal"

**Decision:** Dark-mode-first, with a fully supported light mode (toggle, persisted per-user in `localStorage`; default follows `prefers-color-scheme`, falling back to dark).

**Rationale (from skill + domain):**
- The skill's design-system run returned **Dark Mode (OLED)** as the best-fit style for a data-dense analytics product: *Performance ⚡ Excellent, Accessibility ✓ WCAG AAA*, best for low-light, long-session, screen-heavy use.
- Quant traders/analysts run dashboards for long uninterrupted sessions; dark reduces eye strain and makes colored data series (equity overlays, P/L) "pop" against a neutral ground.
- This is **not** a real-time streaming terminal (spec §2: on-demand computation). So we adopt the dark *aesthetic* and density of a trading terminal, but **not** flashing/animated tickers. Calm, precise, static-until-queried.

The look is **"Calm Quant Terminal"**: deep slate background, restrained chrome, one vivid accent, semantic P/L colors used *only* on data — never on chrome.

### 1.2 Color palette

Base palette anchored on the skill's **Fintech/Crypto** result (`bg #0F172A`, `text #F8FAFC`, `border #334155`), with a blue primary (the skill's Dark-Mode primary `#3B82F6`) chosen over the crypto amber because amber collides with our semantic "warning/caution" channel and with gold P/L conventions.

#### Dark mode (default)

| Role | Hex | Usage |
|------|-----|-------|
| `bg/app` | `#0B1120` | App background (one step darker than slate-900 for OLED) |
| `bg/surface` | `#0F172A` | Cards, panels, sidebar |
| `bg/surface-2` | `#1E293B` | Raised elements: table header, modal, popover, inputs |
| `bg/surface-3` | `#273449` | Hover row / active selector chip |
| `border/subtle` | `#1E293B` | Hairlines between rows |
| `border/default` | `#334155` | Card borders, input borders |
| `border/strong` | `#475569` | Focus-adjacent, dividers needing emphasis |
| `text/primary` | `#F8FAFC` | Headings, key values |
| `text/secondary` | `#CBD5E1` | Body, labels |
| `text/muted` | `#94A3B8` | Captions, axis ticks, metadata (use ≥ slate-400, never lighter) |
| `text/disabled` | `#64748B` | Disabled, placeholder |
| `accent/primary` | `#3B82F6` | Primary buttons, active nav, links, selected state |
| `accent/primary-hover` | `#60A5FA` | Hover on primary |
| `focus/ring` | `#93C5FD` | 2px focus ring (offset 2px) |

#### Light mode

| Role | Hex |
|------|-----|
| `bg/app` | `#F8FAFC` |
| `bg/surface` | `#FFFFFF` |
| `bg/surface-2` | `#F1F5F9` |
| `border/default` | `#E2E8F0` |
| `text/primary` | `#0F172A` |
| `text/secondary` | `#334155` |
| `text/muted` | `#475569` (≥ slate-600 — never gray-400) |
| `accent/primary` | `#2563EB` |

#### Semantic finance colors (the important part)

Finance convention varies by region (US/EU: **green = gain, red = loss**; Greater China / parts of East Asia: **red = gain/up, green = loss/down**). **Decision (RESOLVED): the P/L color scheme is a user preference, defaulting to "Red-up (East-Asian)".** A `ThemeToggle`-adjacent "P/L colors" setting (in the user menu, persisted per-user in `localStorage`, key `pnl_color_scheme`) offers two values:

- **`red-up` (DEFAULT)** — red = gain/up, green = loss/down (East-Asian convention).
- **`green-up`** — green = gain/up, red = loss/down (US/EU convention).

Implementation: define **two physical hue tokens** (`hue/red`, `hue/green`) and **two semantic tokens** (`pnl/gain`, `pnl/loss`) whose hue assignment is resolved at runtime from `pnl_color_scheme`. Components reference only `pnl/gain` / `pnl/loss` — never the raw hue — so flipping the preference recolors everything consistently. Because P/L is never encoded by color alone (§6.2: color + sign + glyph), either scheme is safe and unambiguous.

| Physical hue | Dark hex | Light hex | Notes |
|--------------|----------|-----------|-------|
| `hue/red` | `#F43F5E` (rose-500) | `#E11D48` | Rose, not pure red — better dark-bg contrast & less "alarm" |
| `hue/green` | `#10B981` (emerald-500) | `#059669` | Emerald |

| Semantic token | `red-up` (default) → hue | `green-up` → hue | Meaning | Notes |
|----------------|--------------------------|-------------------|---------|-------|
| `pnl/gain` | `hue/red` | `hue/green` | Profit / gain / up | Paired with `▲` glyph & `+` sign |
| `pnl/loss` | `hue/green` | `hue/red` | Loss / down | Paired with `▼` glyph & `−` sign |
| `pnl/neutral` | `#94A3B8` | `#64748B` (light) | Zero / flat | Scheme-independent |
| `drawdown/fill` | resolves to `pnl/loss` hue @ 18% (dark) / 12% (light) | — | Drawdown area under zero | Always rendered as **magnitude below a 0 baseline**; tracks the loss hue so it flips with the scheme |
| `warning` | `#F59E0B` (amber-500) | `#D97706` | Caution: stale data, "realized-only" caveats, low sample | Distinct amber hue — independent of the P/L scheme, so it never collides with either gain/loss color |
| `info` | `#38BDF8` (sky-400) | `#0284C7` | Informational badges, "realized" tooltip cue | Scheme-independent |
| `success/ui` | `#10B981` | `#059669` | UI success toasts (key copied, user approved) | **Fixed to emerald regardless of P/L scheme** — UI success is not a financial gain, so it must not flip with `pnl_color_scheme` |
| `danger/ui` | `#F43F5E` | `#E11D48` | Destructive UI (revoke key, reject user) | **Fixed to rose regardless of P/L scheme** — destructive ≠ financial loss |

> **Critical (two separations):**
> 1. `pnl/gain` / `pnl/loss` are reserved for **financial value semantics on data** (numbers, deltas, chart points). UI chrome (buttons, nav) uses `accent/primary`. This prevents a "blue Save button" being misread, and prevents P/L hues leaking into chrome.
> 2. **UI status colors (`success/ui`, `danger/ui`) are hue-FIXED** and do **not** follow `pnl_color_scheme`. Under the default `red-up` scheme, a financial gain is red while a success toast stays green — these are different meaning channels and must stay visually distinct. Never wire a success toast to `pnl/gain`.

#### Series overlay palette (Comparison, colorblind-safe)

Ordered, qualitative, Okabe-Ito–derived for color-vision deficiency. Series A/B/C/… get a color **and** a line-dash pattern (see §4.3) so they never rely on hue alone.

| Slot | Hex | Dash pattern |
|------|-----|--------------|
| Series A | `#3B82F6` (blue) | solid |
| Series B | `#F59E0B` (amber) | dashed `6 4` |
| Series C | `#A855F7` (purple) | dotted `2 3` |
| Series D | `#14B8A6` (teal) | dash-dot `8 3 2 3` |
| Series E | `#EC4899` (pink) | long-dash `12 4` |
| Series F | `#84CC16` (lime) | solid + markers |

> Note: comparison overlays deliberately **avoid green/red** because those are reserved for P/L semantics; using them for "Series A vs B" would be ambiguous.

### 1.3 Typography

Pairing from the skill (mood: *dashboard, data, analytics, precise*): **Fira Code** (monospaced, tabular) + **Fira Sans** (humanist sans).

- **Fira Sans** — UI text: nav, labels, buttons, prose, table text.
- **Fira Code** — **all numeric/financial data** (metric values, P/L, prices, qty, timestamps, API keys, axis ticks). Monospace gives **tabular figures** so digits align vertically in cards and tables — essential for scanning numbers. Use `font-variant-numeric: tabular-nums`.

CSS import:
```css
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');
```

#### Type scale

| Token | Font | Size / line-height | Weight | Use |
|-------|------|--------------------|--------|-----|
| `display` | Fira Sans | 30 / 36 | 600 | Page title (rare) |
| `h1` | Fira Sans | 24 / 32 | 600 | Screen title |
| `h2` | Fira Sans | 20 / 28 | 600 | Section / panel header |
| `h3` | Fira Sans | 16 / 24 | 600 | Card group label |
| `body` | Fira Sans | 14 / 21 | 400 | Default UI text |
| `body-sm` | Fira Sans | 13 / 20 | 400 | Dense table cells, helper text |
| `label` | Fira Sans | 12 / 16 | 500, `0.04em` tracking, uppercase | Field labels, metric-card captions |
| `caption` | Fira Sans | 11 / 16 | 400 | Axis ticks (when not numeric), footnotes |
| `metric-xl` | **Fira Code** | 28 / 32 | 600, tabular-nums | Hero metric value in MetricCard |
| `metric` | **Fira Code** | 18 / 24 | 600, tabular-nums | Standard metric value |
| `data` | **Fira Code** | 13 / 20 | 500, tabular-nums | Table numeric cells, prices, qty |
| `mono-key` | **Fira Code** | 14 / 20 | 500 | API key display, prefixes |

Body text minimum 14px desktop / 16px mobile; line-height 1.5 for prose, 1.4–1.5 for dense tables; line length capped ~72ch for any prose blocks.

### 1.4 Spacing, grid & radii

- **Spacing scale (4px base):** 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **App grid:** 12-column fluid content area, 24px gutters (desktop), max content width `1440px` centered on ultra-wide; dashboards may go full-bleed to `1680px` for chart breathing room.
- **Card padding:** 20px (desktop), 16px (compact tables).
- **Radii:** `sm 6px` (inputs, chips), `md 8px` (cards, buttons), `lg 12px` (modals, panels), `full` (badges, avatars).
- **Elevation (dark):** shadows are weak; rely on `bg/surface` → `surface-2` → `surface-3` steps + 1px borders for depth. Modal uses `0 10px 40px rgba(0,0,0,0.5)` + scrim `rgba(2,6,23,0.7)`.
- **Z-index scale:** base 0, sticky header/sidebar 10, dropdown/popover 20, sticky table header 15, tooltip 30, modal scrim 40, modal 50, toast 60.

### 1.5 Light/dark decision summary

Dark is default and the design's "native" mode (justified §1.1). Light mode is a first-class equal-contrast alternative (palette §1.2) for users in bright environments or sharing screenshots. The semantic P/L and series palettes have explicit light variants tuned for ≥4.5:1 contrast. A theme toggle **and** the P/L color-scheme toggle (§1.2, default `red-up`) both live in the user menu (top-right). Charts read the active theme tokens (axis/grid/text) and the resolved `pnl/gain`·`pnl/loss` hues at render.

---

## 2. Information Architecture & Navigation

### 2.1 App shell

Two shells depending on auth state:

**(a) Auth shell** (unauthenticated / pending) — centered single-column card on `bg/app`, brand wordmark top-left, no nav. Used by Login, Register, AwaitingApproval.

**(b) App shell** (authenticated + approved) — persistent **left sidebar** + slim **top bar**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOPBAR: [≡] LiveBoard            <breadcrumb / page title>     [◐ theme] [user ▾] │
├───────────┬──────────────────────────────────────────────────────────────┤
│ SIDEBAR   │                                                              │
│           │                                                              │
│ ▣ Series  │                      ROUTED PAGE CONTENT                     │
│ ◳ Dashboard                                                             │
│ ⇄ Compare │                                                              │
│ ──────────                                                              │
│ ⚷ API Keys│                                                              │
│ ⛨ Admin*  │   (* Admin item only rendered when role=admin)               │
│           │                                                              │
│ [collapse]│                                                              │
└───────────┴──────────────────────────────────────────────────────────────┘
```

- Sidebar width 240px expanded / 64px collapsed (icon-only, label on hover tooltip). Active item: `accent/primary` left bar (3px) + `surface-3` fill + primary-tinted icon.
- Top bar (56px): hamburger (mobile collapse), current page title/breadcrumb, theme toggle, user menu (email, role chip, Logout). On Dashboard/Comparison the top bar also hosts the **global series context** breadcrumb (e.g. `Series ▸ "Alpha-Real" ▸ Strategy ▸ momo-eth`).
- The user menu shows a `role` chip (`USER` / `ADMIN`) and `status` only matters pre-approval (approved users never see it).

### 2.2 Navigation structure / route map

Maps to `routes.tsx` (public / protected / admin) and `pages/*`:

| Route | Page component | Guard | Shell | In sidebar |
|-------|---------------|-------|-------|-----------|
| `/login` | `LoginPage` | public | auth | — |
| `/register` | `RegisterPage` | public | auth | — |
| `/awaiting-approval` | `AwaitingApprovalPage` | authed + `pending` | auth | — |
| `/series` | `SeriesListPage` | `RequireAuth` (+approved) | app | ✓ Series (default landing) |
| `/series/:id` | `SeriesDetailPage` | `RequireAuth` | app | — (drill-in) |
| `/dashboard` | `DashboardPage` | `RequireAuth` | app | ✓ Dashboard |
| `/compare` | `ComparisonPage` | `RequireAuth` | app | ✓ Compare |
| `/api-keys` | `ApiKeysPage` | `RequireAuth` | app | ✓ API Keys |
| `/admin/users` | `AdminUsersPage` | `RequireAdmin` | app | ✓ Admin (admin only) |

**Default landing after login:** `/series` (acceptance I3). From a series row you can jump to `/dashboard?series=:id` or add it to a comparison.

### 2.3 Primary user flows

**Flow A — First-time signup → approval → use**
```
/register (submit email+pw)
   └─ 201 → success panel "Submitted, awaiting admin approval"  → route to /awaiting-approval
/login attempt while pending
   └─ 403 → inline "Your account is awaiting admin approval"   (stay on auth shell)
admin approves (AdminUsersPage)
/login again
   └─ 200 tokens stored → redirect to /series
```

**Flow B — Generate an API key & push data**
```
/api-keys → "New key" → name it → POST /api-keys
   └─ ApiKeyCreatedModal shows FULL key ONCE (copy button) → user copies → confirm "I've copied it"
   └─ modal closes → list shows {name, prefix•••, created} ; full key never retrievable
user scripts ingestion (X-API-Key) → POST /series, /series/{id}/fills:batch
   └─ (out of UI) data appears as counts on SeriesListPage / SeriesDetailPage
```

**Flow C — Analyze one series**
```
/series → click a series → /dashboard?series=:id
   set LevelSelector (account|strategy|symbol) [+ strategy/symbol when needed]
   set DateRangePicker
   → GET /series/{id}/metrics → MetricCardGrid + EquityChart + DrawdownChart (account/strategy)
   → symbol level: TradeStatsTable + PnL cards only (no return%/Sharpe), + contribution
```

**Flow D — Compare series**
```
/compare → SeriesPicker (multi-select ≥2; submit disabled < 2) + DateRangePicker → POST /comparisons
   → side-by-side MetricCardGrid per series (account always)
   → single EquityChart with OVERLAID curves (Series A/B/C…)
   → matched strategies/symbols compared; unmatched shown side-by-side flagged "no counterpart"
   → PerTradeDiffTable (matched fill pairs: same side + nearest ts within tolerance; slippage/timing/qty/fee; unmatched surfaced; paginated)
```

---

## 3. Screen-by-Screen Layout Specs

Each screen lists: layout (ASCII), key components, states (loading/empty/error), interactions.

### 3.1 LoginPage (`/login`)

```
              ┌───────────────────────────────┐
              │            LiveBoard          │
              │   Sign in to your account     │
              │                               │
              │  Email     [______________]   │
              │  Password  [______________]   │
              │                               │
              │  [        Sign in         ]   │   ← primary button, loading spinner inline
              │                               │
              │  ⚠ awaiting-approval / error  │   ← role="alert" region (conditional)
              │                               │
              │  No account?  Register →      │
              └───────────────────────────────┘
```
- **Key components:** form (labelled inputs), primary `Sign in` button, link to `/register`, inline alert region.
- **States:**
  - *Loading:* button shows spinner + disabled (acceptance: disable during async); inputs locked.
  - *401 wrong creds:* `role="alert"` "Incorrect email or password."
  - *403 pending:* dedicated copy "Your account is awaiting admin approval." + link to `/awaiting-approval`. (acceptance I2 — not a generic error.)
  - *403 rejected:* "This account isn't approved for access. Contact your administrator."
  - *Empty:* button disabled until both fields non-empty.
- **Interactions:** Enter submits; on success store tokens (AuthContext/tokenStore) → redirect `/series` or to the `?next=` param.

### 3.2 RegisterPage (`/register`)

```
   LiveBoard — Create account
   Email      [______________]
   Password   [______________]   (strength hint, min length)
   Confirm    [______________]
   [        Create account        ]
   Already have one?  Sign in →
```
- **Success (201):** swap the form for a confirmation panel — big check icon, "Account created — pending approval", explanation that an admin must approve, `Go to status →` (→ `/awaiting-approval`). (acceptance I1: do **not** drop into Dashboard.)
- **States:** loading (disabled button + spinner); 409 email-exists → inline alert on email field "This email is already registered. Sign in?"; client-side validation for password length & confirm match before submit.

### 3.3 AwaitingApprovalPage (`/awaiting-approval`)

```
        ┌──────────────────────────────────────┐
        │           ⏳  (clock illustration)     │
        │     You're awaiting approval          │
        │                                       │
        │  Your account (you@firm.com) is in a  │
        │  PENDING state. An administrator must │
        │  approve it before you can sign in.   │
        │                                       │
        │  • You'll be able to log in once      │
        │    approved.                          │
        │  • API keys can't be created yet.     │
        │                                       │
        │  [ Check status ]      [ Log out ]    │
        └──────────────────────────────────────┘
```
- Explicit, honest, low-anxiety. `Check status` re-calls `/auth/me`; if now `approved`, route to `/series` with a success toast; if still pending, gentle "Still pending — check back later." `Log out` clears tokens.
- This page is the landing for any authed-but-pending user who hits a protected route (guard redirect).
- **States:** loading on status check (button spinner); error on `/auth/me` → "Couldn't reach the server, retry."

### 3.4 ApiKeysPage (`/api-keys`)

```
 API Keys                                            [ + New key ]
 Use these to push trading data via X-API-Key. Keys are shown once.
 ┌──────────────────────────────────────────────────────────────────┐
 │ NAME            PREFIX        LAST USED        CREATED       •     │
 ├──────────────────────────────────────────────────────────────────┤
 │ ingest-bot      lb_8f3a••••   2026-06-18 14:02 2026-06-01  [Revoke]│
 │ backfill-2025   lb_2c91••••   —  (never used)  2026-05-20  [Revoke]│
 └──────────────────────────────────────────────────────────────────┘
```
- **Key components:** `New key` button → name dialog → on create → **`ApiKeyCreatedModal`** (§3.10). List table: name, `prefix•••` (Fira Code), `last_used_at` (relative + absolute on hover), `created_at`, Revoke action.
- **States:**
  - *Loading:* 3 skeleton rows (animate-pulse).
  - *Empty:* "No API keys yet. Create one to start pushing data." + primary CTA (acceptance — helpful empty state, not blank).
  - *Error:* `role="alert"` banner + Retry.
  - *Revoke:* confirm popover ("Revoke `ingest-bot`? Scripts using it will get 401.") → `DELETE` → row fades to a struck-through `revoked` state or removes (acceptance J2). Uses `danger/ui`.
- **Guard:** approved-only; a pending user reaching here is redirected to `/awaiting-approval` (acceptance J3).

### 3.5 AdminUsersPage (`/admin/users`)

```
 User Approvals                          Filter: [ Pending ▾ ]  [search]
 ┌────────────────────────────────────────────────────────────────────┐
 │ EMAIL                STATUS      ROLE   REGISTERED        ACTIONS    │
 ├────────────────────────────────────────────────────────────────────┤
 │ a@firm.com           ● pending   user   2026-06-18  [Approve][Reject]│
 │ b@firm.com           ● pending   user   2026-06-17  [Approve][Reject]│
 │ c@firm.com           ✓ approved  user   2026-06-10       —           │
 │ admin@firm.com       ✓ approved  admin  2026-06-01       —           │
 └────────────────────────────────────────────────────────────────────┘
```
- **Key components:** filterable users table; status chip (pending=amber dot, approved=emerald, rejected=rose); `Approve`/`Reject` buttons on pending rows. Default filter = Pending (the actionable set).
- **Interactions:** Approve → `POST /admin/users/{id}/approve` → optimistic chip flip to approved + success toast; Reject → confirm → `…/reject`. List updates live (acceptance K2). Bulk-select checkboxes + bulk Approve/Reject (skill UX: support bulk actions for tedious one-by-one work) — optional enhancement.
- **States:** loading skeleton rows; empty (filtered Pending) → "No users awaiting approval. 🎉-free: 'All caught up.'"; error banner + retry.
- **Guard:** `RequireAdmin`; non-admins never see the nav item and are 403-redirected.

### 3.6 SeriesListPage (`/series`) — default landing

```
 Series                                                  [ + New series ]
 ┌──────────────────────────────────────────────────────────────────────┐
 │ NAME          TAG    CCY   STRATEGIES  FILLS    LAST INGEST   ACTIONS  │
 ├──────────────────────────────────────────────────────────────────────┤
 │ Alpha-Real    real   USD     4         12,481   2026-06-18  [Open][Cmp ＋]│
 │ Alpha-Sim     sim    USD     4          12,490  2026-06-18  [Open][Cmp ＋]│
 │ ETH-momentum  real   USD     1           3,002  2026-06-15  [Open][Cmp ＋]│
 └──────────────────────────────────────────────────────────────────────┘
```
- **Key components:** series table with `tag` chip (real/sim/any label — neutral chip, *not* P/L colors), `base_currency` column, counts (strategies, fills), ingestion freshness; `Open` → `/dashboard?series=:id`; `Compare +` toggles the row into a comparison tray (see below); `New series` (most ingestion is programmatic, but UI create exists per API).
- **New-series form** captures `name`, `tag`, `notes`, **`base_currency`** (ISO-4217 select, required) and **`session_tz`** (IANA tz select, required — used to derive trade dates).
- **Comparison tray:** selecting `Compare +` on 2+ rows reveals a sticky bottom tray: `Comparing: Alpha-Real ✕  Alpha-Sim ✕   [ Compare → ]` (deep-links to `/compare` preloaded). Rows with a different `base_currency` are flagged "currency mismatch — can't diff."
- **States:** loading skeleton rows; **empty** → onboarding card: "No series yet. Create one in the UI or push data with an API key." + two CTAs (`New series`, `Get an API key`); error banner.

### 3.7 SeriesDetailPage (`/series/:id`)

```
 ‹ Series / Alpha-Real     tag: real   USD · America/New_York   [ Dashboard → ]
 Notes: "live book, IB"                      Created 2026-06-01
 ┌─ Strategies ─────────────────┐  ┌─ Discovered symbols ─────────────┐
 │ momo-eth      4,102 fills     │  │ ETH-USD  BTC-USD  SOL-USD        │
 │ mr-btc        3,980 fills     │  │ ARB-USD  OP-USD  …               │
 │ basis-sol     2,201 fills     │  │ (chips, grouped by strategy on   │
 │ carry         2,198 fills     │  │  hover)                          │
 └──────────────────────────────┘  └──────────────────────────────────┘
 ┌─ Instruments (review) ───────────────────────────────────────────────┐
 │ SYMBOL    ASSET     MULT   CCY    ⚠ inferred?                          │
 │ ES        future    50     USD                                         │
 │ ETH-USD   crypto     1     USD                                         │
 │ NEW-X     equity     1     USD    ⚠ inferred — confirm/correct         │
 └───────────────────────────────────────────────────────────────────────┘
 ┌─ FX rates ───────────────────┐   Ingestion: last batch 2026-06-18 14:02
 │ EUR→USD  1.08  (12 points)   │   · 0 rejected · ⚠ 2 fills missing FX    │
 └──────────────────────────────┘
```
- **Key components:** header (name, tag, base_currency · session_tz, notes, created), Strategies list (name + fill counts), discovered Symbols as chips, **`InstrumentReviewPanel`** (highlights `inferred` instruments to confirm/correct multiplier/asset_class/currency), **`FxRatesPanel`** (view/add rates; flags `fx_missing` gaps), ingestion status summary. `Open in Dashboard` carries `?series=:id`.
- **States:** loading skeleton; empty strategies → "No data ingested yet — push fills with an API key."; inferred-instrument warning chip when any instrument needs review; error banner.

### 3.8 DashboardPage (`/dashboard`) — primary analysis screen

```
 ┌─ Controls (sticky) ───────────────────────────────────────────────────────┐
 │ Series [Alpha-Real ▾]   Level [ Account | Strategy | Symbol ]              │
 │ Strategy [momo-eth ▾]*  Symbol [ETH-USD ▾]*    Date [2026-01-01 → 06-18 ▾] │
 │ Trades [ Per-lot | Per-position ]   Returns [ All days | Active days only ]│
 └────────────────────────────────────────────────────────────────────────────┘
   *Strategy selector appears at Strategy & Symbol levels; Symbol selector at Symbol level.
   All money values display in the series' base currency; shown in the panel header.

 ┌─ Metric cards (grid) ─────────────────────────────────────────────────────┐
 │ ┌Net PnL ┐ ┌Gross PnL┐ ┌Fees┐ ┌TWR┐ ┌CAGR┐ ┌Vol┐ ┌Sharpe┐ ┌Sortino┐ ┌Calmar┐│
 │ │+$48,210▲│ │+$50,140 │ │$1.9k│ │14.2%│ │11.8%│ │9.4%│ │ 1.84 │ │ 2.40 │ │1.31 ││
 │ └─────────┘ └─────────┘ └────┘ └───┘ └────┘ └───┘ └──────┘ └───────┘ └─────┘│
 │ ┌Max DD┐ ┌Win rate┐ ┌Profit factor┐ ┌Payoff┐ ┌Expectancy┐ ┌Max consec L┐    │
 │ │-$9.1k│ │ 57.2%  │ │    1.92     │ │ 1.93 │ │  +$184   │ │     4      │    │
 │ └──────┘ └────────┘ └─────────────┘ └──────┘ └──────────┘ └────────────┘    │
 │ ┌Avg win┐ ┌Avg loss┐ ┌Largest W/L┐ ┌Trades┐ ┌Avg hold┐ (＋α/β/IR if benchmark)│
 │ │+$612   │ │ -$318  │ │+$4.1k/-$2k│ │ 1,204│ │ 3h 12m │                      │
 │ └────────┘ └────────┘ └───────────┘ └──────┘ └────────┘                      │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─ Equity curve  [realized] ────────────┐ ┌─ Drawdown  [realized] ──────────┐
 │   $                                    │ │ 0 ─────────────────────────────  │
 │      ╱‾‾‾‾╲   ╱‾‾‾‾‾                    │ │   ╲      ╱╲                      │
 │   ╱‾      ╲_╱                           │ │    ╲___╱  ╲___ (filled to 0)    │
 │  ────────────────────────────► time    │ │  -$ peak-to-trough magnitude     │
 └────────────────────────────────────────┘ └─────────────────────────────────┘
   [stepped line, steps at close ts]          [area below zero baseline]
```

- **Key components:** `SeriesPicker`(single-select variant or `series` dropdown), `LevelSelector` (segmented control), conditional `strategy`/`symbol` dropdowns, `DateRangePicker`, **`TradeViewSelector`** (per-lot/per-position → `trade_view`), **active-days toggle**; `MetricCardGrid` of `MetricCard`s; `EquityChart` (Absolute/Indexed toggle backed by `equity_curve.indexed_return`); `DrawdownChart`; `TradeStatsTable` (expandable). All values are **backend-computed**; the UI only formats them in the base currency / active P-L scheme. `RealizedBadge` sits on equity & drawdown headers and the Net PnL card.
- **"Realized" honesty (acceptance M3):** every equity/drawdown panel header carries `RealizedBadge` = a small `info`-colored pill reading **"REALIZED"** with a tooltip: *"Cumulative realized PnL only. Open positions are not marked to market; unrealized swings are not shown."* The equity card title reads "Realized PnL". The **Max DD** card adds a stronger caveat when `flags.open_positions_exist`: *"Drawdown reflects closed trades only; open-position risk is not captured."*
- **Symbol-level rule (acceptance M4):** when `Level = Symbol`, the grid **omits** return-based cards (TWR, CAGR, vol, Sharpe, Sortino, Calmar, Max DD, α/β/IR) and **hides EquityChart/DrawdownChart**; instead shows PnL/trade-stat cards (Net/Gross PnL, fees, win rate, avg win/loss, profit factor, payoff, expectancy, hold, count) **plus a "Contribution to strategy"** card (e.g. "ETH-USD = 38% of momo-eth PnL", with a tiny inline bar). A muted note explains: *"Symbols have no capital base, so return%/Sharpe don't apply."*
- **Account/Strategy level:** full set — equity curve (absolute + indexed), drawdown, TWR/CAGR/vol/Sharpe/Sortino/Calmar/max DD + expanded trade stats; α/β/IR cards appear only when a benchmark is uploaded.
- **States:**
  - *Loading:* skeleton cards (shimmer) + chart placeholders with reserved height (prevent layout jump).
  - *Empty (no closed round-trips in range):* charts replaced by a centered message "No realized trades in this range. Open positions aren't shown (realized-only)." Cards show `—`.
  - *Low sample (`flags.low_sample`):* Sharpe/Sortino/Calmar cards show an amber `warning` footnote "low sample — interpret with care"; when `flags.sharpe_suppressed`, those cards show `—` with an "insufficient data" tooltip (driven by response flags, not recomputed).
  - *FX gap (`flags.fx_missing`):* an amber banner notes some fills were excluded for missing FX rates, with a link to add rates.
  - *Error:* `role="alert"` banner above the grid + Retry; charts show inline error tile.
- **Interactions:** changing any selector refetches `GET /series/{id}/metrics` (debounced for date range); URL reflects state (`?series=&level=&strategy=&symbol=&from=&to=&trade_view=&active_days_only=`) so views are shareable/bookmarkable. Charts share a synchronized x-hover (hovering equity highlights same timestamp on drawdown).

### 3.9 ComparisonPage (`/compare`)

```
 ┌─ Pick series + range ─────────────────────────────────────────────────────┐
 │ Series  [Alpha-Real ✕] [Alpha-Sim ✕] [ + add ▾]    Date [01-01 → 06-18 ▾]  │
 │                                              [ Compare ]  (disabled if <2)  │
 └────────────────────────────────────────────────────────────────────────────┘
 Legend:  ■ A Alpha-Real (solid)   ■ B Alpha-Sim (dashed)

 ┌─ Account metrics (side-by-side) ──────────────────────────────────────────┐
 │ METRIC          A Alpha-Real     B Alpha-Sim       Δ (A−B)                 │
 │ Realized PnL    +$48,210         +$50,990          −$2,780 ▼              │
 │ Max DD          -$9,100          -$7,400           worse ▲                 │
 │ Sharpe          1.84             1.96              −0.12                    │
 │ Win rate        57.2%            58.0%             −0.8pp                   │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─ Overlaid equity curves  [realized] ──────────────────────────────────────┐
 │  $        ___A (blue solid)                                                │
 │        __/   ╱‾‾B (amber dashed)                                           │
 │     __/   __/                                                              │
 │  ─────────────────────────────────────────────► time                      │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌─ Per-trade diff (matched fill pairs: same side, nearest ts within tolerance) ─┐
 │ TIME        SYMBOL   SIDE  A price   B price  Δprice(slip)  Δtiming Δqty Δfee │
 │ 06-12 09:31 ETH-USD  buy   3,012.5   3,010.0   +2.50 (+0.08%)  +4s   0  +0.10 │
 │ 06-12 11:02 BTC-USD  sell  ...       ...       ...             ...   ... ...  │
 └────────────────────────────────────────────────────────────────────────────┘
 Unmatched: strategy "carry" exists only in A — shown standalone, no counterpart.
```

- **Key components:** `SeriesPicker` (multi-select, ≥2, submit disabled below 2 per acceptance N1), `DateRangePicker`, side-by-side `MetricCardGrid`/comparison table (account always; strategy where names match; symbol where matched), single `EquityChart` in **overlay mode**, `PerTradeDiffTable`, and unmatched-section callouts.
- **Layout for 2 vs 3+ series:** for 2 series use the Δ column table (above). For 3+ series, switch to a **column-per-series** card matrix (one MetricCardGrid column per series, no pairwise Δ — instead highlight best/worst per row with subtle ▲/▼ on the leader). Legend chips always show color + dash pattern.
- **Matched vs unmatched (acceptance N5):** matched strategies/symbols render in the comparison block; unmatched render in a clearly separated "Standalone (no counterpart)" group with a muted "no comparison" tag — never silently dropped.
- **States:** 
  - *Pre-submit:* empty result area with instruction "Pick at least 2 series and press Compare."; Compare disabled <2.
  - *Loading:* full-area skeleton (cards + chart + table).
  - *Empty result:* "No overlapping trades to diff in this range" for the diff table while metric cards may still render.
  - *Error / 404 (a series isn't yours):* `role="alert"` "One or more selected series are unavailable." (matches isolation H2 — whole request rejected).
- **Interactions:** stateless POST `/comparisons`; results not persisted (no history UI). Re-running with same inputs is idempotent. Hovering a diff row can highlight the corresponding x-position on the overlaid equity chart.

### 3.10 ApiKeyCreatedModal (copy-once)

```
        ┌──────────────────────────────────────────────┐
        │  🔑  API key created                          │
        │  Copy it now — you won't be able to see it    │
        │  again.                                       │
        │                                               │
        │  ┌────────────────────────────────────┐ [Copy]│
        │  │ lb_8f3a2c91d4...e77b   (Fira Code)  │       │
        │  └────────────────────────────────────┘       │
        │                                               │
        │  ⚠ This is the only time the full key is shown.│
        │                                               │
        │              [ I've copied it — done ]        │
        └──────────────────────────────────────────────┘
```
- **Behavior (acceptance J1):** modal is the *only* surface that ever shows the full key (from the 201 response). The full key is held in component state only — never written to the query cache, URL, or storage. `Copy` writes to clipboard + shows a transient "Copied ✓" inline (success color). 
- **Dismissal friction:** the primary button is "I've copied it — done" (not a bare ✕) and there's a confirm if closed without copying ("Close without copying? You can't retrieve this key later."). After close, the value is discarded from memory and the list shows only the `prefix`.
- **Accessibility:** focus trapped in modal, focus lands on the key field (pre-selected for easy manual copy), `Esc` triggers the same "without copying?" guard, `role="dialog"` + `aria-modal`, labelled by title.

---

## 4. Data Visualization Design

Library = **Recharts** (per spec); chart guidance from the skill: *Trend-over-time → Line chart; multi-series → distinct colors + pattern overlays for colorblind; provide data-table alternative.*

### 4.1 EquityChart (realized PnL curve)

- **Type:** **stepped line** (`type="stepAfter"`) — the curve only changes at close timestamps, so a stepped line is *honest* about the discrete realized bookings (a smooth line would imply continuous mark-to-market, which we explicitly don't have).
- **Axes:** X = time (close timestamps, formatted by range: intraday `HH:mm`, multi-day `MM-DD`, long `YYYY-MM`); Y = cumulative realized PnL in account currency, Fira Code tabular ticks, `0` gridline emphasized (`border/strong`).
- **Color:** single-series = `accent/primary`; the area under the line uses a 12–15% opacity gradient of the same hue (purely decorative, not semantic). The whole panel carries `RealizedBadge`.
- **Tooltip:** dark `surface-2` card: timestamp (bold), "Realized PnL: +$X" (P/L-colored value), and "Δ since prev close" — plus a persistent footer line "realized only" to keep the caveat in view.
- **Reference markers:** a faint horizontal line at the running peak (so drawdown is visually motivated). Optional: dots at each close on hover.
- **Convey "realized":** (1) `RealizedBadge` pill in header, (2) stepped (not smooth) geometry, (3) tooltip footer text, (4) axis title "Realized PnL".

### 4.2 DrawdownChart

- **Type:** **area chart anchored to a 0 baseline, filling downward** (`drawdown/fill` rose @ ~18%), values ≤ 0 (drawdown as negative magnitude from running peak). 0 = "at high-water mark."
- **Axes:** shared X with EquityChart (synchronized hover/zoom); Y in currency (or % of peak — show currency by default, toggle to % available at account/strategy where a base exists).
- **Max-DD marker:** annotate the trough with a small label "Max DD −$9.1k" and a vertical guide.
- **Tooltip:** "Drawdown: −$X (−Y% from peak)", timestamp, realized footer.
- Color is rose but **never the only cue** — the geometry (below-zero area + downward direction) carries meaning; a `▼` accompanies the max-DD label.

### 4.3 Overlaid equity curves (Comparison)

- One `EquityChart` in overlay mode: one stepped line per series using the **series overlay palette** (§1.2) — color **and** dash pattern per series (blue-solid A, amber-dashed B, purple-dotted C, …). No area fills in overlay mode (would muddy). 
- **Legend:** top of chart, chip = swatch + dash sample + series name; clickable to toggle a series on/off; hover dims the others.
- **Tooltip:** unified (all series at hovered x), each row color-keyed with its value (P/L-colored numbers), sorted descending; header timestamp; realized footer.
- **Normalization toggle:** "Absolute $" vs "Indexed to range start (=0)" so series with different capital bases are visually comparable; default absolute.
- **Colorblind safety:** because dash patterns + on-hover labels + a data-table fallback exist, the overlay is legible without relying on hue.

### 4.4 PerTradeDiffTable

- **Structure:** one row per **matched fill pair** (matched by same side + nearest timestamp within a tolerance window, per design spec §7); columns: Date/time, Symbol, Side, then per-series sub-columns (price, qty, total fee, ts) or — for 2 series — a compact A | B | Δ layout. Diff columns: **price slippage** (abs + %, signed from the **baseline series'** perspective), **timing** (`Δ seconds`, +later/−earlier), **qty diff**, **fee diff**. An **Unmatched** disclosure lists fills on each side with no counterpart (never silently dropped). The table is **paginated** (backend-paged).
- **Encoding:** numeric cells Fira Code, tabular-nums, right-aligned; slippage/fee deltas use `pnl/gain`/`pnl/loss` **plus** sign and ▲/▼ glyph; zero diffs are muted neutral, not colored.
- **Behavior:** sticky header; sortable by any diff column (e.g. sort by largest |slippage|); filter by symbol/strategy; column to pick which series is the "reference" for signing slippage. Horizontal scroll wrapper for many series (skill: `overflow-x-auto`). Row hover cross-highlights the equity chart x-position.
- **Empty:** "No fill pairs matched (same side, within the time tolerance) in this range." (not a blank table).
- **Accessibility fallback:** this table *is* the accessible, exact-number complement to the charts (skill: provide data-table alternative). A "Download CSV" affordance is offered.

### 4.5 General chart rules (from skill)

- Always render a legend when >1 series; add pattern/dash overlays for colorblind users; keep ≤ 8 series (overlay palette caps at 6 + "+N more" overflow that opens a manage-series popover).
- Reserve chart container height before data loads (no layout jump); skeleton chart while loading.
- Respect `prefers-reduced-motion`: disable the line draw-in animation; render statically.
- Tooltips on hover **and** keyboard focus (arrow-key scrubbing of the active series).

---

## 5. Component Inventory

Mapped directly to `frontend/src/components/*` and `pages/*` in the structure doc. ✓ = already enumerated; ＋ = additional component this UX introduces.

| Component | Status | Role in this design |
|-----------|--------|---------------------|
| `LevelSelector` | ✓ | Segmented control: Account \| Strategy \| Symbol; drives card/chart set & symbol-level hiding |
| `TradeViewSelector` | ＋ | Per-lot \| Per-position segmented control → `trade_view` query param |
| `InstrumentReviewPanel` | ＋ | On SeriesDetail: lists instruments, highlights `inferred=true` ones to confirm/correct (asset_class, multiplier, currency) |
| `FxRatesPanel` | ＋ | On SeriesDetail: view/add FX rates; surfaces `fx_missing` gaps |
| `DateRangePicker` | ✓ | `date_from`/`date_to`; presets (1M/3M/YTD/All); inclusive-start/inclusive-end per spec |
| `MetricCard` | ✓ | Label (uppercase) + Fira-Code value + signed Δ + ▲/▼; optional `RealizedBadge`; optional amber low-sample footnote |
| `MetricCardGrid` | ✓ | Responsive grid of `MetricCard`; column-per-series in comparison |
| `EquityChart` | ✓ | Stepped realized-PnL line; single & **overlay** modes; legend; sync hover |
| `DrawdownChart` | ✓ | Below-zero area from running peak; max-DD marker |
| `TradeStatsTable` | ✓ | Win rate, avg win/loss, profit factor, hold, count (all levels) |
| `PerTradeDiffTable` | ✓ | Aligned diff rows; slippage/timing/qty/fee; sortable; CSV export |
| `ApiKeyCreatedModal` | ✓ | Copy-once full-key modal with dismissal guard |
| `SeriesPicker` | ✓ | Single-select (Dashboard) & multi-select ≥2 (Comparison) |
| `RealizedBadge` | ✓ | "REALIZED" info pill + tooltip; on equity/drawdown headers & Realized-PnL card |
| `AppShell` / `Sidebar` / `Topbar` | ＋ | Authenticated layout (§2.1); reads from `App.tsx` outlet |
| `ThemeToggle` | ＋ | Dark/light switch in user menu; persists choice |
| `PnlColorToggle` | ＋ | P/L color-scheme switch (`red-up` default / `green-up`) in user menu; persists `pnl_color_scheme`; recolors all `pnl/gain`·`pnl/loss` tokens at runtime (§1.2) |
| `StatusChip` | ＋ | pending/approved/rejected (admin) and real/sim tag (series) — neutral palette for tags |
| `RoleChip` | ＋ | USER/ADMIN in user menu |
| `ConfirmPopover` | ＋ | Inline confirm for revoke key / reject user (destructive) |
| `EmptyState` | ＋ | Reusable icon + message + CTA (series/keys/admin/charts) |
| `SkeletonRows` / `SkeletonCard` / `SkeletonChart` | ＋ | Loading placeholders with reserved height |
| `AlertBanner` | ＋ | `role="alert"` error/success banner |
| `Toast` | ＋ | Transient success (key copied, user approved) |
| `MetricComparisonRow` | ＋ | A \| B \| Δ row for 2-series comparison table |
| `ContributionCard` | ＋ | Symbol-level "contribution to strategy" with inline bar |
| `CompareTray` | ＋ | Sticky tray on SeriesList for staging a comparison |
| `CopyButton` | ＋ | Clipboard copy w/ "Copied ✓" feedback (keys, prefixes) |

No new pages beyond the structure doc's `pages/*`.

---

## 6. Accessibility & States

### 6.1 Contrast
- All text meets **WCAG AA (≥4.5:1)**; dark mode targets AAA where feasible (the chosen style is rated AAA). `text/muted` floors at slate-400 (dark)/slate-600 (light) — never lighter (skill rule). Focus ring `#93C5FD` 2px + 2px offset on every interactive element, visible in both themes.

### 6.2 Colorblind-safe P/L encoding (no red/green-only)
P/L is **always** triple-encoded: **(1) color**, **(2) sign** (`+`/`−`), **(3) glyph** (`▲`/`▼`). Loss uses rose (not pure red) and gain emerald; both chosen with deuteranopia/protanopia in mind. Series overlays add **dash patterns**, never hue alone. Drawdown conveys meaning by **geometry** (below-zero area) independent of color. The `PerTradeDiffTable` provides exact numbers as a non-color channel.

### 6.3 Keyboard navigation
- Logical tab order matches visual order; sidebar nav is a list of links (arrow-navigable); segmented `LevelSelector` is a radio group (arrow keys). Modals trap focus and restore it on close. Tables: header sort buttons are focusable; charts expose keyboard scrubbing (← →) and a focusable legend. All icon-only buttons have `aria-label`. Forms use `<label for>`.

### 6.4 Loading / empty / error patterns (consistent everywhere)
- **Loading:** skeletons with reserved dimensions (no content jump); buttons disable + spinner during async (skill: disable button during async).
- **Empty:** `EmptyState` with message + primary action — never a blank pane (skill rule).
- **Error:** `AlertBanner` with `role="alert"`/`aria-live="assertive"` placed near the problem + Retry; never color-only (skill: errors must be announced, not red-border-only). Field-level validation errors sit beneath the field with text + icon.
- **Reduced motion:** honor `prefers-reduced-motion` — disable chart draw-in, skeleton shimmer becomes a static tint, transitions drop to opacity-only.

### 6.5 Other
- No emojis as UI icons — use an SVG set (Lucide/Heroicons) at a consistent 24×24 viewBox. `cursor-pointer` on all clickable rows/cards. Hover feedback via color/opacity, never layout-shifting scale. Transitions 150–300ms.

---

## 7. Responsive Behavior

**Desktop-first** (this is a data-dense analytics tool; primary target ≥1280px). Degradation:

| Breakpoint | Behavior |
|-----------|----------|
| **≥1440px (default)** | Full layout: 240px sidebar, MetricCardGrid 4–6 cols, equity + drawdown side-by-side, wide diff table. |
| **1024–1439px** | MetricCardGrid 3–4 cols; equity & drawdown **stack vertically** (full-width each); sidebar may auto-collapse to 64px icons. |
| **768–1023px (tablet)** | Sidebar becomes a collapsible drawer (hamburger); cards 2 cols; controls bar wraps to two rows; charts full-width stacked; tables get `overflow-x-auto`. |
| **<768px (mobile)** | Single column; cards 1–2 cols; sidebar = off-canvas drawer; Dashboard controls collapse into a "Filters" sheet; **PerTradeDiffTable** switches to a stacked card-per-row layout (skill: card layout for narrow tables) OR retains horizontal scroll with a sticky first column — diff table is heavy, so we present a **summary list + "open full table" on a dedicated scrollable view**. Charts remain but legend moves below. |

Mobile is **supported, not optimized**: a quant doing serious comparison is expected on desktop. We guarantee no horizontal page scroll, ≥16px body text on mobile, ≥44×44px touch targets, and that every screen remains *usable* (read metrics, read a single equity curve) on a phone — but multi-series overlay + per-trade diff are explicitly "best on a larger screen," with a non-blocking hint banner on small viewports.

---

## 8. Risks & Decisions

The three open questions originally flagged here are now **RESOLVED**:

1. **P/L color convention — RESOLVED.** The P/L color scheme is a **user preference** (`pnl_color_scheme`, §1.2), **defaulting to `red-up`** (red = gain/up, green = loss/down — East-Asian convention). Users can switch to `green-up` (US/EU) via `PnlColorToggle` in the user menu. Implemented through scheme-resolved semantic tokens (`pnl/gain`/`pnl/loss`) so a single preference flips all data coloring consistently; UI status colors stay hue-fixed. Triple-encoding (color + sign + glyph) keeps both schemes unambiguous.

2. **Sharpe/Sortino low-sample threshold — RESOLVED.** A metric is marked "low sample" (amber `warning` footnote on the card + tooltip "Computed on limited data; interpret with caution") when **either**: round-trips in the selected range **< 20**, **or** active days (days with ≥1 close) **< 30**. Below **5** round-trips, the Sharpe/Sortino value is **suppressed** entirely (show "—" with "insufficient data" tooltip) rather than printing a misleading number. These thresholds live in `core/config.py` as `SHARPE_MIN_SAMPLE_TRADES=20`, `SHARPE_MIN_ACTIVE_DAYS=30`, `SHARPE_SUPPRESS_BELOW=5` so they're tunable without code change. *(Note for engineering: surface these counts in the metrics API response so the frontend can apply the badge without recomputing.)*

3. **3+ series comparison density — RESOLVED.** Comparison uses a **selectable baseline series**. With exactly 2 series, the table shows `A | B | Δ` (B−A) automatically. With 3+ series, a **"Baseline" selector** (defaulting to the first-picked series) signs every Δ relative to that baseline; each non-baseline series gets its own Δ-vs-baseline sub-columns, and the overlaid equity chart marks the baseline with a heavier solid line. Best/worst per metric are still highlighted. The baseline is also the reference for `PerTradeDiffTable` slippage signing (§4.4). This replaces the earlier ambiguous pairwise approach.

**Standing decisions (no action):**

4. **"Realized-only" comprehension.** Honest labeling is core to product integrity. Four cues (RealizedBadge, stepped geometry, tooltip footer, axis title) plus a **one-time onboarding tooltip on first Dashboard visit** mitigate the risk that users read the realized equity curve as full performance.
5. **Tag is just a label.** real/sim render as neutral `StatusChip`s (not trusted semantics), consistent with spec §1 (tag-agnostic comparison). No UX treats "sim" as lesser.
6. **`ui-ux-pro-max` design-system script** failed under Python 3.9 (f-string-with-backslash in `design_system.py:443`); ran fine under Python 3.12. Skill-tooling note for the environment, not a product risk.
