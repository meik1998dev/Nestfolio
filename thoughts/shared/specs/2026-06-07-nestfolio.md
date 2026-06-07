# Nestfolio — Personal Wealth Command Center

**Date:** 2026-06-07
**Status:** Spec — ready for implementation planning

---

## Executive Summary

Nestfolio is a personal wealth tracker for a single type of user: a salaried
employee who invests to grow net worth. It reads a public BNB-chain wallet
(read-only, no permissions needed), combines on-chain assets with manually
entered assets (cash, physical gold), and presents one unified net-worth view
with nested portfolios, target-allocation rebalancing, history charts, monthly
reviews, and future projections.

It is **not** accounting software. It answers four questions every time it opens:
how much am I worth, where is my money, what changed, and what should I do next.

---

## Problem Statement

Existing finance apps split portfolio tracking, expense tracking, and net-worth
tracking into separate systems. The user wants a **single source of truth** for
their whole financial life — crypto, stocks (tokenized), gold, cash, and debts —
in one model. They also want structure their real holdings actually have:
nested portfolios (e.g. a Stocks portfolio that is 50% NVDA / 20% MSFT) and
clear provenance for every asset (Binance wallet vs. manual).

---

## Success Criteria

- Open app → see current net worth and breakdown in < 2 seconds.
- BNB wallet balances sync automatically from a public address.
- Net worth = (all assets) − (all liabilities), always reconciles.
- Rebalancing view shows exact buy/sell amounts at every portfolio level.
- History chart shows net worth trend over time.

---

## User Persona

**The Investor (single user, technical-enough).**
Salaried, no business, no taxes, no complex accounting. Invests small amounts
regularly across gold, crypto (BTC/PAXG on Binance), and tokenized US stocks.
Wants motivation and clarity, not bookkeeping.

---

## Core Concepts & Data Model

Everything is built on a small set of entities. The transaction engine is built
first; most features fall out of it.

```
User
 └── Account            (a place money/assets live)
      └── Portfolio      (nested, FLEXIBLE depth — a portfolio can hold portfolios)
           └── Holding   (a specific asset position, with a SOURCE)
                └── Transaction  (every movement of value)
```

### Entities

**Account** — a container that holds value.
Examples: Cash Wallet, Binance Wallet (0xABC…), Gold Holdings, Stock Wallet.

**Portfolio** — a grouping with an optional target allocation. **Nesting is
flexible (unlimited depth)**, not capped at 2 levels.
```
Total Portfolio
├── Crypto Portfolio          (target 25%)
│   ├── BTC      (source: ON_CHAIN, Binance)
│   └── ETH      (source: ON_CHAIN, Binance)
├── Stocks Portfolio          (target 5%)
│   ├── NVDA 50% (source: ON_CHAIN, tokenized)
│   ├── MSFT 20% (source: ON_CHAIN, tokenized)
│   └── AAPL 30% (source: ON_CHAIN, tokenized)
└── Gold Portfolio            (target 70%)
    ├── Physical Gold (source: MANUAL)
    └── PAXG          (source: ON_CHAIN, Binance)
```

**Holding** — a position in one asset inside one portfolio.
```
Holding
├── asset      (BTC, PAXG, NVDA, GOLD_GRAMS, …)
├── amount     (2.5)
├── source     (ON_CHAIN | MANUAL)
├── wallet_ref (0xABC… when ON_CHAIN, null when MANUAL)
└── portfolio  (which portfolio it belongs to)
```

**Asset source.** Each holding records provenance:
- `ON_CHAIN` — auto-synced from the BNB wallet (BTC, PAXG, tokenized stocks).
- `MANUAL` — user-entered (physical gold, cash, real estate).

**Asset → Portfolio mapping is MANUAL.** After a wallet sync, synced tokens
appear in an "unassigned" bucket; the user assigns each one to a portfolio.
A synced PAXG token can be assigned to the Gold portfolio even though it lives
in the Binance wallet. (No auto-mapping rules in MVP.)

**Transaction** — every movement of value uses one shape:
```
Transaction
├── id
├── date
├── type            (income | buy | sell | transfer | expense)
├── source_account
├── dest_account
├── amount
├── category        (for expenses: rent, food, …)
└── note            (free text — captures buy/sell reasoning)
```
Examples: Salary (Outside → Cash), Buy BTC (Cash → Crypto), Sell NVDA
(Stocks → Cash), Buy Car (Cash → Expense), Buy Gold (Cash → Gold).

**Liability** — debts tracked alongside assets.
Examples: credit card, loan, mortgage. `Net Worth = Assets − Liabilities`.

**Snapshot** — a stored point-in-time net-worth/portfolio value, used to draw
history charts. (Frequency TBD — see Open Questions.)

---

## Functional Requirements

### Must Have (P0 — MVP)

**FR1 — BNB wallet sync (read-only).**
User pastes a public BNB address. Backend fetches BNB + BEP20 balances and USD
values via a portfolio/RPC API. No wallet signature or login to the wallet.
*Accept:* given a valid address, balances appear with current USD value.

**FR2 — Unified Account model.**
All asset types (cash, crypto, gold, stocks) live in one Account/Transaction
system. Adding a new asset type = adding an account, not new code paths.

**FR3 — Nested portfolios (flexible depth).**
Portfolios can contain portfolios to any depth. Each portfolio rolls up the
value of its children.
*Accept:* a portfolio tree of depth ≥ 3 renders correct rolled-up totals.

**FR4 — Asset source tracking.**
Every holding is tagged `ON_CHAIN` or `MANUAL`; on-chain holdings carry their
wallet reference.

**FR5 — Manual asset assignment after sync.**
Synced tokens land in an unassigned bucket; user assigns each to a portfolio.

**FR6 — Assets + Liabilities → Net Worth.**
Track debts; dashboard shows Assets, Liabilities, and Net Worth.

**FR7 — Manual transactions + expense categories.**
Log salary, cash moves, physical-asset buys, and categorized expenses.
*Accept:* monthly expense breakdown by category renders from logged data.

**FR8 — Net Worth Dashboard (primary screen).**
Landing screen: net worth, month-over-month change, asset/liability bars, and a
breakdown pie of where money sits.

**FR9 — Portfolio history chart.**
Line chart of net worth over time, built from snapshots.

**FR10 — Allocation policy + rebalancing (all levels).**
User sets target % per portfolio at any level. App shows target vs actual drift
and exact buy/sell amounts to rebalance — both top-level (Crypto/Stocks/Gold)
and within each portfolio (e.g. inside Stocks: NVDA/MSFT/AAPL).
*Accept:* given targets and current values, suggested trades bring each level to
target within rounding.

**FR11 — Future projection.**
Project net worth 5–10 years out from savings rate + assumed returns
(conservative / expected / optimistic), using compound growth.

**FR12 — Monthly wealth review.**
Auto-generated month-end summary: net-worth change, biggest winner/loser,
salary added vs investment gains.

**FR13 — Transaction notes.**
Free-text note per transaction to capture buy/sell reasoning. (No dedicated
journal view in MVP.)

**FR14 — Auth: Google OAuth via Supabase.**

**FR15 — Cost basis & PnL (Realized / Unrealized / Total).**
Reconstruct cost basis from the transaction ledger and compute Realized,
Unrealized, and Total PnL per holding and rolled up per portfolio.
- Classify each tx (validated): 2-leg = on-chain trade (exact price); 1-leg stock
  delivery = paid off-chain → cost basis from the **historical equity price at the
  delivery timestamp** (Option A); optional Binance import for exact fills.
- Cost basis & realized use price-at-transaction; unrealized uses the live equity
  price. `Total = Realized + Unrealized` (average-cost method).
- A cash-reconciliation guard must pass (deposits − buys + sells == balance), else
  surface an error — never display a wrong number.
*Accept:* per-holding and portfolio PnL reconcile; the validated worked example
reproduces exactly.

### Should Have (P1 — after MVP)

- Price / portfolio-drift alerts (needs background job + notifications).
- Configurable snapshot frequency.

### Out of Scope (explicitly NOT building)

- Financial Independence tracker (FI number, years funded).
- Goal engine / numeric goal tracking.
- Emergency liquidation calculator.
- Multi-chain support (BNB chain only for now).
- Standalone decision-journal view (notes only).
- Sending funds, signing, or trading (read-only app).

---

## Technical Architecture

### Stack
- **Frontend + Backend:** Next.js (App Router). Backend lives in Next.js API
  routes / server actions — no separate service.
- **Database:** Supabase (Postgres + Auth + RLS).
- **Auth:** Supabase Auth, Google OAuth.
- **Charts:** Recharts (or similar) for line + pie charts.
- **Hosting:** Vercel.

### Blockchain data
- BNB chain only. MVP uses **Moralis** (free tier, 40k CU/day) for balances +
  transfer history, behind a `WalletProvider` interface (swappable for direct RPC
  later). **Validated 2026-06-07** on a real wallet. Note: Etherscan/BscScan V2 is
  NOT free for BSC, so Moralis (not Zerion/Etherscan) is the choice.

### Prices (validated — kept SEPARATE from balances)
- **Tokenized stocks must be valued by the underlying equity price, NOT the
  on-chain/DEX token price.** Ondo tokenized stocks have thin liquidity; their DEX
  price is wrong (overstated the test portfolio ~2.5×). Use a `PriceProvider`:
  - **Primary:** `yahoo-finance2` (free, no key, live + historical).
  - **Fallback:** Finnhub (live) · Twelve Data (historical).
  - Map token → ticker by stripping the `on` suffix (`NVDAon`→`NVDA`).
- Crypto / BNB / PAXG: Moralis `usd_price` is fine (deep liquidity). Gold grams:
  Yahoo `XAUUSD` spot, per-gram.
- See `docs/ways-of-work/plan/nestfolio/pnl-and-pricing-method.md` for the full
  validated method.

### System flow
```
Wallet address ─┐
                ▼
        Next.js API route ──► Portfolio API (balances + USD)
                │
                ▼
        Supabase (accounts, portfolios, holdings, txns, liabilities, snapshots)
                │
                ├──► Net Worth Dashboard
                ├──► History chart (from snapshots)
                ├──► Rebalancing view (targets vs actuals)
                └──► Monthly review / projection
```

### Security model
- Single user, Google OAuth. Supabase Row-Level Security scopes all rows to the
  authenticated user.
- Only **public** wallet addresses stored — no private keys, no signing.
- Financial data is sensitive (PII-like): enforce RLS on every table.

---

## Non-Functional Requirements

- **Performance:** dashboard loads in < 2s; wallet sync is async with a loading
  state.
- **Async / persistence:** transactions and historical prices are fetched **once**
  and stored; sync appends only the **delta** (new blocks since a saved cursor) and
  refreshes live prices on a TTL. The dashboard reads last-known values from the DB
  instantly; sync runs in the background and the UI revalidates. Realized PnL
  recomputes only on new trades; unrealized PnL on each live-price refresh.
  See `docs/ways-of-work/plan/nestfolio/sync-and-persistence-design.md`.
- **Scale:** single user (self-use); design for one account, not a fleet.
- **Reliability:** wallet sync failures must degrade gracefully (show last
  known balances + a sync error, never a blank dashboard).
- **Cost:** target ~$0 (Vercel + Supabase + provider free tiers).

---

## Open Questions for Implementation

1. **Snapshot frequency** — hourly vs daily vs on-transaction. Affects cron
   setup and storage. (Deferred by user.)
2. ~~**Portfolio API provider**~~ **RESOLVED (2026-06-07): Moralis** free tier
   (40k CU/day, BSC supported) — covers a single-user app at $0. Etherscan V2 is
   not free for BSC.
3. ~~**Gold/PAXG pricing source**~~ **RESOLVED:** gold grams via Yahoo `XAUUSD`
   spot (per-gram); PAXG via Moralis/feed.
4. ~~**Tokenized stocks**~~ **RESOLVED:** they are **Ondo Global Markets** BEP-20
   tokens (`…on` suffix, "Ondo Tokenized") → strip suffix to get the equity ticker;
   manual override for edge cases. (xStocks `…x` may appear later — same mechanism.)
5. **Rebalancing math at depth** — define whether child targets are relative to
   parent (sum to 100% within a portfolio) or absolute to total.

---

## Appendix: Decision Log

| Area | Decision |
|------|----------|
| Crypto wallet sync | Essential (MVP) |
| Account model | Unified |
| Liabilities | Tracked |
| Manual transactions | Essential |
| Primary screen | Net Worth Dashboard |
| History chart | Essential |
| Allocation + rebalancing | Essential, all levels |
| FI tracker | Skipped |
| Goal engine | Skipped |
| Future projection | Included |
| Monthly review | Included |
| Decision journal | Notes only |
| Emergency calculator | Skipped |
| Chains | BNB only |
| Alerts | Later |
| Auth | Google OAuth (Supabase) |
| Expenses | Tracked with categories |
| Snapshot frequency | TBD |
| Hosting | Vercel |
| Portfolio nesting | Flexible depth |
| Asset → portfolio mapping | Manual assignment |
| Wallet/data provider | **Moralis** free tier (validated; Etherscan not free for BSC) |
| Tokenized stocks | **Ondo** BEP-20 (`…on`) → strip to equity ticker |
| Stock pricing | Underlying equity feed (yahoo-finance2 + Finnhub/Twelve Data); **never** DEX price |
| Cost basis | Historical equity price at delivery (Option A); Binance import optional |
| PnL | Realized / Unrealized / Total, average-cost (new feature F6) |
