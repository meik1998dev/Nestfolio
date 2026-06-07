# Feature: Cost Basis & PnL

**ID:** F6 · **Type:** Feature · **Epic:** E1
**Labels:** `feature` `priority-high` `value-high` `backend` `integration`
**Estimate:** M (16 pts)
**Blocked by:** F4 (provider, pricing, resolution) · **Blocks:** F5 (dashboard shows PnL)

## Description
Compute **Realized**, **Unrealized**, and **Total PnL** per holding and rolled up
per portfolio, from the on-chain transaction ledger + the PriceProvider. Added
after a real-wallet validation (2026-06-07) confirmed all inputs are reachable.

> Method (validated, with worked numbers): `docs/ways-of-work/plan/nestfolio/pnl-and-pricing-method.md`

## Key validated findings driving this feature
- **Cost basis is mostly OFF-CHAIN.** On the test wallet, on-chain buys ($395.86)
  exactly equal on-chain sells ($395.86) — USDT recycled. The whole current stock
  portfolio arrived as **1-leg deliveries** (paid via Binance balance, only the
  token delivery is on-chain). So the chain proves *receipt*, not *cost*.
- **Cost basis source = Option A:** historical equity price at the delivery
  timestamp (accurate; Ondo fills ~market). Optional later: Binance order-history
  import for penny-exact fills.
- **Parse guard:** on-chain cash must reconcile (deposit − buys + sells == USDT
  balance; verified to the penny). Fail loudly if not.

## Enablers & Stories
- [ ] EN6.1 — Transaction-leg classifier + cash reconciliation guard
- [ ] EN6.2 — Cost-basis ledger (avg-cost, Option A historical pricing)
- [ ] EN6.3 — PnL engine (realized / unrealized / total) + portfolio rollup
- [ ] S6.1 — See realized/unrealized/total PnL per holding and overall
- [ ] T6.1 — PnL math + reconciliation tests

## Acceptance Criteria
- [ ] Realized, Unrealized, and Total PnL computed per holding and per portfolio.
- [ ] Unrealized uses the live equity price; cost basis uses price-at-acquisition.
- [ ] Cash reconciliation guard passes (or surfaces an error, never a wrong number).

## Definition of Done
- [ ] Enablers + story done; PnL math tests green; numbers reconcile on the test wallet.
