# PnL & Pricing Method (validated on a real wallet)

**Date:** 2026-06-07
**Status:** Validated against real data — use this exact approach when building.
**Test wallet:** `0x4d67ea126736da534b6f499f49613d496066996b` (Binance Web3 Wallet, BNB chain)

This document records HOW we compute Realized / Unrealized / Total PnL, and how we
source prices. It was validated end-to-end on the test wallet; the on-chain cash
flow reconciled to the penny (see §6), which proves the transaction parsing is correct.

---

## 1. Data sources (two, kept separate on purpose)

| Need | Source | Notes |
|------|--------|-------|
| Balances, transfers (history), token metadata | **Moralis** Web3 Data API (free tier, 40k CU/day) | BSC supported. The ONLY chain data source. |
| **Price** (live + historical) for valuation | **Stock price feed** (NOT the token's on-chain price) | tokenized-stock DEX price is unreliable — see §2 |

**Critical rule:** never value a tokenized stock by its on-chain/DEX price. Those
Ondo tokens have thin liquidity; the DEX price is wrong (verified: METAon DEX
$1,518 vs real META $593; UBERon DEX $365 vs real $71; MSFTon DEX $246 vs real
$417). Value by the **underlying stock price**. Using DEX prices overstated the
test portfolio by ~2.5× ($6,426 vs the correct $2,284).

---

## 2. Price provider (the "easy way")

- **Primary: `yahoo-finance2` (npm)** — free, no API key, gives both live quotes
  (`quote`) and historical daily candles (`chart`/`historical`). Handles Yahoo's
  cookie+crumb internally. Map token→ticker by stripping the `on` suffix
  (`NVDAon`→`NVDA`, `GOOGLon`→`GOOGL`, `NVOon`→`NVO`, …).
- **Keyed fallbacks (if Yahoo throttles in prod):** Finnhub (free 60/min),
  Twelve Data (free 800/day). Both do live + historical US equities.
- **Caching:** cache live prices server-side, refresh every 1–5 min during market
  hours (~6.5h/day; off-hours = last close). Historical prices are immutable —
  fetch once per (ticker, date) and store. 14 tickers × few refreshes/day is tiny.

Token→ticker map: strip trailing `on`. Keep a small override map for any symbol
that doesn't cleanly map.

---

## 3. Pull the ledger (Moralis)

- `GET /{address}/erc20/transfers?chain=bsc` — paginate via `cursor`. This is the
  raw movement of every token in/out of the wallet.
- `GET /wallets/{address}/tokens?chain=bsc&exclude_spam=true` — current balances
  (use `balance_formatted`); ignore its `usd_price` for stocks (see §2).
- Group transfers by `transaction_hash`.

(Do NOT use: Moralis `/swaps` returns 0 for this wallet; `/wallets/.../net-worth`
ignores the bsc filter; `/profitability` returns "Chain is not supported" for BSC.)

---

## 4. Classify each transaction (validated rules)

Within one tx hash, look at the wallet's IN legs and OUT legs:

```
2-leg, stock IN + stablecoin OUT   → BUY   (exact cost  = USDT out)
2-leg, stablecoin IN + stock OUT   → SELL  (exact proceeds = USDT in)
1-leg, stock IN only               → DELIVERY  (paid OFF-chain via Binance balance)
1-leg, stock OUT only              → SEND/withdraw
1-leg, stablecoin IN, no stock     → USDT deposit (not a trade)
```

**Key real-world finding:** on this wallet the on-chain buys ($395.86) exactly
equal the on-chain sells ($395.86) — that USDT is just recycled (sell one token to
buy another). The **entire current stock portfolio arrived as 1-leg DELIVERIES**,
i.e. purchased off-chain (Binance funding) and only delivered on-chain. So:

> Cost basis of real positions is NOT on the blockchain. On-chain only proves the
> shares were received. We must price the delivery from the stock feed.

Stablecoins treated as cash: `USDT, USDC, BUSD, FDUSD`.

---

## 5. Cost basis & PnL (average-cost method)

Process events per ticker in chronological order:

```
ACQUIRE (BUY or DELIVERY):
    shares  += q
    cost    += (BUY: usd_paid)  OR  (DELIVERY: q * histPrice(ticker, date))

DISPOSE (SELL or SEND):
    avg      = cost / shares
    proceeds = (SELL: usd_received)  OR  (SEND: q * histPrice(ticker, date))
    realized += proceeds - avg*q
    cost     -= avg*q
    shares   -= q

AT END (per ticker):
    unrealized = shares_now * livePrice(ticker) - cost      # cost = remaining basis
    total      = realized + unrealized
```

Portfolio totals = Σ over tickers.

- **Realized PnL** — locked-in gains/losses from disposals.
- **Unrealized PnL** — paper gains/losses on what you still hold, at live price.
- **Total PnL** = realized + unrealized.

Cost-basis method = **average cost** (simple, matches a personal tracker). FIFO is
an alternative if lot-level tax accuracy is ever needed; same event loop, different
lot bookkeeping.

**Exactness ladder for DELIVERY cost basis:**
1. Historical stock price at the delivery timestamp — automatic, free, accurate to
   the day's range (Ondo fills near market). Default.
2. Optional: import Binance order history (CSV/API) for penny-exact fills.

---

## 6. Reconciliation check (must always pass)

Validate the parse by tying out cash:

```
USDT deposited - USDT spent on buys + USDT from sells  ==  current USDT balance
   299.99      -      395.86        +     395.86       ==  299.99   ✓ (verified)
```

If this doesn't tie out, the transfer parsing is wrong — fail loudly, show
last-known values, never display a wrong number silently.

Also sanity-check valuation: real-price total ($2,283.75 stocks) vs DEX-price total
($6,426) — if they diverge wildly, the price source is wrong.

---

## 7. Build checklist

- [ ] `WalletProvider` (Moralis): balances + paginated transfers.
- [ ] `PriceProvider` (yahoo-finance2): `livePrice(ticker)`, `histPrice(ticker, date)`, with caching + keyed fallback.
- [ ] Token→ticker mapper (strip `on` + overrides).
- [ ] Ledger builder: group by tx, classify (§4), average-cost loop (§5).
- [ ] Reconciliation guard (§6).
- [ ] (Optional) Binance history import for exact cost basis.
```
```
