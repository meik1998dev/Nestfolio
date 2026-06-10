/**
 * Client-safe types + constants for the asset detail view. Kept separate from
 * `detail.ts` so client components (the chart) can import ranges/point shapes
 * without dragging the server-only assembly (Supabase, price provider) into the
 * browser bundle.
 */

/** Chart ranges offered on the asset page (daily granularity — no intraday). */
export type AssetRange = "1M" | "3M" | "6M" | "1Y" | "Max";
export const ASSET_RANGES: AssetRange[] = ["1M", "3M", "6M", "1Y", "Max"];

export function parseRange(raw: string | undefined): AssetRange {
  return ASSET_RANGES.includes(raw as AssetRange) ? (raw as AssetRange) : "1Y";
}

/**
 * A single charted trade marker: the user's own buy/sell on this asset, keyed by
 * day. Same-day same-side trades are aggregated into one marker server-side.
 */
export interface AssetTrade {
  date: string; // YYYY-MM-DD
  side: "buy" | "sell";
  /** Summed quantity across the day's legs; omitted when the sum is non-positive. */
  qty?: number;
  /** Quantity-weighted average over only the priced legs — may cover fewer units
   *  than `qty` when some legs were unpriced. Omitted when no leg had a price. */
  price?: number;
}

/** One point on the price + P&L time series. P&L fields are null with no price. */
export interface AssetSeriesPoint {
  date: string; // YYYY-MM-DD
  price: number | null;
  /** Units of the asset held on this date (position size after that day's trades). */
  held: number;
  realized: number;
  unrealized: number | null;
  total: number | null;
}
