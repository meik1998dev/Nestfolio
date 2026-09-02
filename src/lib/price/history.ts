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
/**
 * Forward-filling a close across more than this many days hides market movement
 * (a "flat" fake segment) — such dates are treated as missing and re-fetched.
 */
const MAX_FORWARD_FILL_DAYS = 4;

/** Newest stored date on or before `date`, or null. */
function lastStoredOnOrBefore(
  map: Map<string, number>,
  date: string,
): string | null {
  let best: string | null = null;
  for (const d of map.keys()) {
    if (d <= date && (!best || d > best)) best = d;
  }
  return best;
}

export async function ensurePrices(
  map: Map<string, number>,
  ticker: string,
  dates: string[],
): Promise<void> {
  const provider = priceProvider();
  const missing = [...new Set(dates)].filter((d) => {
    if (priceOnOrBefore(map, d) === null) return true;
    // A stored close exists, but if it forward-fills a long gap the value is
    // fiction — re-fetch so recent history reflects real closes. Fetched
    // closes persist to price_history, so this heals the cache permanently.
    const last = lastStoredOnOrBefore(map, d);
    if (!last) return true;
    return (Date.parse(d) - Date.parse(last)) / 86_400_000 > MAX_FORWARD_FILL_DAYS;
  });
  await Promise.all(
    missing.map(async (d) => {
      const close = await provider.histPrice(ticker, d);
      if (close != null) map.set(d, close);
    }),
  );
}

/**
 * Fill a chart range with one upstream request per ticker. Existing stored
 * closes stay in the map and win on duplicate dates.
 */
export async function ensurePriceRange(
  map: Map<string, number>,
  ticker: string,
  start: string,
  end: string,
): Promise<void> {
  const endStored = lastStoredOnOrBefore(map, end);
  const endGap = endStored
    ? (Date.parse(end) - Date.parse(endStored)) / DAY_MS
    : Number.POSITIVE_INFINITY;
  const hasStart = priceOnOrBefore(map, start) !== null;
  if (hasStart && endGap <= MAX_FORWARD_FILL_DAYS && !hasInteriorGap(map, start, end)) return;

  const provider = priceProvider();
  if (provider.histRange) {
    const fetched = await provider.histRange(ticker, start, end);
    for (const [date, close] of fetched) if (!map.has(date)) map.set(date, close);
    return;
  }
  await ensurePrices(map, ticker, sampleDates(start, end, 1));
}

/**
 * True when some day inside [start, end] would forward-fill across more than
 * MAX_FORWARD_FILL_DAYS. Such a hole turns a week of market moves into one
 * fake jump on the day the data resumes, which inflates every risk figure.
 */
export function hasInteriorGap(
  map: Map<string, number>,
  start: string,
  end: string,
): boolean {
  const stored = [...map.keys()].filter((d) => d >= start && d <= end).sort();
  let previous = lastStoredOnOrBefore(map, start) ?? start;
  for (const date of [...stored, end]) {
    if ((Date.parse(date) - Date.parse(previous)) / DAY_MS > MAX_FORWARD_FILL_DAYS) return true;
    previous = date;
  }
  return false;
}

/** Saturday or Sunday in UTC. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Crypto pairs trade every day; anything else is an exchange-listed market. */
export function tradesOnWeekends(ticker: string): boolean {
  return ticker.toUpperCase().endsWith("-USD");
}

/**
 * Drop weekend-dated closes for exchange-listed tickers. A weekend row is a
 * mislabelled Friday close (single-date fetches store the last close under the
 * requested date), so keeping it moves a day's return onto a Saturday and can
 * double it against a later real close. Weekday rows forward-fill instead.
 */
export function dropWeekendCloses(map: Map<string, number>, ticker: string): void {
  if (tradesOnWeekends(ticker)) return;
  for (const date of [...map.keys()]) if (isWeekend(date)) map.delete(date);
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
