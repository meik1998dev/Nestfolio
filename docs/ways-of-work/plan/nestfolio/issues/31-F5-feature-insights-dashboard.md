# Feature: Insights & Dashboard

**ID:** F5 · **Type:** Feature · **Epic:** E1
**Labels:** `feature` `priority-high` `value-high` `frontend`
**Estimate:** L (29 pts)
**Blocked by:** F2, F3, F4, F6 · **Blocks:** none

## Description
The screens the user opens daily: Net Worth Dashboard (landing), liabilities,
net-worth history chart, allocation pie, future projection, and an auto monthly
review. Built on snapshots + a net-worth aggregation service. Surfaces the
**Realized / Unrealized / Total PnL** from F6 on holdings and the dashboard.

## Enablers & Stories
- [ ] EN5.1 — Snapshot job + storage
- [ ] EN5.2 — Net-worth aggregation service
- [ ] S5.1 — Net Worth Dashboard (landing)
- [ ] S5.2 — Liabilities
- [ ] S5.3 — History chart
- [ ] S5.4 — Allocation pie
- [ ] S5.5 — Future projection
- [ ] S5.6 — Monthly review
- [ ] T5.1 — Aggregation + dashboard E2E

## Acceptance Criteria
- [ ] Landing shows net worth, MoM change, asset/liability bars, breakdown pie.
- [ ] History chart renders from snapshots; projection + monthly review work.

## Definition of Done
- [ ] Stories + enablers done; aggregation tests + dashboard E2E green.
