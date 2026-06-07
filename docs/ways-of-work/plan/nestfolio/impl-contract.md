# Nestfolio — Implementation Contract (read before building any feature)

Shared conventions so every feature fits together. **Follow exactly.**

## Stack reality (Next.js 16.2.7 — NOT older Next)

- **Async request APIs**: `await cookies()`, `await headers()`, `await params`,
  `await searchParams`. Route handler params: `{ params }: { params: Promise<{ id: string }> }`.
- **Routing middleware** is `src/proxy.ts` (already set up — do not touch).
- **`fetch` is NOT cached by default.** For mutations in Server Actions, call
  `revalidatePath('/route')` from `next/cache` after writing.
- **Server Actions**: file starts with `"use server"`; forms call them via `action={fn}`.
- Prefer **Server Components + Server Actions** for data. Use Client Components only
  for interactivity (forms with local state, charts, dialogs).

## Auth & data access

- User-scoped reads/writes (Server Components, Actions, Route Handlers):
  `import { createClient } from "@/lib/supabase/server"` then `await createClient()`.
  RLS scopes rows to the user automatically — but ALWAYS set `user_id` on insert
  (get it from `(await supabase.auth.getUser()).data.user!.id`).
- Background/trusted writes only (wallet sync, cron, market-data tables):
  `import { createServiceClient } from "@/lib/supabase/service"` (bypasses RLS —
  you MUST pass explicit `user_id`).
- Every (app) page can assume an authenticated user (the group layout guards it).

## Types & formatting (USE THESE — do not reinvent)

- DB row types: `@/lib/types` (Account, Portfolio, Holding, Transaction, Liability,
  Snapshot, Wallet, WalletTransfer, TradeEvent, CostBasis, PriceHistory, LivePrice
  + enums). Mirrors the SQL exactly.
- Formatting: `@/lib/format` → `formatUSD`, `formatQty`, `formatPct`,
  `formatRatioPct`, `pnlColor(value)` (green/red/neutral text class), `formatDate`.
- `cn()` from `@/lib/utils` for class merging.

## UI building blocks

- shadcn (style "base-nova", primitives from `@base-ui/react`) already installed in
  `@/components/ui/*`: button, card, input, label, select, dialog, table, badge,
  tabs, separator, skeleton, sonner, dropdown-menu, sidebar, tooltip, sheet.
- Page scaffold: `import { PageHeader } from "@/components/page-header"` →
  `<PageHeader title description>{actions}</PageHeader>`.
- Toasts: `import { toast } from "sonner"`. Charts: `recharts`. Icons: `lucide-react`.
- App chrome (sidebar) already exists in `@/components/app-shell`; nav in
  `@/components/nav` (NAV_ITEMS). Add a nav item only if your feature adds a route.
- **Every feature page lives under the `(app)` route group**:
  `src/app/(app)/<route>/page.tsx`. URLs have no `(app)` prefix.

## Design language (finance-grade, calm, legible)

- Numbers: tabular, right-aligned in tables, sign-aware color (green gain / red loss
  via `pnlColor`). Currency via `formatUSD`. Never show raw floats.
- Layout: cards for grouped metrics, generous spacing, `text-muted-foreground` for
  secondary text. Mirror patterns from Mint / Kubera / brokerage dashboards:
  big headline number + delta, then breakdown.
- Empty states: a short explainer + the primary action (e.g. "No accounts yet — add
  your first"). Loading: `Skeleton`. Errors: inline, never a blank screen.
- Keep it accessible: labels on inputs, buttons have text or aria-label.

## Core data model (agreed semantics — build to this)

- **Accounts** = containers of cash-like value. **Transactions** move `amount`
  (USD) from `source_account` → `dest_account`. An account's cash balance =
  Σ(amount where dest = account) − Σ(amount where source = account). Use the
  `external` account type as the outside-world source/sink (salary in, expense out).
- **Holdings** = asset positions (units: BTC, grams, shares), tagged `source`
  (`manual` | `wallet`) with optional `wallet_ref`. Quantity lives on the holding
  (wallet sync writes these; manual ones are user-entered). Valued via prices.
- **Net worth** (F5) = Σ account cash balances + Σ holding market values − Σ liabilities.
- **Portfolios** group holdings; nest via `parent_id` (flexible depth). `target_pct`
  is **relative to the parent** (siblings sum to 100%).

## Conventions

- Pure business logic (balance derivation, rollup, rebalance, PnL) goes in plain,
  dependency-free functions under `src/lib/<domain>/` with a colocated
  `*.test.ts` (vitest, node env). These are the high-value tests — make them real.
- Run `npx tsc --noEmit` and `npm test` before declaring done. No `any` unless
  unavoidable; prefer the shared types.
- Keep comments at the density of existing files: a short "why" above non-obvious code.
- Do NOT edit: `src/proxy.ts`, `src/lib/supabase/*`, `src/lib/env.ts`, migrations,
  `src/components/ui/*`, the root `layout.tsx`. Add nav items in `src/components/nav.ts`
  only for your own new route.

## Decisions already made (don't re-ask)

- Provider = Moralis (BSC), prices via yahoo-finance2 (+ Finnhub/Twelve Data
  fallback). Never price tokenized stocks by DEX price — use the equity feed.
- Token→ticker: strip trailing `on` (NVDAon→NVDA) + small override map.
- Cost basis = average cost; DELIVERY priced at historical equity price (Option A).
- Snapshot frequency = daily (cron) + on transaction. Auth = email+password (done).
