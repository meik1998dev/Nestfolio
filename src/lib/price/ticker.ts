/**
 * Token-symbol → asset resolution for pricing.
 *
 * On-chain tokenized stocks (Ondo Global Markets BEP-20) carry the underlying
 * symbol with a trailing `on` (NVDAon → NVDA). We MUST price these by the
 * underlying equity feed, never the thin-liquidity DEX price. This module is the
 * single source of truth for that mapping and is exported for F6 to reuse.
 *
 * Pure, dependency-free — safe to import anywhere (server or test).
 */

/** What a token symbol resolves to, for pricing + display. */
export type AssetKind = "stock" | "crypto" | "stablecoin" | "gold" | "unknown";

export interface ResolvedToken {
  /** Original on-chain symbol (e.g. "NVDAon", "USDT"). */
  symbol: string;
  /** Asset class — drives how the PriceProvider values it. */
  kind: AssetKind;
  /**
   * Pricing ticker for the PriceProvider. For stocks this is the equity ticker
   * (NVDA); for crypto a Yahoo pair (BNB-USD); null for stablecoins (≈ $1) and
   * unknowns (cannot be priced safely).
   */
  ticker: string | null;
  /** Human label for the UI. */
  displayName: string;
  /** Issuer of a tokenized asset, when known. */
  issuer: string | null;
}

/** Stablecoins are treated as cash at $1. */
const STABLECOINS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "DAI", "TUSD"]);

/**
 * Plain fiat cash positions (not on-chain) — e.g. dollars in a bank or on an
 * exchange, tracked manually. Valued at $1 and classed as cash, exactly like a
 * stablecoin; they just aren't crypto. Lets a user hold "USD cash" distinct from
 * "USDT" under the same Cash bucket.
 */
const FIAT = new Set(["USD", "CASH"]);

/**
 * Known crypto symbol → Yahoo pricing pair. BNB and PAXG are deep-liquidity so
 * their market price is reliable. Extend as new assets appear.
 */
const CRYPTO_PAIRS: Record<string, string> = {
  BNB: "BNB-USD",
  WBNB: "BNB-USD",
  BTC: "BTC-USD",
  BTCB: "BTC-USD",
  ETH: "ETH-USD",
  WETH: "ETH-USD",
  PAXG: "PAXG-USD",
};

/**
 * Reverse of {@link CRYPTO_PAIRS}: a pricing pair ("PAXG-USD") → its canonical
 * base symbol ("PAXG"). Lets us recognise the pair form when it surfaces as a
 * symbol (cost_basis tickers, asset URLs) instead of mislabelling it unknown.
 */
const PAIR_TO_BASE: Record<string, string> = {};
for (const [base, pair] of Object.entries(CRYPTO_PAIRS)) {
  // First base wins, so a pair shared by wrapped variants (WBNB→BNB-USD) keeps
  // the canonical symbol (BNB), not the wrapper.
  if (!(pair in PAIR_TO_BASE)) PAIR_TO_BASE[pair] = base;
}

/**
 * Overrides for tokenized stocks whose stripped symbol is NOT the real ticker,
 * or that need a non-default mapping. The common case (strip trailing `on`) is
 * handled automatically; this is only for exceptions.
 */
const STOCK_TICKER_OVERRIDES: Record<string, string> = {
  // e.g. if an issuer used a quirky symbol, map it here:
  // GOOGLON: "GOOGL",
};

/**
 * Binance bStocks (BEP-20 tokenized US equities, June 2026 launch): on-chain
 * symbol → underlying equity ticker. Symbols end in `B` (MUB → MU) but a bare
 * suffix rule would swallow crypto like BTCB, so membership is explicit —
 * extend this map as Binance lists more.
 */
const BSTOCK_TICKERS: Record<string, string> = {
  MUB: "MU",
  NVDAB: "NVDA",
  TSLAB: "TSLA",
  CRCLB: "CRCL",
  SNDKB: "SNDK",
  // Moralis serves stale metadata ("M2B") for the MUB contract
  // (0xcdf2f3e0fa43c47a6662a91c9e4a7c5f69762699), so synced holdings can carry
  // that symbol. Alias it until their index catches up.
  M2B: "MU",
};

/** Display names for resolved equity tickers (best-effort, optional). */
const STOCK_DISPLAY_NAMES: Record<string, string> = {
  NVDA: "NVIDIA",
  META: "Meta Platforms",
  GOOGL: "Alphabet",
  MSFT: "Microsoft",
  AAPL: "Apple",
  AMZN: "Amazon",
  TSLA: "Tesla",
  UBER: "Uber",
  NVO: "Novo Nordisk",
  MU: "Micron Technology",
  CRCL: "Circle Internet Group",
  SNDK: "Sandisk",
};

/** True if the symbol looks like an Ondo tokenized stock (trailing `on`). */
export function isTokenizedStock(symbol: string): boolean {
  // Suffix is lower-case `on` on an upper-case ticker (e.g. NVDAon). Require at
  // least one preceding upper-case letter so plain words don't false-positive.
  return /^[A-Z]{1,6}on$/.test(symbol);
}

/**
 * Canonical display/route symbol: collapses a Yahoo pricing pair ("PAXG-USD",
 * "BTC-USD") to its base asset ("PAXG", "BTC"); every other symbol is returned
 * unchanged. Keeps one asset from showing twice (e.g. dashboard "PAXG-USD" vs
 * holdings "PAXG") and unifies both to a single detail route.
 */
export function canonicalSymbol(symbol: string): string {
  return PAIR_TO_BASE[symbol.toUpperCase()] ?? symbol;
}

/** True if the symbol is a stablecoin (treated as $1 cash). */
export function isStablecoin(symbol: string): boolean {
  return STABLECOINS.has(symbol.toUpperCase());
}

/** True if the symbol is plain fiat cash (USD / CASH), valued at $1. */
export function isFiat(symbol: string): boolean {
  return FIAT.has(symbol.toUpperCase());
}

/** True if the symbol is cash-like: a stablecoin or fiat (both $1 cash). */
export function isCashLike(symbol: string): boolean {
  return isStablecoin(symbol) || isFiat(symbol);
}

/**
 * Map a tokenized-stock symbol to its underlying equity ticker.
 * Strips the trailing `on`, then applies the override map. Returns null if the
 * symbol is not a tokenized stock.
 */
export function tokenToTicker(symbol: string): string | null {
  if (!isTokenizedStock(symbol)) return null;
  const stripped = symbol.slice(0, -2).toUpperCase();
  return STOCK_TICKER_OVERRIDES[stripped] ?? stripped;
}

/**
 * Full resolution of an on-chain token symbol into its asset class, pricing
 * ticker, and display metadata. This is the function the sync orchestrator and
 * F6 should call.
 */
export function resolveToken(symbol: string): ResolvedToken {
  const upper = symbol.toUpperCase();

  // Cash-like: stablecoins AND plain fiat (USD/CASH). Both value at $1 and class
  // as cash. We reuse the "stablecoin" kind as the single cash-like bucket so
  // every downstream consumer (valuation $1, net-worth cash class, no live-price
  // fetch) treats them identically.
  if (isCashLike(symbol)) {
    return {
      symbol,
      kind: "stablecoin",
      ticker: null,
      displayName: upper,
      issuer: null,
    };
  }

  if (isTokenizedStock(symbol)) {
    const ticker = tokenToTicker(symbol)!;
    return {
      symbol,
      kind: "stock",
      ticker,
      displayName: STOCK_DISPLAY_NAMES[ticker] ?? ticker,
      issuer: "Ondo Global Markets",
    };
  }

  const bstock = BSTOCK_TICKERS[upper];
  if (bstock) {
    return {
      symbol,
      kind: "stock",
      ticker: bstock,
      displayName: STOCK_DISPLAY_NAMES[bstock] ?? bstock,
      issuer: "Binance bStocks",
    };
  }

  if (CRYPTO_PAIRS[upper]) {
    return {
      symbol,
      kind: upper === "PAXG" ? "gold" : "crypto",
      ticker: CRYPTO_PAIRS[upper],
      displayName: upper,
      issuer: null,
    };
  }

  // The cost_basis / price layer stores the Yahoo pricing PAIR (e.g. "PAXG-USD",
  // "BTC-USD") as a ticker. When that pair form reaches us as a symbol, resolve
  // it back to its base asset so it's priced/charted like "PAXG", not treated as
  // an unknown spam token.
  const base = PAIR_TO_BASE[upper];
  if (base) {
    return {
      symbol,
      kind: base === "PAXG" ? "gold" : "crypto",
      ticker: upper,
      displayName: base,
      issuer: null,
    };
  }

  // Unknown — never silently misprice. Caller flags it for manual mapping.
  return {
    symbol,
    kind: "unknown",
    ticker: null,
    displayName: symbol,
    issuer: null,
  };
}
