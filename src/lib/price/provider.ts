/**
 * PriceProvider — live + historical USD prices, kept SEPARATE from the balance
 * source. Tokenized stocks are valued by the underlying equity feed, NEVER the
 * thin-liquidity DEX price (validated: DEX overstated the test portfolio ~2.5×).
 *
 * Primary feed: yahoo-finance2 (free, no key, live + historical, crypto pairs).
 * Keyed fallbacks (Finnhub live, Twelve Data historical) are used only if a key
 * is configured and the primary fails — we never throw if the primary works.
 *
 * Caching (global market-data tables, written via the service role):
 *   - live_prices    : TTL cache (~5 min) keyed by ticker.
 *   - price_history  : immutable daily closes, fetched once per (ticker, date).
 *
 * Server-only (reads service-role env). Exported as a clean interface for F6.
 */
import YahooFinance from "yahoo-finance2";
import { createServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/env";

/**
 * yahoo-finance2 v3 is class-based: methods throw until you instantiate.
 * One shared instance, with the one-time survey notice suppressed.
 */
let _yahoo: YahooLike | null = null;
function defaultYahoo(): YahooLike {
  if (!_yahoo) {
    _yahoo = new YahooFinance({
      suppressNotices: ["yahooSurvey"],
    }) as unknown as YahooLike;
  }
  return _yahoo;
}

/** Grams per troy ounce — for converting XAU spot to a per-gram gold price. */
const GRAMS_PER_TROY_OUNCE = 31.1035;

/** Live-price cache TTL. 1 min keeps pages consistent with each other while
 * still bounding upstream quote calls. */
const LIVE_TTL_MS = 60 * 1000;

/** Yahoo symbol for spot gold (XAU/USD). */
const GOLD_SPOT_SYMBOL = "XAUUSD=X";

export interface PriceQuote {
  ticker: string;
  price: number;
  source: string;
  fetchedAt: string;
}

export interface PriceProvider {
  /** Live USD price for an equity ticker or crypto pair (e.g. "NVDA", "BNB-USD"). */
  livePrice(ticker: string): Promise<number | null>;
  /** Historical daily close for a (ticker, date). `date` is YYYY-MM-DD. */
  histPrice(ticker: string, date: string): Promise<number | null>;
  /** Daily closes for an inclusive date range, fetched in one upstream call. */
  histRange?(
    ticker: string,
    start: string,
    end: string,
  ): Promise<Map<string, number>>;
  /** Spot gold price per gram in USD (XAU spot ÷ grams/oz). */
  goldPerGram(): Promise<number | null>;
}

/** Narrow type for the bits of yahoo-finance2 we use, so it can be mocked. */
export interface YahooLike {
  quote(symbol: string): Promise<{ regularMarketPrice?: number } | null>;
  chart(
    symbol: string,
    opts: { period1: string; period2: string; interval: "1d" },
  ): Promise<{ quotes: Array<{ date: Date; close: number | null }> }>;
}

type Db = ReturnType<typeof createServiceClient>;

export interface YahooPriceProviderDeps {
  yahoo?: YahooLike;
  db?: Db;
  now?: () => number;
}

/** YYYY-MM-DD for a Date in UTC. */
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export class YahooPriceProvider implements PriceProvider {
  private yahoo: YahooLike;
  private db: Db;
  private now: () => number;

  constructor(deps: YahooPriceProviderDeps = {}) {
    this.yahoo = deps.yahoo ?? defaultYahoo();
    this.db = deps.db ?? createServiceClient();
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Live price with a TTL cache. Serves a fresh `live_prices` row if present;
   * otherwise fetches (Yahoo → Finnhub fallback), caches, and returns it.
   * Never throws — returns null on total failure so callers degrade gracefully.
   */
  async livePrice(ticker: string): Promise<number | null> {
    const cached = await this.readFreshLive(ticker);
    if (cached !== null) return cached;

    let price: number | null = null;
    try {
      const q = await this.yahoo.quote(ticker);
      price = q?.regularMarketPrice ?? null;
    } catch {
      // fall through to keyed fallback
    }

    // Keyed fallback (Finnhub) only when configured and the primary missed.
    if (price === null) {
      price = await this.finnhubLive(ticker);
    }

    if (price === null) {
      // Total miss — return last-known cached value if any (even if stale).
      return this.readAnyLive(ticker);
    }

    await this.writeLive(ticker, price);
    return price;
  }

  /**
   * Historical daily close. Immutable: fetched once per (ticker, date), stored,
   * and served from `price_history` thereafter. Never throws.
   */
  async histPrice(ticker: string, date: string): Promise<number | null> {
    const cached = await this.readHistory(ticker, date);
    if (cached !== null) return cached;

    let close: number | null = null;
    try {
      // Pull a small window around the target date; markets close on weekends/
      // holidays, so we take the last available close on or before `date`.
      const start = new Date(date + "T00:00:00Z");
      const period1 = isoDate(new Date(start.getTime() - 6 * 86400000));
      const period2 = isoDate(new Date(start.getTime() + 86400000));
      const res = await this.yahoo.chart(ticker, {
        period1,
        period2,
        interval: "1d",
      });
      close = pickCloseOnOrBefore(res.quotes, date);
    } catch {
      // fall through to keyed fallback
    }

    if (close === null) {
      close = await this.twelveDataHist(ticker, date);
    }

    if (close === null) return null;

    await this.writeHistory(ticker, date, close);
    return close;
  }

  /**
   * Fetch a full daily range in one Yahoo request. This is used by performance
   * pages, where calling `histPrice` hundreds of times makes the page too slow.
   */
  async histRange(
    ticker: string,
    start: string,
    end: string,
  ): Promise<Map<string, number>> {
    const closes = new Map<string, number>();
    try {
      const exclusiveEnd = new Date(end + "T00:00:00Z");
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      const res = await this.yahoo.chart(ticker, {
        period1: start,
        period2: isoDate(exclusiveEnd),
        interval: "1d",
      });
      const rows = res.quotes
        .filter((quote): quote is { date: Date; close: number } => quote.close != null)
        .map((quote) => ({
          ticker,
          date: isoDate(quote.date),
          close: quote.close,
        }));
      for (const row of rows) closes.set(row.date, row.close);
      if (rows.length > 0) {
        await this.db
          .from("price_history")
          .upsert(rows, { onConflict: "ticker,date", ignoreDuplicates: true });
      }
    } catch {
      // Keep the partial/empty map. Callers show a missing-history state.
    }
    return closes;
  }

  /** Spot gold per gram. Uses the live cache under the GOLD_SPOT_SYMBOL key. */
  async goldPerGram(): Promise<number | null> {
    const spot = await this.livePrice(GOLD_SPOT_SYMBOL);
    if (spot === null) return null;
    return spot / GRAMS_PER_TROY_OUNCE;
  }

  // --- cache I/O ----------------------------------------------------------

  private async readFreshLive(ticker: string): Promise<number | null> {
    const { data } = await this.db
      .from("live_prices")
      .select("price, fetched_at")
      .eq("ticker", ticker)
      .maybeSingle();
    if (!data) return null;
    const age = this.now() - new Date(data.fetched_at).getTime();
    if (age > LIVE_TTL_MS) return null;
    return Number(data.price);
  }

  private async readAnyLive(ticker: string): Promise<number | null> {
    const { data } = await this.db
      .from("live_prices")
      .select("price")
      .eq("ticker", ticker)
      .maybeSingle();
    return data ? Number(data.price) : null;
  }

  private async writeLive(ticker: string, price: number): Promise<void> {
    await this.db
      .from("live_prices")
      .upsert(
        { ticker, price, fetched_at: new Date(this.now()).toISOString() },
        { onConflict: "ticker" },
      );
  }

  private async readHistory(
    ticker: string,
    date: string,
  ): Promise<number | null> {
    const { data } = await this.db
      .from("price_history")
      .select("close")
      .eq("ticker", ticker)
      .eq("date", date)
      .maybeSingle();
    return data ? Number(data.close) : null;
  }

  private async writeHistory(
    ticker: string,
    date: string,
    close: number,
  ): Promise<void> {
    // Immutable — ignore conflicts so we never overwrite a stored close.
    await this.db
      .from("price_history")
      .upsert(
        { ticker, date, close },
        { onConflict: "ticker,date", ignoreDuplicates: true },
      );
  }

  // --- keyed fallbacks (no-op when key is empty) --------------------------

  private async finnhubLive(ticker: string): Promise<number | null> {
    const key = env.finnhubApiKey();
    if (!key) return null;
    // Finnhub only covers equities; skip crypto/forex pairs.
    if (ticker.includes("-") || ticker.includes("=")) return null;
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${key}`,
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { c?: number };
      return typeof json.c === "number" && json.c > 0 ? json.c : null;
    } catch {
      return null;
    }
  }

  private async twelveDataHist(
    ticker: string,
    date: string,
  ): Promise<number | null> {
    const key = env.twelveDataApiKey();
    if (!key) return null;
    if (ticker.includes("-") || ticker.includes("=")) return null;
    try {
      const res = await fetch(
        `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&start_date=${date}&end_date=${date}&apikey=${key}`,
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        values?: Array<{ close?: string }>;
      };
      const close = json.values?.[0]?.close;
      return close ? Number(close) : null;
    } catch {
      return null;
    }
  }
}

/** Pick the close on or before `date` from a daily-candle list. */
function pickCloseOnOrBefore(
  quotes: Array<{ date: Date; close: number | null }>,
  date: string,
): number | null {
  const target = new Date(date + "T00:00:00Z").getTime();
  let best: { t: number; close: number } | null = null;
  for (const q of quotes) {
    if (q.close === null) continue;
    const t = q.date.getTime();
    if (t <= target + 86400000 - 1 && (!best || t > best.t)) {
      best = { t, close: q.close };
    }
  }
  return best?.close ?? null;
}

/** Default singleton for app code. Tests construct their own with injected deps. */
let _default: YahooPriceProvider | null = null;
export function priceProvider(): YahooPriceProvider {
  if (!_default) _default = new YahooPriceProvider();
  return _default;
}
