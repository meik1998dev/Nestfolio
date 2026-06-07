# Feature: Core Ledger / Transaction Engine

**ID:** F2 · **Type:** Feature · **Epic:** E1
**Labels:** `feature` `priority-critical` `value-high` `backend`
**Estimate:** L (21 pts)
**Blocked by:** F1 · **Blocks:** F3, F4, F5

## Description
The heart of the app. Everything is an Account; every movement of value is a
Transaction (income / buy / sell / transfer / expense) with source→dest
semantics. Holdings and balances are derived from transactions. Build this once
and most other features fall out of it.

## Enablers & Stories
- [ ] EN2.1 — Account entity + CRUD
- [ ] EN2.2 — Transaction engine
- [ ] EN2.3 — Holding entity + balances
- [ ] S2.1 — Create accounts
- [ ] S2.2 — Log a transaction
- [ ] S2.3 — Log a categorized expense
- [ ] S2.4 — Transaction notes
- [ ] T2.1 — Engine reconcile tests

## Acceptance Criteria
- [ ] All transaction types move value source→dest and reconcile.
- [ ] Expenses carry categories; notes persist on transactions.

## Definition of Done
- [ ] Stories + enablers done; engine unit tests green.
