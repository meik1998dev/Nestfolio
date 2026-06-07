# Nestfolio MVP — Issues Index

One markdown file per issue (Epic → Feature → Enabler/Story/Test). Files are
numbered in creation/build order. Check items off as you go.

**Spec:** `../../../../../thoughts/shared/specs/2026-06-07-nestfolio.md`
**Plan:** `../project-plan.md` · **Checklist:** `../issues-checklist.md`

## Epic
- [ ] `00` E1 — Nestfolio MVP

## F1 — Platform Foundation & Auth  (P0 · M · 16)
- [ ] `01` F1 — feature
- [ ] `02` EN1.1 — Next.js + Vercel scaffold
- [ ] `03` EN1.2 — Supabase schema + RLS (core + sync/PnL persistence)
- [ ] `04` EN1.3 — Google OAuth
- [ ] `05` S1.1 — Sign in with Google
- [ ] `06` T1.1 — Auth + RLS isolation test

## F2 — Core Ledger / Transaction Engine  (P0 · L · 21)
- [ ] `07` F2 — feature
- [ ] `08` EN2.1 — Account entity + CRUD
- [ ] `09` EN2.2 — Transaction engine
- [ ] `10` EN2.3 — Holding entity + balances
- [ ] `11` S2.1 — Create accounts
- [ ] `12` S2.2 — Log a transaction
- [ ] `13` S2.3 — Log a categorized expense
- [ ] `14` S2.4 — Transaction notes
- [ ] `15` T2.1 — Engine reconcile tests

## F3 — Portfolios, Sources & Allocation  (P1 · L · 26)
- [ ] `16` F3 — feature
- [ ] `17` EN3.1 — Nested portfolio + rollup
- [ ] `18` EN3.2 — Asset source + wallet_ref
- [ ] `19` EN3.3 — Allocation/rebalance engine
- [ ] `20` S3.1 — Create nested portfolios
- [ ] `21` S3.2 — Assign holdings
- [ ] `22` S3.3 — Set targets per level
- [ ] `23` S3.4 — Drift + buy/sell advice
- [ ] `24` T3.1 — Rollup + rebalance tests

## F4 — BNB Wallet Sync & Pricing  (P1 · L · 25)
- [ ] `25` F4 — feature
- [ ] `26` EN4.1 — Provider integration (Moralis)
- [ ] `27` EN4.2 — Incremental sync + persistence + unassigned bucket
- [ ] `28` EN4.3 — PriceProvider + price_history/live_prices caches
- [ ] `43` EN4.4 — Tokenized-stock resolution (Ondo → ticker)
- [ ] `50` EN4.5 — Async sync orchestrator (two-speed)
- [ ] `29` S4.1 — Sync a BNB address
- [ ] `30` T4.1 — Sync + graceful failure test

## F5 — Insights & Dashboard  (P1 · L · 29)
- [ ] `31` F5 — feature
- [ ] `32` EN5.1 — Snapshot job
- [ ] `33` EN5.2 — Net-worth aggregation
- [ ] `34` S5.1 — Net Worth Dashboard
- [ ] `35` S5.2 — Liabilities
- [ ] `36` S5.3 — History chart
- [ ] `37` S5.4 — Allocation pie
- [ ] `38` S5.5 — Future projection
- [ ] `39` S5.6 — Monthly review
- [ ] `40` T5.1 — Aggregation + dashboard E2E

## F6 — Cost Basis & PnL  (P1 · M · 16)
- [ ] `44` F6 — feature
- [ ] `45` EN6.1 — Tx classifier + reconciliation guard
- [ ] `46` EN6.2 — Cost-basis ledger (avg cost, Option A)
- [ ] `47` EN6.3 — PnL engine (realized/unrealized/total)
- [ ] `48` S6.1 — See realized/unrealized/total PnL
- [ ] `49` T6.1 — PnL math + reconciliation tests

## Post-MVP Backlog
- [ ] `41` BL1 — Price / drift alerts
- [ ] `42` BL2 — Configurable snapshot frequency

---

**Validated 2026-06-07** (real wallet) — see `../pnl-and-pricing-method.md`.
Provider = Moralis · stocks = Ondo `…on` → equity ticker · price = equity feed (not DEX).

**Totals:** 1 epic · 6 features · 19 enablers · 17 stories · 6 tests · 2 backlog
**Effort:** ~133 pts (XL) · **Critical path:** F1 → F2 → F3 → F5 (F4 → F6 after F2)
**Async model:** see `../sync-and-persistence-design.md` — fetch-once, append-delta, two-speed PnL.
