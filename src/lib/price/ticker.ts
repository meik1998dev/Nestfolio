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
 * Overrides for tokenized stocks whose stripped symbol is NOT the real ticker,
 * or that need a non-default mapping. The common case (strip trailing `on`) is
 * handled automatically; this is only for exceptions.
 */
const STOCK_TICKER_OVERRIDES: Record<string, string> = {
  // e.g. if an issuer used a quirky symbol, map it here:
  // GOOGLON: "GOOGL",
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
};

/** True if the symbol looks like an Ondo tokenized stock (trailing `on`). */
export function isTokenizedStock(symbol: string): boolean {
  // Suffix is lower-case `on` on an upper-case ticker (e.g. NVDAon). Require at
  // least one preceding upper-case letter so plain words don't false-positive.
  return /^[A-Z]{1,6}on$/.test(symbol);
}

/** True if the symbol is a stablecoin (treated as $1 cash). */
export function isStablecoin(symbol: string): boolean {
  return STABLECOINS.has(symbol.toUpperCase());
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

  if (isStablecoin(symbol)) {
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

  if (CRYPTO_PAIRS[upper]) {
    return {
      symbol,
      kind: upper === "PAXG" ? "gold" : "crypto",
      ticker: CRYPTO_PAIRS[upper],
      displayName: upper,
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
