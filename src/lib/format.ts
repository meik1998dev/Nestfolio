/**
 * Display formatting for money, quantities, and percentages.
 * Finance UIs live or die on legible numbers — always tabular, sign-aware.
 */

/** USD currency, 2 decimals. `compact` for axis labels / tight cards. */
export function formatUSD(
  value: number,
  opts: { compact?: boolean; signed?: boolean } = {},
): string {
  const { compact, signed } = opts;
  const sign = signed && value > 0 ? "+" : "";
  return (
    sign +
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 2,
      minimumFractionDigits: compact ? 0 : 2,
    }).format(value)
  );
}

/** Token / share quantity. Trims trailing zeros, caps precision. */
export function formatQty(value: number, maxDecimals = 6): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxDecimals,
  }).format(value);
}

/** Percentage from a ratio already in percent units (e.g. 12.5 → "12.5%"). */
export function formatPct(
  value: number,
  opts: { signed?: boolean } = {},
): string {
  const sign = opts.signed && value > 0 ? "+" : "";
  return `${sign}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 0,
  }).format(value)}%`;
}

/** Percentage from a 0..1 ratio (0.125 → "12.5%"). */
export function formatRatioPct(
  ratio: number,
  opts: { signed?: boolean } = {},
): string {
  return formatPct(ratio * 100, opts);
}

/** Tailwind text color for a gain/loss value. Neutral at exactly 0. */
export function pnlColor(value: number): string {
  if (value > 0) return "text-emerald-600 dark:text-emerald-500";
  if (value < 0) return "text-red-600 dark:text-red-500";
  return "text-muted-foreground";
}

/** Short, human date (e.g. "Jun 7, 2026"). */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
