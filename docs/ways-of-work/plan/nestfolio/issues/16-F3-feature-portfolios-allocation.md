# Feature: Portfolios, Sources & Allocation

**ID:** F3 · **Type:** Feature · **Epic:** E1
**Labels:** `feature` `priority-high` `value-high` `fullstack`
**Estimate:** L (26 pts)
**Blocked by:** F2 · **Blocks:** F5

## Description
Group holdings into flexibly nested portfolios (any depth). Tag each holding's
source (on-chain vs manual). Set target allocations at any level and get
exact buy/sell rebalancing advice at every level.

## Enablers & Stories
- [ ] EN3.1 — Nested portfolio + recursive rollup
- [ ] EN3.2 — Asset source + wallet_ref
- [ ] EN3.3 — Allocation/rebalance engine
- [ ] S3.1 — Create nested portfolios
- [ ] S3.2 — Assign holdings to portfolios
- [ ] S3.3 — Set targets per level
- [ ] S3.4 — Drift + buy/sell advice
- [ ] T3.1 — Rollup + rebalance tests

## Acceptance Criteria
- [ ] Portfolio tree of depth ≥3 rolls up correct totals.
- [ ] Targets settable at any level; drift + trades shown per level.

## Definition of Done
- [ ] Stories + enablers done; math tests green.
- [ ] Open Q #5 resolved (relative vs absolute child targets).
