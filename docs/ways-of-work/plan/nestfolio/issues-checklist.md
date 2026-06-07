# Nestfolio MVP — Issue Creation Checklist

Ready-to-create GitHub issues. IDs (E1, F1, S2.1…) are placeholders; replace the
`#refs` with real issue numbers after creation. Create top-down: Epic → Features
→ Stories/Enablers/Tests, so parents exist before you link children.

Legend: 🟦 Epic · 🟩 Feature · 🟨 Story · 🟧 Enabler · 🟥 Test

---

## Pre-Creation Checklist
- [ ] Spec reviewed (`thoughts/shared/specs/2026-06-07-nestfolio.md`)
- [ ] Labels created (see project-plan §6)
- [ ] Project board + custom fields configured
- [ ] Milestone "Nestfolio MVP" created

---

## 🟦 E1 — Epic: Nestfolio MVP
**Labels:** `epic` `priority-critical` `value-high` · **Estimate:** XL (~133 pts)

```
# Epic: Nestfolio — Personal Wealth Command Center (MVP)

## Description
Single-user wealth tracker: read-only BNB wallet sync + manual assets/liabilities,
unified Account/Transaction model, flexibly nested portfolios with all-levels
rebalancing, net-worth dashboard, history, projection, and monthly review.

## Business Value
- Goal: one source of truth for the user's whole financial life.
- Success: dashboard <2s, net worth reconciles, rebalancing advice at every level.
- Impact: answers "how much am I worth / where / what changed / what next".

## Features
- [ ] #F1 Platform Foundation & Auth
- [ ] #F2 Core Ledger / Transaction Engine
- [ ] #F3 Portfolios, Sources & Allocation
- [ ] #F4 BNB Wallet Sync & Pricing
- [ ] #F5 Insights & Dashboard
- [ ] #F6 Cost Basis & PnL

## Definition of Done
- [ ] All features delivered, integration tested
- [ ] Net worth = assets − liabilities verified
- [ ] Rebalancing math validated at multiple depths
- [ ] RLS enforced on all tables
```

---

## 🟩 F1 — Platform Foundation & Auth
**Labels:** `feature` `priority-critical` `value-high` `infrastructure` · **Epic:** #E1 · **Estimate:** M (16)
**Blocked by:** none · **Blocks:** F2, F3, F4, F5

- [ ] 🟧 **EN1.1** Next.js (App Router) scaffold + Vercel project + env config — **3**
- [ ] 🟧 **EN1.2** Supabase schema (core + sync/PnL persistence: wallets, wallet_transfers, trade_events, cost_basis, price_history, live_prices) + RLS — **8**
- [ ] 🟧 **EN1.3** Google OAuth via Supabase Auth + session/middleware — **3**
- [ ] 🟨 **S1.1** Sign in with Google so my data is private — **2**
- [ ] 🟥 **T1.1** Auth flow + RLS isolation E2E — included

**S1.1 acceptance:**
- [ ] Google sign-in works; session persists.
- [ ] Unauthenticated users redirected to login.
- [ ] A user can only read/write their own rows (RLS verified).

---

## 🟩 F2 — Core Ledger / Transaction Engine
**Labels:** `feature` `priority-critical` `value-high` `backend` · **Epic:** #E1 · **Estimate:** L (21)
**Blocked by:** F1 · **Blocks:** F3, F4, F5

- [ ] 🟧 **EN2.1** Account entity + CRUD API — **3**
- [ ] 🟧 **EN2.2** Transaction engine: types income/buy/sell/transfer/expense, source→dest semantics — **8**
- [ ] 🟧 **EN2.3** Holding entity + balance derivation from transactions — **5**
- [ ] 🟨 **S2.1** Create accounts (cash, gold, wallet, stock) — **2**
- [ ] 🟨 **S2.2** Log a transaction (salary, buy, sell, transfer) — **3**
- [ ] 🟨 **S2.3** Log a categorized expense — **2**
- [ ] 🟨 **S2.4** Add a free-text note to any transaction (captures reasoning) — **1**
- [ ] 🟥 **T2.1** Engine unit tests: balances reconcile across all types — included

**Key acceptance:**
- [ ] Every transaction moves value source→dest; balances always reconcile.
- [ ] Expenses carry a category; monthly breakdown derivable.
- [ ] Notes persist and display on the transaction.

---

## 🟩 F3 — Portfolios, Sources & Allocation
**Labels:** `feature` `priority-high` `value-high` `fullstack` · **Epic:** #E1 · **Estimate:** L (26)
**Blocked by:** F2 · **Blocks:** F5

- [ ] 🟧 **EN3.1** Portfolio entity, self-referential parent (flexible depth) + recursive value rollup — **8**
- [ ] 🟧 **EN3.2** Asset source field (ON_CHAIN | MANUAL) + wallet_ref on holdings — **3**
- [ ] 🟧 **EN3.3** Allocation target model + recursive drift/rebalance engine (all levels) — **8**
- [ ] 🟨 **S3.1** Create nested portfolios of any depth — **3**
- [ ] 🟨 **S3.2** Assign synced/manual holdings into portfolios — **2**
- [ ] 🟨 **S3.3** Set target % per portfolio at any level — **2**
- [ ] 🟨 **S3.4** See drift + exact buy/sell suggestions per level — included in EN3.3
- [ ] 🟥 **T3.1** Rollup (depth ≥3) + rebalancing math tests — included

**Key acceptance:**
- [ ] Portfolio tree depth ≥3 rolls up correct totals.
- [ ] Targets settable at any level; drift shown vs actual.
- [ ] Suggested trades bring each level to target within rounding.
- [ ] Resolve Open Q #5: child targets relative-to-parent vs absolute.

---

## 🟩 F4 — BNB Wallet Sync & Pricing
**Labels:** `feature` `priority-high` `value-high` `backend` `integration` · **Epic:** #E1 · **Estimate:** L (25)
**Blocked by:** F1, F2 · **Blocks:** F5, F6

- [ ] 🟧 **EN4.1** Provider integration (**Moralis** free tier) behind `WalletProvider`: BNB + BEP20 balances + transfer history — **5**
- [ ] 🟧 **EN4.2** Incremental sync (cursor + reorg overlap) + persist raw transfers + unassigned bucket — **5**
- [ ] 🟧 **EN4.3** `PriceProvider`: equity prices (yahoo-finance2, live+historical) + gold/crypto; `price_history` (immutable) + `live_prices` (TTL) caches — **5**
- [ ] 🟧 **EN4.4** Tokenized-stock resolution: Ondo `…on` token → equity ticker map (+ manual override) — **2**
- [ ] 🟧 **EN4.5** Async sync orchestrator: on-open heavy (delta) + light (live) refresh; read-from-DB + revalidate — **5**
- [ ] 🟨 **S4.1** Paste a public BNB address and sync balances — **3**
- [ ] 🟥 **T4.1** Sync integration test (mock provider) + graceful-failure path — included

**Validated decisions (2026-06-07, real wallet):**
- Provider = **Moralis** (Etherscan V2 is NOT free for BSC). Resolves Open Q #2.
- Tokenized stocks = **Ondo** BEP-20, `…on` suffix. Resolves Open Q #4.
- **Never price a tokenized stock by its DEX price** (overstated ~2.5×); use the equity feed.

**Key acceptance:**
- [ ] Valid address → balances + USD appear (USD via PriceProvider, not token DEX price).
- [ ] No signature/login to wallet; only public address stored.
- [ ] Synced tokens land in unassigned bucket for assignment.
- [ ] Sync failure shows last-known balances + error, never a blank dashboard.

---

## 🟩 F5 — Insights & Dashboard
**Labels:** `feature` `priority-high` `value-high` `frontend` · **Epic:** #E1 · **Estimate:** L (29)
**Blocked by:** F2, F3, F4 · **Blocks:** none

- [ ] 🟧 **EN5.1** Snapshot job + storage (default daily cron; frequency = Open Q #1) — **5**
- [ ] 🟧 **EN5.2** Net-worth aggregation service (assets − liabilities, by portfolio) — **5**
- [ ] 🟨 **S5.1** Net Worth Dashboard as landing screen (net worth + MoM change) — **5**
- [ ] 🟨 **S5.2** Track liabilities; see them reduce net worth — **3**
- [ ] 🟨 **S5.3** Net-worth history line chart (from snapshots) — **3**
- [ ] 🟨 **S5.4** Asset-allocation breakdown pie — **2**
- [ ] 🟨 **S5.5** 5–10yr future projection (conservative/expected/optimistic) — **3**
- [ ] 🟨 **S5.6** Auto monthly wealth review (change, winner/loser, salary vs gains) — **3**
- [ ] 🟥 **T5.1** Aggregation + projection unit tests + dashboard E2E — included

**Key acceptance:**
- [ ] Landing screen shows net worth, MoM change, asset/liability bars, breakdown pie.
- [ ] History chart renders from stored snapshots.
- [ ] Projection uses savings rate + assumed returns (compound growth).
- [ ] Monthly review auto-generates at month end.

---

## 🟩 F6 — Cost Basis & PnL
**Labels:** `feature` `priority-high` `value-high` `backend` `integration` · **Epic:** #E1 · **Estimate:** M (16)
**Blocked by:** F4 · **Blocks:** F5 (dashboard shows PnL)

- [ ] 🟧 **EN6.1** Transaction-leg classifier (2-leg trade / 1-leg delivery / send) + cash reconciliation guard — **5**
- [ ] 🟧 **EN6.2** Cost-basis ledger (average cost; Option A = historical equity price at delivery) — **5**
- [ ] 🟧 **EN6.3** PnL engine: realized / unrealized / total + portfolio rollup — **3**
- [ ] 🟨 **S6.1** See realized/unrealized/total PnL per holding and overall — **3**
- [ ] 🟥 **T6.1** PnL math + reconciliation tests — included

**Validated findings (2026-06-07, real wallet):**
- Cost basis is mostly **off-chain** (positions arrived as 1-leg deliveries paid via Binance) → price each delivery at the historical equity price (Option A).
- On-chain cash reconciles to the penny (`299.99 − 395.86 + 395.86 = 299.99`) → use as a parse guard.
- Method documented at `docs/ways-of-work/plan/nestfolio/pnl-and-pricing-method.md`.

**Key acceptance:**
- [ ] Realized / Unrealized / Total PnL per holding and per portfolio.
- [ ] Unrealized uses live equity price; cost basis uses price-at-acquisition.
- [ ] Reconciliation guard passes or surfaces an error (never a wrong number).

---

## Post-MVP (create as backlog, not in milestone)
- [ ] 🟩 Price / drift alerts — `feature` `priority-medium` `value-medium`
- [ ] 🟧 Configurable snapshot frequency — `enabler` `priority-low` `value-low`

## Explicitly Out of Scope (do NOT create)
FI tracker · goal engine · emergency liquidation calculator · multi-chain ·
standalone decision-journal view · any send/sign/trade capability.

---

## Creation Order (script-friendly)
1. E1
2. F1 → EN1.1, EN1.2, EN1.3, S1.1, T1.1
3. F2 → EN2.1, EN2.2, EN2.3, S2.1–S2.4, T2.1
4. F3 → EN3.1, EN3.2, EN3.3, S3.1–S3.4, T3.1
5. F4 → EN4.1, EN4.2, EN4.3, EN4.4, EN4.5, S4.1, T4.1
6. F6 → EN6.1, EN6.2, EN6.3, S6.1, T6.1
7. F5 → EN5.1, EN5.2, S5.1–S5.6, T5.1
8. Link `Blocks`/`Blocked by` per dependency graph (project-plan §3)
```
