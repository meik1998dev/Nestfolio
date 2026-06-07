# Epic: Nestfolio — Personal Wealth Command Center (MVP)

**ID:** E1 · **Type:** Epic
**Labels:** `epic` `priority-critical` `value-high`
**Estimate:** XL (~133 pts) · **Milestone:** Nestfolio MVP

## Description
Single-user wealth tracker. Reads a public BNB wallet (read-only) and combines
on-chain holdings with manually entered assets/liabilities under one unified
Account/Transaction model. Adds flexibly nested portfolios with all-levels
rebalancing, a net-worth dashboard, history charts, projections, and an
auto monthly review.

## Business Value
- **Goal:** one source of truth for the user's whole financial life.
- **Success metrics:** dashboard < 2s; net worth reconciles; rebalancing advice at every level.
- **User impact:** answers "how much am I worth / where is it / what changed / what next".

## Features
- [ ] F1 — Platform Foundation & Auth
- [ ] F2 — Core Ledger / Transaction Engine
- [ ] F3 — Portfolios, Sources & Allocation
- [ ] F4 — BNB Wallet Sync & Pricing
- [ ] F5 — Insights & Dashboard
- [ ] F6 — Cost Basis & PnL

## Acceptance Criteria
- [ ] BNB balances sync from a public address with USD values (equity price for stocks).
- [ ] Net Worth = Assets − Liabilities, always reconciles.
- [ ] Realized / Unrealized / Total PnL shown per holding and per portfolio.
- [ ] Rebalancing shows exact buy/sell amounts at every portfolio level.
- [ ] History chart renders net-worth trend from stored snapshots.

## Definition of Done
- [ ] All features delivered and integration-tested.
- [ ] RLS enforced on every table.
- [ ] No open P0/P1 bugs.
