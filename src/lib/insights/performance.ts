/**
 * Portfolio-wide performance series — the dashboard / PnL counterpart to the
 * per-asset `getAssetDetail` series. Replays the WHOLE trade ledger (manual +
 * wallet) at each sampled date and sums market value + realized / unrealized P&L
 * across every ticker, giving a dense daily "value & P&L over time" curve.
 *
 * Why recompute from trades (not the materialized `cost_basis` / `snapshots`):
 * `cost_basis` has no history and `snapshots` are sparse (one per day, only when
 * taken). Replaying the ledger against stored daily closes yields a continuous
 * line at any range — the same trick the asset page uses, just aggregated.
 *
 * Methodology note: "value" is the market value of *traded positions* (the same
 * universe `getPnl` reports on), not cash. Stablecoin deposits are cash and don't
 * enter the position ledger, so they're excluded — consistent with the PnL view.
 */
import { createClient } from "@/lib/supabase/server";
import { resolveToken } from "@/lib/price/ticker";
import {
  listTransactions,
  listWalletTrades,
  type TradeRow,
} from "@/lib/ledger/transactions";
import {
  buildLedger,
  positionPnl,
} from "@/lib/pnl/costbasis";
import type { TradeEventInput, TradeEventKind } from "@/lib/pnl/classify";
import {
  isoDay,
  todayIso,
  rangeStart,
  sampleDates,
  loadHistory,
  ensurePrices,
  priceOnOrBefore,
} from "@/lib/price/history";
import type {
  PnlTimeframe,
  TimeframePnl,
} from "@/lib/pnl/timeframe.types";
import type { PerfPoint, PerfRange } from "./performance.types";

export type { PerfPoint, PerfRange } from "./performance.types";
export { PERF_RANGES, parsePerfRange } from "./performance.types";

export interface PerformanceView {
  range: PerfRange;
  series: PerfPoint[];
  /** True when there are no trades to build a series from. */
  empty: boolean;
}

/** Days between sampled points, per range — keeps history calls bounded. */
const STEP_DAYS: Record<PerfRange, number> = {
  "1M": 1,
  "3M": 2,
  "6M": 3,
  "1Y": 7,
  Max: 7,
};

/** One trade tagged with the pricing ticker its position aggregates under. */
interface TaggedTrade {
  row: TradeRow;
  ticker: string;
}

/**
 * Assemble the portfolio value + P&L series for the given range. Empty (no
 * series) when the user has no priceable trades yet.
 */
export async function getPortfolioPerformance(
  range: PerfRange,
): Promise<PerformanceView> {
  const supabase = await createClient();
  const { trades, events, tickers, earliest } = await loadTradeEvents();

  if (trades.length === 0) {
    return { range, series: [], empty: true };
  }

  const startIso = rangeStart(range, earliest);
  const today = todayIso();
  const axis = sampleDates(startIso, today, STEP_DAYS[range]);

  const histLookup = await loadHistories(
    supabase,
    trades,
    tickers,
    startIso,
    today,
    axis,
  );

  const liveByTicker = await readLivePrices(supabase, tickers);

  // --- Replay the ledger at each sampled date, summing across tickers ---
  const series: PerfPoint[] = [];
  for (const date of axis) {
    const upTo = events.filter((e) => e.ts.slice(0, 10) <= date);
    let positions;
    try {
      positions = buildLedger(upTo, histLookup);
    } catch {
      // A 1-leg trade in this window has no historical price — skip this point.
      continue;
    }

    let value = 0;
    let realized = 0;
    let unrealized = 0;
    let priced = false;
    let pricedHeld = true;
    for (const pos of positions) {
      // The final point uses live prices so it ties out with the headline cards.
      const price =
        date === today
          ? (liveByTicker.get(pos.ticker) ?? histLookup(pos.ticker, date))
          : histLookup(pos.ticker, date);
      const p = positionPnl(pos, price);
      realized += p.realizedPnl;
      if (p.marketValue !== null) {
        value += p.marketValue;
        unrealized += p.unrealizedPnl ?? 0;
        priced = true;
      } else if (pos.shares > 0) {
        pricedHeld = false; // a held position we couldn't price → totals partial
      }
    }

    const valueOut = priced ? value : null;
    const unrealizedOut = pricedHeld && priced ? unrealized : null;
    series.push({
      date,
      value: valueOut,
      realized,
      unrealized: unrealizedOut,
      total: unrealizedOut !== null ? realized + unrealizedOut : null,
    });
  }

  return { range, series, empty: false };
}

interface LoadedTrades {
  trades: TaggedTrade[];
  events: TradeEventInput[];
  tickers: string[];
  earliest: string | null;
}

/**
 * Load manual + wallet trades, tag each with its pricing ticker (dropping
 * unpriceable spam / unknown tokens), and derive the classified event stream the
 * ledger replays. Shared by the performance series and the timeframe PnL.
 */
async function loadTradeEvents(): Promise<LoadedTrades> {
  const [manual, walletTrades] = await Promise.all([
    listTransactions(),
    listWalletTrades(),
  ]);

  const manualRows: TradeRow[] = manual.map((t) => ({
    id: t.id,
    date: t.date,
    type: t.type,
    asset: t.asset,
    amount: Number(t.amount),
    price: t.price != null ? Number(t.price) : null,
    value: t.price != null ? Number(t.price) * Number(t.amount) : null,
    source: "manual" as const,
    note: t.note,
  }));

  const trades: TaggedTrade[] = [...manualRows, ...walletTrades]
    .map((row) => {
      const ticker = resolveToken(row.asset).ticker;
      return ticker ? { row, ticker: ticker.toUpperCase() } : null;
    })
    .filter((t): t is TaggedTrade => t !== null);

  const events: TradeEventInput[] = trades.map(({ row, ticker }) => ({
    type: row.type as TradeEventKind,
    ticker,
    shares: row.amount,
    usdValue: row.value ?? undefined,
    ts: row.date,
    tx_hash: row.id,
  }));

  const tickers = [...new Set(trades.map((t) => t.ticker))];
  const earliest = trades.reduce<string | null>(
    (min, t) => (min === null || t.row.date < min ? t.row.date : min),
    null,
  );

  return { trades, events, tickers, earliest };
}

/**
 * Load daily-close history per ticker over [startIso, today], seed captured
 * 1-leg (delivery/send) prices, and back-fill missing closes on each requested
 * valuation date. Returns a (ticker, date) → close lookup that forward-fills.
 */
async function loadHistories(
  supabase: Awaited<ReturnType<typeof createClient>>,
  trades: TaggedTrade[],
  tickers: string[],
  startIso: string,
  today: string,
  valuationDates: string[],
): Promise<(ticker: string, date: string) => number | null> {
  const histByTicker = new Map<string, Map<string, number>>();
  await Promise.all(
    tickers.map(async (ticker) => {
      const map = await loadHistory(supabase, ticker, startIso, today);
      // Seed captured 1-leg prices so the ledger can price them even if a
      // historical re-fetch fails (and even for legs before startIso).
      for (const { row, ticker: tk } of trades) {
        if (
          tk === ticker &&
          (row.type === "delivery" || row.type === "send") &&
          row.price != null
        ) {
          const d = row.date.slice(0, 10);
          if (!map.has(d)) map.set(d, row.price);
        }
      }
      const onLegDates = trades
        .filter(
          (t) =>
            t.ticker === ticker &&
            (t.row.type === "delivery" || t.row.type === "send"),
        )
        .map((t) => t.row.date.slice(0, 10));
      await ensurePrices(map, ticker, [...valuationDates, ...onLegDates]);
      histByTicker.set(ticker, map);
    }),
  );

  return (ticker: string, date: string): number | null => {
    const map = histByTicker.get(ticker);
    return map ? priceOnOrBefore(map, date) : null;
  };
}

/** Windowed timeframes and their look-back offset from today. */
const TIMEFRAME_WINDOWS: ReadonlyArray<{
  tf: PnlTimeframe;
  days?: number;
  months?: number;
}> = [
  { tf: "1D", days: 1 },
  { tf: "7D", days: 7 },
  { tf: "1M", months: 1 },
  { tf: "3M", months: 3 },
  { tf: "1Y", months: 12 },
];

/** YYYY-MM-DD `days`/`months` before `today` (UTC). */
function baselineDate(
  today: string,
  window: { days?: number; months?: number },
): string {
  const d = new Date(today + "T00:00:00Z");
  if (window.days) d.setUTCDate(d.getUTCDate() - window.days);
  if (window.months) d.setUTCMonth(d.getUTCMonth() - window.months);
  return isoDay(d);
}

/** Σ realized / (priced) unrealized over the replayed ledger as of `date`. */
function rollupAsOf(
  events: TradeEventInput[],
  date: string,
  isToday: boolean,
  histLookup: (ticker: string, date: string) => number | null,
  liveByTicker: Map<string, number>,
): { realized: number; unrealized: number; total: number; partial: boolean } {
  let positions;
  try {
    positions = buildLedger(
      events.filter((e) => e.ts.slice(0, 10) <= date),
      histLookup,
    );
  } catch {
    // A 1-leg trade in this window has no historical price → treat as partial.
    return { realized: 0, unrealized: 0, total: 0, partial: true };
  }

  let realized = 0;
  let unrealized = 0;
  let partial = false;
  for (const pos of positions) {
    const price = isToday
      ? (liveByTicker.get(pos.ticker) ?? histLookup(pos.ticker, date))
      : histLookup(pos.ticker, date);
    const p = positionPnl(pos, price);
    realized += p.realizedPnl;
    if (p.unrealizedPnl !== null) unrealized += p.unrealizedPnl;
    else if (pos.shares > 0) partial = true;
  }
  return { realized, unrealized, total: realized + unrealized, partial };
}

/**
 * Period PnL per windowed timeframe: the change in cumulative realized /
 * unrealized / total between the window's start and now. Total PnL is continuous
 * across buys/sells (a sell just moves value from unrealized to realized), so the
 * delta is the true PnL *generated during* the window.
 *
 * The "all" timeframe is the cumulative rollup itself and is supplied separately
 * by the caller (from `getPnl`, the authoritative cost_basis path). Returns an
 * empty array when there are no priceable trades.
 */
export async function getTimeframePnl(): Promise<TimeframePnl[]> {
  const supabase = await createClient();
  const { trades, events, tickers } = await loadTradeEvents();
  if (trades.length === 0) return [];

  const today = todayIso();
  const baselines = TIMEFRAME_WINDOWS.map((w) => baselineDate(today, w));
  const startIso = baselines.reduce((min, d) => (d < min ? d : min), today);

  const histLookup = await loadHistories(
    supabase,
    trades,
    tickers,
    startIso,
    today,
    [...baselines, today],
  );
  const liveByTicker = await readLivePrices(supabase, tickers);

  const now = rollupAsOf(events, today, true, histLookup, liveByTicker);

  return TIMEFRAME_WINDOWS.map((w, i) => {
    const base = rollupAsOf(
      events,
      baselines[i],
      false,
      histLookup,
      liveByTicker,
    );
    return {
      timeframe: w.tf,
      realized: now.realized - base.realized,
      unrealized: now.unrealized - base.unrealized,
      total: now.total - base.total,
      partial: now.partial || base.partial,
    };
  });
}

/** Read cached live prices for the given tickers into a ticker→price map. */
async function readLivePrices(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tickers: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (tickers.length === 0) return map;
  const { data } = await supabase
    .from("live_prices")
    .select("ticker, price")
    .in("ticker", tickers);
  for (const r of (data ?? []) as Array<{ ticker: string; price: number }>) {
    map.set(r.ticker.toUpperCase(), Number(r.price));
  }
  return map;
}
