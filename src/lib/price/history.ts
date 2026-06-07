/**
 * Shared daily-close history helpers — used by the per-asset detail series and
 * the portfolio-wide performance series. Pure-ish: `loadHistory` reads the stored
 * `price_history` table, `ensurePrices` back-fills gaps via the PriceProvider
 * (which persists what it fetches); the rest are pure date/lookup math.
 */
import type { createClient } from "@/lib/supabase/server";
import { priceProvider } from "@/lib/price/provider";
import type { AssetRange } from "@/lib/asset/types";

export const DAY_MS = 86_400_000;

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return isoDay(new Date());
}

/**
 * Start date for a range: a fixed window back, or `earliest` for "Max". Falls
 * back to a year of context when "Max" has nothing to anchor on.
 */
export function rangeStart(range: AssetRange, earliest: string | null): string {
  if (range === "Max") {
    return earliest ?? isoDay(new Date(Date.now() - 365 * DAY_MS));
  }
  const months =
    range === "1M" ? 1 : range === "3M" ? 3 : range === "6M" ? 6 : 12;
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return isoDay(d);
}

/** Inclusive list of YYYY-MM-DD dates from start to end, every `step` days. */
export function sampleDates(start: string, end: string, step: number): string[] {
  const dates: string[] = [];
  let t = new Date(start + "T00:00:00Z").getTime();
  const endT = new Date(end + "T00:00:00Z").getTime();
  while (t < endT) {
    dates.push(isoDay(new Date(t)));
    t += step * DAY_MS;
  }
  dates.push(end); // always include today as the final point
  return dates;
}

/** Read stored daily closes for a ticker within [start, end] into a date→close map. */
export async function loadHistory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  ticker: string,
  start: string,
  end: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await supabase
    .from("price_history")
    .select("date, close")
    .eq("ticker", ticker)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });
  for (const r of (data ?? []) as Array<{ date: string; close: number }>) {
    map.set(r.date, Number(r.close));
  }
  return map;
}

/**
 * Ensure the history map has a close on/before each requested date, fetching via
 * the PriceProvider (which fetches a window + persists) for any that are missing.
 */
export async function ensurePrices(
  map: Map<string, number>,
  ticker: string,
  dates: string[],
): Promise<void> {
  const provider = priceProvider();
  const missing = [...new Set(dates)].filter(
    (d) => priceOnOrBefore(map, d) === null,
  );
  await Promise.all(
    missing.map(async (d) => {
      const close = await provider.histPrice(ticker, d);
      if (close != null) map.set(d, close);
    }),
  );
}

/** Last known close on or before `date` (forward-fills weekends/holidays). */
export function priceOnOrBefore(
  map: Map<string, number>,
  date: string,
): number | null {
  if (map.has(date)) return map.get(date)!;
  let best: { d: string; close: number } | null = null;
  for (const [d, close] of map) {
    if (d <= date && (!best || d > best.d)) best = { d, close };
  }
  return best?.close ?? null;
}
