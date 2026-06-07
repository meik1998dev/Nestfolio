"use server";

/**
 * Read the global live-price cache (`live_prices`) into a `ticker → price` map.
 * The table is read-only to any authenticated user (RLS) and may be empty until
 * F4 populates it — in that case we return an empty map and callers value
 * everything at 0. Never throws on an empty table.
 */
import { createClient } from "@/lib/supabase/server";
import { priceProvider } from "@/lib/price/provider";
import { resolveToken } from "@/lib/price/ticker";
import type { Holding, LivePrice } from "@/lib/types";

export async function getLivePrices(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("live_prices").select("*");
  if (error) throw new Error(error.message);
  const map = new Map<string, number>();
  for (const row of (data ?? []) as LivePrice[]) {
    map.set(row.ticker.toUpperCase(), Number(row.price));
  }
  return map;
}

/**
 * Active price map for a set of holdings. The plain `live_prices` cache is only
 * refreshed for wallet-discovered tickers during sync, so a MANUAL holding (e.g.
 * hand-entered PAXG) would otherwise value at 0 forever. Here we resolve every
 * held asset to its pricing ticker and pull a fresh quote via the PriceProvider
 * (which has its own ~5-min TTL cache + write-back), so manual and wallet
 * holdings price identically and stay current. Never throws — a failed quote
 * just leaves that ticker out (valued at 0 / flagged "no price").
 */
export async function getLivePricesForHoldings(
  holdings: Holding[],
): Promise<Map<string, number>> {
  const map = await getLivePrices();
  const provider = priceProvider();

  const tickers = new Set<string>();
  for (const h of holdings) {
    const r = resolveToken(h.asset);
    // Stablecoins are $1 (handled in valuation); unknowns can't be priced.
    if (r.kind === "stablecoin" || r.kind === "unknown" || !r.ticker) continue;
    tickers.add(r.ticker);
  }

  await Promise.all(
    [...tickers].map(async (ticker) => {
      const price = await provider.livePrice(ticker);
      if (price != null) map.set(ticker.toUpperCase(), price);
    }),
  );

  return map;
}
