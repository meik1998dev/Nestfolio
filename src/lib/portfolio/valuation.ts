/**
 * Holding valuation: turn holdings + a price table into USD values for the
 * rollup engine. The pure parts (ticker derivation, value computation) are
 * dependency-free and tested; the server reader pulls the global `live_prices`
 * cache (populated by F4 — may be empty for now, in which case everything
 * values to 0 and the UI marks holdings "no price").
 */
import type { Holding } from "@/lib/types";
import { resolveToken } from "@/lib/price/ticker";

/**
 * Derive a price-feed ticker from a holding's asset symbol. Tokenized stocks
 * carry a trailing `on` on-chain (NVDAon → NVDA, contract decision); plain
 * symbols (BTC, XAU, AAPL) pass through uppercased. Kept as a lightweight
 * fallback alongside the canonical `resolveToken`.
 */
export function tickerForAsset(asset: string): string {
  const sym = asset.trim().toUpperCase();
  // Strip a trailing tokenized-stock "ON" suffix, but never reduce to empty.
  if (sym.length > 2 && sym.endsWith("ON")) return sym.slice(0, -2);
  return sym;
}

/**
 * Resolve a holding's unit USD price from a `ticker → price` table. Single
 * source of truth via `resolveToken` (handles tokenized stocks → equity ticker,
 * crypto → Yahoo pair like BNB-USD, and stablecoins ≈ $1). Falls back to the
 * stripped/raw symbol so price tables keyed either way still resolve. Returns
 * null when nothing matches (caller values it at 0 / flags "no price").
 */
function unitPrice(asset: string, prices: Map<string, number>): number | null {
  const resolved = resolveToken(asset);
  // Stablecoins are cash at $1 even when the live-price cache has no row.
  if (resolved.kind === "stablecoin") return 1;

  const raw = asset.trim().toUpperCase();
  const candidates = [resolved.ticker, tickerForAsset(asset), raw];
  for (const c of candidates) {
    if (!c) continue;
    const p = prices.get(c);
    if (p != null) return p;
  }
  return null;
}

/**
 * Build a `Map<holdingId, usdValue>` from holdings and a `ticker → price` map.
 * Value = amount × resolved unit price; 0 when unpriceable. Never throws.
 */
export function computeHoldingValues(
  holdings: Holding[],
  prices: Map<string, number>,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const h of holdings) {
    const p = unitPrice(h.asset, prices);
    values.set(h.id, p != null ? h.amount * p : 0);
  }
  return values;
}

/** Does this holding resolve to a price? (drives the "no price" tag) */
export function hasPrice(
  holding: Holding,
  prices: Map<string, number>,
): boolean {
  return unitPrice(holding.asset, prices) != null;
}
