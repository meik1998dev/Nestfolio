/**
 * Client-safe types for the portfolio performance series. Separate from
 * `performance.ts` so the chart (a client component) can import the point shape
 * without pulling server-only assembly (Supabase, price provider) into the bundle.
 */
export type { AssetRange as PerfRange } from "@/lib/asset/types";
export { ASSET_RANGES as PERF_RANGES, parseRange as parsePerfRange } from "@/lib/asset/types";

/** One point on the portfolio value + P&L time series. */
export interface PerfPoint {
  date: string; // YYYY-MM-DD
  /** Market value of all priced positions on this date (null if none priceable). */
  value: number | null;
  realized: number;
  unrealized: number | null;
  total: number | null;
}
