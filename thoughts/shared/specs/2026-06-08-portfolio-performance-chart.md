# Portfolio Performance & P&L Chart with S&P 500 Benchmark

## Executive Summary

Add a time-series performance chart to the portfolio detail page
(`/portfolios/[id]`). It shows the portfolio's **Value**, **P&L**, and
**% Return** over selectable ranges (1M/3M/6M/1Y/Max), with an optional
**S&P 500 (SPY)** overlay so the user can see whether their portfolio is
beating the market. Most plumbing already exists (the dashboard's
`PerformanceChart` + `getPortfolioPerformance`); this scopes that machinery to
one portfolio and adds the benchmark.

## Problem Statement

The portfolio detail page shows only point-in-time numbers (value + P&L stat
cards, allocation pie, holdings/transactions tables). There is no way to see
**how this portfolio performed over time**, nor to compare it against the
market. The user — who treats this node as "my stocks" — wants the same
duration-based curve the holding-detail page already gives per-asset, plus a
benchmark line.

## Success Criteria

- A chart renders on `/portfolios/[id]` between the stat cards and Allocation.
- Range selectors (1M, 3M, 6M, 1Y, Max) re-scope the series via `?range=`.
- View toggle (Value / P&L / % Return) switches the primary metric.
- An on/off control overlays an SPY benchmark line that auto-matches the view.
- Numbers tie out: the chart's final point matches the existing stat cards.
- No regression to the dashboard chart (shared component stays compatible).

## User Persona

Single technical owner-investor. Understands P&L, cost basis, % return, and
benchmarks. No education needed; wants correct math and a clean, fast read.

## User Journey

1. Open `/portfolios/<id>`. Chart appears defaulting to **Value** view, **1Y**
   range, benchmark **off**.
2. Toggle **% Return** → both axes become percent; turn benchmark **on** → an
   SPY rebased-% line appears alongside the portfolio's return line.
3. Switch to **Value** → SPY line becomes a "$ what-if" line (what the same
   cash flows would be worth in SPY).
4. Click **Max** → server recomputes the full-history series.
5. Hover any point → tooltip shows the portfolio metric and (when on) the SPY
   value/return at that date.

## Decisions Made (from discovery)

| Topic | Decision |
|---|---|
| Primary metric | Toggle: **Value / P&L / % Return** (adds %-Return to the existing Value/P&L) |
| Benchmark modes | Both **% rebased** and **$ what-if**, but **auto-selected by view** (not a separate mode toggle) |
| Benchmark control | Single **on/off** toggle to show/hide the SPY line |
| Benchmark↔view wiring | Value → SPY **$ what-if**; %Return → SPY **rebased %**; P&L → **no benchmark** |
| What-if rule | **Mirror each buy as an SPY buy** of the same USD on the same date; sells mirror as SPY sells of the same USD (dollar-cost / cash-flow matched) |
| Benchmark ticker | **SPY** (ETF, dividend-adjusted close via existing Yahoo provider) |
| Scope | **This portfolio's subtree only** |
| Mixed assets (crypto/gold in the node) | **Benchmark the whole portfolio anyway** — no asset-class gating |

## Functional Requirements

### Must Have (P0)

**P0-1 — Portfolio-scoped performance series.**
Add a scoped variant of `getPortfolioPerformance` that restricts the replayed
ledger to the portfolio's subtree.
- Reuse the subtree-scoping already in `getPortfolioDetail`
  (`src/lib/portfolio/detail.ts:137-160`): build the tree, collect
  `subtreeIds`, derive the subtree `tickerSet` / `rawSet`, and an
  `inSubtree(asset)` predicate.
- In `src/lib/insights/performance.ts`, extract `loadTradeEvents()` to accept
  an optional asset filter, OR add `getPortfolioPerformance(range, scope?)`
  where `scope` carries the allowed ticker set. Filter `trades` (and thus
  `events`, `tickers`, `earliest`) to subtree tickers before replay.
- Everything downstream (`loadHistories`, `readLivePrices`, the per-date
  `buildLedger`/`positionPnl` loop) already works on the filtered set.
- Acceptance: the final series point's `value`/`realized`/`unrealized`/`total`
  equal `getPortfolioDetail(id).pnl.*` for the same portfolio.

**P0-2 — Add a `% Return` view to the chart component.**
Extend `PerformanceChart` (`src/components/performance-chart.tsx`) `View` type
to `"value" | "pnl" | "return"`.
- Add a third toggle button "Return %".
- Return view Y-axis formats as percent; baseline `ReferenceLine y={0}`.
- Portfolio return at each point `t`:
  `returnPct(t) = value(t) / investedCapital(t) − 1`, where
  `investedCapital(t)` = cumulative net cost basis (Σ buys − Σ sell cost) as of
  `t`. Carry `costBasis` per point in `PerfPoint` (see Data Model) so the
  client can compute this, or precompute `returnPct` server-side.
  Recommended: **precompute server-side** to keep cash-flow math in one place.

**P0-3 — SPY benchmark series (both modes), server-computed.**
In the scoped performance function, additionally:
- Add `"SPY"` to the tickers passed to `loadHistories` so its daily closes are
  fetched/stored via the existing price path (`loadHistory` + `ensurePrices`;
  Yahoo handles SPY with no API key).
- Mirror cash flows into SPY: walk the subtree trade events in date order.
  For each `buy`/`delivery` with USD value `V` on date `D`:
  `spyShares += V / spyClose(D)`. For each `sell`/`send` with USD value `V`:
  `spyShares -= V / spyClose(D)` (floor at 0). Track cumulative
  `investedCapital(t)` from the same flows.
- For each sampled date `t`, emit benchmark fields:
  - `spyValue(t) = spyShares(t) * spyClose(t)` — the **$ what-if** line.
  - `spyReturnPct(t) = spyValue(t) / investedCapital(t) − 1` — the **rebased %**
    line (shares the *same denominator* as the portfolio return, making the two
    lines apples-to-apples).
- Acceptance: with one buy and no sells, `spyValue` grows exactly with SPY's
  close; `spyReturnPct` at `t0` ≈ 0.

**P0-4 — Benchmark on/off + view-aware rendering.**
In `PerformanceChart`:
- Add a single benchmark toggle (checkbox/switch), default **off**.
- When on AND view is `value`: render an SPY `Line` bound to `spyValue`.
- When on AND view is `return`: render the portfolio return `Area` + an SPY
  `Line` bound to `spyReturnPct`.
- When view is `pnl`: hide the benchmark control's effect (no SPY line); keep
  the existing Total/Realized/Unrealized rendering unchanged.
- Distinct SPY line color + legend entry. Tooltip adds an "S&P 500" row when on.

**P0-5 — Wire the chart into the portfolio page.**
In `src/app/(app)/portfolios/[id]/page.tsx`:
- Accept `searchParams: Promise<{ range?: string }>`; parse with
  `parsePerfRange` (default `1Y`).
- Call the scoped performance function with `(id, range)` (alongside the
  existing `getPortfolioDetail(id)`).
- Render a new `<Card>` ("Performance") containing `<PerformanceChart
  series={...} range={range} basePath={`/portfolios/${id}`} />`, placed after
  the PnL stat cards and before Allocation.
- Acceptance: range links navigate to `/portfolios/<id>?range=<R>` and recompute.

### Should Have (P1)

- **P1-1** — Per-range % badges (like the asset chart's `rangeChanges`) showing
  portfolio vs SPY return for the active range.
- **P1-2** — Empty/partial states: "No history for this range yet" when the
  subtree has no priceable trades; reuse the component's existing empty guard.

### Nice to Have (P2)

- **P2-1** — Remember last-used view + benchmark toggle in `localStorage`.
- **P2-2** — Configurable benchmark ticker (dropdown: SPY / QQQ / ^GSPC).

## Technical Architecture

### Data Model — extend `PerfPoint`

`src/lib/insights/performance.types.ts`:
```ts
export interface PerfPoint {
  date: string;
  value: number | null;
  realized: number;
  unrealized: number | null;
  total: number | null;
  // NEW (nullable; null when unpriceable or benchmark unavailable):
  investedCapital?: number | null; // cumulative net cost basis as of date
  returnPct?: number | null;       // value / investedCapital − 1
  spyValue?: number | null;        // $ what-if mirror value
  spyReturnPct?: number | null;    // spyValue / investedCapital − 1
}
```
Backward compatible: the dashboard ignores the new fields; existing tooltips
unaffected.

### System Components

```
portfolios/[id]/page.tsx  (server)
  ├─ getPortfolioDetail(id)                  ← existing (cards, tables, pie)
  └─ getPortfolioPerformance(range, scope)   ← scoped variant (P0-1, P0-3)
        ├─ subtree ticker filter             ← reuse detail.ts scoping
        ├─ ledger replay → value/PnL/return  ← existing + returnPct
        └─ SPY mirror → spyValue/spyReturnPct← new (P0-3)
                       │
                       ▼
        PerformanceChart (client)            ← +Return view, +benchmark toggle
          Value  → SPY $ what-if line
          Return%→ SPY rebased % line
          P&L    → no benchmark
```

### Integrations

- **Price provider** (`src/lib/price/provider.ts`, Yahoo `yahoo-finance2`):
  fetches SPY daily closes. No new dependency, no API key.
- **`price_history` table**: SPY closes stored like any ticker on first fetch.

### Security Model

No change. All reads are user-scoped via the existing authenticated Supabase
client; no new external write paths.

## Non-Functional Requirements

- **Performance**: One extra ticker (SPY) in `loadHistories`; sampling step
  sizes per range already bound history calls. Target: page server time within
  ~1.5× of current portfolio-detail load.
- **Correctness**: Final chart point ties out to stat cards (P0-1 acceptance).
- **Reliability**: If SPY history is unavailable, benchmark fields are null and
  the toggle simply shows no line (no error).

## Out of Scope

- Cash/stablecoin inclusion in value (stays excluded, matching `getPnl`).
- Time-weighted (TWR) vs money-weighted return debate — we use the simple
  cash-flow-matched money-weighted definition above.
- Dividends/fees modeling beyond SPY's dividend-adjusted close.
- Multiple simultaneous benchmarks.

## Open Questions for Implementation

1. **Return denominator when fully sold out**: if `investedCapital(t) ≈ 0`
   (everything sold), `returnPct` divides by ~0. Decide: clamp to null, or
   carry the last realized return. Recommend **null** past the flat-out point.
2. **`getPortfolioPerformance` signature**: add a second arg `scope?: {tickers:
   Set<string>}` vs a separate `getPortfolioPerformanceScoped`. Recommend the
   optional-arg form to keep the dashboard call (`getPortfolioPerformance(range)`)
   unchanged.
3. **SPY close on trade dates before range start**: the mirror must walk *all*
   subtree trades (not just in-range) to get correct `spyShares` at range start
   — ensure SPY history loads from `earliest`, not `rangeStart`.

## Appendix: Reference Files

- `src/app/(app)/portfolios/[id]/page.tsx` — host page (add searchParams + card)
- `src/lib/portfolio/detail.ts:137-160` — subtree scoping to reuse
- `src/lib/insights/performance.ts` — series builder to scope + extend
- `src/lib/insights/performance.types.ts` — `PerfPoint` / `PerfRange` / ranges
- `src/components/performance-chart.tsx` — chart component to extend
- `src/app/(app)/holdings/[asset]/asset-chart.tsx` — range-link UX reference
- `src/lib/price/provider.ts` / `src/lib/price/history.ts` — SPY data path
- `src/lib/pnl/costbasis.ts` — `buildLedger` / `positionPnl` (replay engine)
