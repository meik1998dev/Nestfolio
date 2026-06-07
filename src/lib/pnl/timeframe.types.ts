/**
 * Client-safe types for the PnL timeframe selector. Kept separate from the
 * server compute (`@/lib/insights/performance`) so the client tab component can
 * import the shape + labels without pulling Supabase / price-provider code into
 * the bundle.
 */

/** Selectable PnL windows. "all" is cumulative since inception; the rest are periods ending now. */
export const PNL_TIMEFRAMES = ["all", "1D", "7D", "1M", "3M", "1Y"] as const;
export type PnlTimeframe = (typeof PNL_TIMEFRAMES)[number];

/** Human labels for the tab bar. */
export const TIMEFRAME_LABELS: Record<PnlTimeframe, string> = {
  all: "All",
  "1D": "Today",
  "7D": "7 days",
  "1M": "1 month",
  "3M": "3 months",
  "1Y": "1 year",
};

/** Realized / unrealized / total PnL for one timeframe. */
export interface TimeframePnl {
  timeframe: PnlTimeframe;
  realized: number;
  unrealized: number;
  total: number;
  /** True when a held position lacked a price at one of the window endpoints. */
  partial: boolean;
}
