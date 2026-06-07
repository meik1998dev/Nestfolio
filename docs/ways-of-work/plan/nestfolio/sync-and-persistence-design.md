# Sync & Persistence Design (asynchronous, incremental)

**Date:** 2026-06-07
**Status:** Design — implement as described.
**Companion:** `pnl-and-pricing-method.md` (the PnL math this caches).

## Principle

Split data by volatility. Fetch the slow/immutable data **once**, store it, and only
ever **append the delta**. Recompute only the cheap volatile part frequently. The
network (blockchain + price APIs) is touched only for new blocks and live prices —
never to re-derive what's already stored.

```
                 fetched ONCE, immutable        recomputed CHEAP, volatile
                 ───────────────────────        ─────────────────────────
data             transfers, historical prices   live prices, unrealized PnL
refresh          incremental (new blocks only)   TTL (~1–5 min)
network calls    delta only                       live quotes only
```

## Two-speed model

### 1. HEAVY sync — incremental, on app-open (debounced) + optional cron
1. Read `wallets.last_synced_block`. Fetch transfers **from that block** (with a
   small overlap, e.g. −20 blocks, to absorb shallow reorgs).
2. Upsert into `wallet_transfers`, **idempotent** on `(wallet_id, tx_hash, log_index)`.
3. Classify only the **new** transfers → `trade_events` (buy/sell/delivery/send/deposit).
4. For new acquisitions/disposals that need a price, ensure `price_history(ticker,
   date)` exists — **fetch only missing pairs**; historical prices are immutable, never overwritten.
5. Rebuild `cost_basis` for affected tickers from stored `trade_events` (avg-cost;
   stores `shares`, `cost_basis`, `realized_pnl`).
6. Run the reconciliation guard (deposits − buys + sells == balance). On failure →
   mark sync degraded, keep last-known, surface error.
7. Update `last_synced_block`, `last_synced_at`, `sync_status`.

→ If nothing new on chain, steps 3–6 are no-ops; cost basis & realized PnL are unchanged.

### 2. LIGHT refresh — TTL cache, while app is open
1. Refresh `live_prices` only for tickers whose `fetched_at` is older than the TTL.
2. Unrealized & total PnL are computed from stored `cost_basis` × `live_prices` —
   **pure DB math, zero chain/price-history calls.**

### 3. READ path — instant
- Dashboard reads `cost_basis` + `live_prices` + holdings straight from the DB and
  renders last-known values in <2s. The sync runs asynchronously; the UI revalidates
  when it completes (React Query/SWR or Supabase realtime).

## Schema additions (see EN1.2)

| Table | Scope | Purpose | Key / dedup |
|-------|-------|---------|-------------|
| `wallets` | user | address + sync cursor | `last_synced_block`, `sync_status` |
| `wallet_transfers` | user | raw normalized transfers | unique `(wallet_id, tx_hash, log_index)` |
| `trade_events` | user | classified economic events | derived; ref `tx_hash` |
| `price_history` | **global** | immutable daily closes | unique `(ticker, date)` |
| `live_prices` | **global** | live quote cache w/ TTL | `(ticker, fetched_at)` |
| `cost_basis` | user | materialized ledger | unique `(wallet_id, ticker)` → `shares, cost_basis, realized_pnl` |

- `price_history` / `live_prices` are **market data, not user data** → global
  read-only tables; only the service role (sync job) writes them. Everything else is
  RLS-scoped to `user_id = auth.uid()`.
- Unrealized/total PnL: computed on read from `cost_basis` + `live_prices` (no extra
  table needed); optionally materialized into `snapshots` for history.

## Correctness rules

- **Idempotent appends** — re-running a sync never duplicates transfers (unique key).
- **Reorg overlap** — re-scan the last N blocks each sync; dedup absorbs duplicates.
- **Immutable history** — `price_history` and past `trade_events` are never rewritten.
- **Realized vs unrealized split** — realized changes only on new disposals (heavy
  sync); unrealized changes every live refresh (light).
- **Degrade gracefully** — any sync/price failure → keep last-known from DB + flag;
  never a blank dashboard, never a recomputed-wrong number.

## What this means for the issues

- `EN1.2` — add the 6 tables above (+ RLS: market-data tables global, rest user-scoped).
- `EN4.2` — sync becomes **incremental** (cursor + reorg overlap) and persists raw transfers.
- `EN4.3` — PriceProvider writes the two caches: `price_history` (immutable) + `live_prices` (TTL).
- `EN4.5` — **async sync orchestrator**: on-open incremental heavy sync + light live refresh + read-from-DB + revalidate.
- `EN6.2` — `cost_basis` is **materialized** and updated incrementally from new `trade_events`.
- `EN6.3` — PnL is **two-speed**: realized recomputed on new tx, unrealized on live refresh.
