/**
 * Portfolio-wide performance series — the dashboard / PnL counterpart to the
 * per-asset `getAssetDetail` series. Replays the WHOLE trade ledger (manual +
 * wallet) at each sampled date and sums market value + realized / unrealized P&L
 * across every ticker, giving a dense daily "value & P&L over time" curve.
 *
 * Why recompute from trades (not the materialized `cost_basis`):
 * `cost_basis` has no history. Replaying the ledger against stored daily closes
 * yields a continuous line at any range — the same trick the asset page uses,
 * just aggregated.
 *
 * Methodology note: "value" is the market value of *traded positions* (the same
 * universe `getPnl` reports on), not cash. Stablecoin deposits are cash and don't
 * enter the position ledger, so they're excluded — consistent with the PnL view.
 */
import { createClient } from "@/lib/supabase/server";
import { resolveToken, isStablecoin } from "@/lib/price/ticker";
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

/** Tuning for a performance run. */
export interface PerfOptions {
  /**
   * Restrict the replayed ledger to a portfolio subtree's pricing tickers. Each
   * trade is resolved with a bare-ticker-aware resolver and kept only if its
   * ticker is in this set — so a stock trade stored as "NVDA"/"NVDAON" maps to
   * the same "NVDA" the holdings resolve to. Omit for the whole-ledger view.
   */
  tickers?: Set<string>;
  /** Also compute the SPY benchmark (return % + $ what-if) fields. */
  benchmark?: boolean;
}

/** The benchmark ticker — SPY ETF, dividend-adjusted close via the Yahoo provider. */
const SPY_TICKER = "SPY";

/**
 * Resolve a trade's `asset` to its pricing ticker. `resolveToken` handles the
 * tokenized form (NVDAon → NVDA) and crypto pairs; when it can't (the asset is
 * already a bare equity ticker like "NVDA", or an upper-cased "NVDAON" manual
 * entry), fall back to the known subtree ticker set.
 */
function scopedTicker(asset: string, scope?: Set<string>): string | null {
  const direct = resolveToken(asset).ticker;
  if (direct) return direct.toUpperCase();
  if (!scope) return null;
  const up = asset.trim().toUpperCase();
  if (scope.has(up)) return up; // bare ticker, e.g. "NVDA"
  if (up.endsWith("ON") && scope.has(up.slice(0, -2))) return up.slice(0, -2); // "NVDAON"
  return null;
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
  opts: PerfOptions = {},
): Promise<PerformanceView> {
  const supabase = await createClient();
  // Whole ledger; a portfolio scopes it to its subtree tickers (resolving bare
  // tickers the global resolver can't). Dashboard passes no scope → everything.
  const rows = await loadAllRows();
  const resolver = opts.tickers
    ? (a: string) => scopedTicker(a, opts.tickers)
    : (a: string) => resolveToken(a).ticker;
  const { trades, events, tickers, earliest } = buildLoaded(
    rows,
    resolver,
    opts.tickers,
  );

  if (trades.length === 0) {
    return { range, series: [], empty: true };
  }

  // Never plot before the first trade — a fixed range (1Y/6M/…) that reaches
  // back before you started investing would otherwise show a flat $0 lead-in.
  const rangeStartIso = rangeStart(range, earliest);
  const startIso =
    earliest && earliest > rangeStartIso ? earliest : rangeStartIso;
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

  // --- Optional SPY benchmark: load closes back to the first trade (the mirror
  // walks ALL trades, not just in-range, to get correct shares at range start). ---
  let spyAt: (d: string) => number | null = () => null;
  let benchTimeline: BenchPoint[] | null = null;
  let spyLiveOrNull: number | null = null;
  // SPY close on/just before the chart's start — the anchor the Return % index
  // line rebases to, so it reads as "S&P 500 buy-and-hold since <chart start>".
  let spyAnchor: number | null = null;
  if (opts.benchmark) {
    const spyStart = earliest ?? startIso;
    const spyMap = await loadHistory(supabase, SPY_TICKER, spyStart, today);
    const tradeDays = trades.map((t) => t.row.date.slice(0, 10));
    await ensurePrices(spyMap, SPY_TICKER, [...axis, ...tradeDays]);
    spyAt = (d) => priceOnOrBefore(spyMap, d);
    benchTimeline = buildBenchmarkTimeline(trades, histLookup, spyAt);
    spyAnchor = spyAt(startIso);
    const spyLive = await readLivePrices(supabase, [SPY_TICKER]);
    spyLiveOrNull = spyLive.get(SPY_TICKER) ?? null;
  }

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
    const point: PerfPoint = {
      date,
      value: valueOut,
      realized,
      unrealized: unrealizedOut,
      total: unrealizedOut !== null ? realized + unrealizedOut : null,
    };

    if (benchTimeline) {
      const b = benchAsOf(benchTimeline, date);
      // Live SPY close on the final point so it ties out with "now".
      const spyNow = date === today ? (spyLiveOrNull ?? spyAt(date)) : spyAt(date);
      const invested = b && b.costDeployed > 1e-6 ? b.costDeployed : null;
      const spyValue =
        b && spyNow != null ? Math.max(b.spyShares, 0) * spyNow : null;
      point.investedCapital = invested;
      // Total return on deployed capital — realized + unrealized over net cost, so
      // it ties to the Total P&L card. valueOut already carries held cost +
      // unrealized; adding `realized` makes the numerator the full P&L.
      point.returnPct =
        invested != null && valueOut != null
          ? (valueOut + realized) / invested - 1
          : null;
      point.spyValue = spyValue;
      // Return % tab: the S&P 500 INDEX bought and held from the chart's start —
      // price(d) / price(start) − 1. The headline "what the market did" (the figure
      // Yahoo/Google quote), independent of when you added capital.
      point.spyReturnPct =
        spyAnchor != null && spyAnchor > 0 && spyNow != null
          ? spyNow / spyAnchor - 1
          : null;
      // Value / P&L tabs keep the dollar "what-if": your exact cash flows mirrored
      // into SPY (held value, and realized + unrealized P&L). A dollar line has to
      // track your actual deposits, so it's money-weighted and sits below the index
      // % above when most capital was deployed recently.
      const spyRealized = b?.spyRealized ?? 0;
      point.spyTotal =
        b != null && spyValue != null
          ? spyValue - b.costDeployed + spyRealized
          : null;
    }

    series.push(point);
  }

  return { range, series, empty: false };
}

/** A point in the cumulative benchmark mirror, recorded after each trade. */
interface BenchPoint {
  date: string;
  /** Net capital deployed at cost (Σ acquisitions − Σ disposals at avg cost). */
  costDeployed: number;
  /** SPY shares held by mirroring each acquisition's USD into SPY. */
  spyShares: number;
  /**
   * Cumulative realized P&L of the SPY mirror: when the portfolio sells, the
   * mirror sells the same *proportion* of SPY shares at that day's SPY close, and
   * (proceeds − cost retired) accrues here. Keeps the benchmark apples-to-apples
   * with the portfolio's realized P&L instead of silently discarding it.
   */
  spyRealized: number;
}

/**
 * Build the SPY "what-if" mirror by replaying trades once in date order. Each
 * acquisition deploys its USD cost into SPY (shares += usd / spyClose); each
 * disposal removes the same *proportion* of SPY shares as the cost it retires,
 * so `spyShares` and the cost-basis denominator stay in lock-step. The result is
 * an apples-to-apples "same cash flows, but in SPY" position over time.
 *
 * Denominator is cost (not proceeds) so a profitable partial sell doesn't blow
 * up the return %. Returns one entry per trade, ascending by date.
 */
function buildBenchmarkTimeline(
  trades: TaggedTrade[],
  histLookup: (ticker: string, date: string) => number | null,
  spyAt: (date: string) => number | null,
): BenchPoint[] {
  const sorted = [...trades].sort((a, b) =>
    a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : 0,
  );
  const pos = new Map<string, { shares: number; cost: number }>();
  let costDeployed = 0;
  let spyShares = 0;
  let spyCost = 0; // == costDeployed; tracked to size proportional disposals
  let spyRealized = 0; // cumulative realized P&L of the mirror's proportional sells
  const timeline: BenchPoint[] = [];

  for (const t of sorted) {
    const d = t.row.date.slice(0, 10);
    const acquire = t.row.type === "buy" || t.row.type === "delivery";
    // USD deployed: explicit trade value, else qty × that day's asset close.
    const px = histLookup(t.ticker, d);
    const usd = t.row.value ?? (px != null ? t.row.amount * px : null);
    let p = pos.get(t.ticker);
    if (!p) {
      p = { shares: 0, cost: 0 };
      pos.set(t.ticker, p);
    }

    if (acquire) {
      if (usd != null) {
        const sc = spyAt(d);
        p.shares += t.row.amount;
        p.cost += usd;
        costDeployed += usd;
        spyCost += usd;
        if (sc != null) spyShares += usd / sc;
      }
    } else {
      const avg = p.shares > 0 ? p.cost / p.shares : 0;
      const costRemoved = avg * t.row.amount;
      const frac = spyCost > 0 ? costRemoved / spyCost : 0;
      const spySharesSold = spyShares * frac;
      const sc = spyAt(d);
      // Mirror the sell: realize (proceeds − cost retired) into the SPY ledger so
      // the benchmark's realized P&L tracks the portfolio's, not just its held leg.
      if (sc != null) spyRealized += spySharesSold * sc - costRemoved;
      spyShares -= spySharesSold;
      spyCost -= costRemoved;
      p.cost -= costRemoved;
      p.shares -= t.row.amount;
      costDeployed -= costRemoved;
    }
    timeline.push({ date: d, costDeployed, spyShares, spyRealized });
  }
  return timeline;
}

/** Latest benchmark point on or before `date` (timeline is ascending). */
function benchAsOf(timeline: BenchPoint[], date: string): BenchPoint | null {
  let best: BenchPoint | null = null;
  for (const b of timeline) {
    if (b.date <= date) best = b;
    else break;
  }
  return best;
}

interface LoadedTrades {
  trades: TaggedTrade[];
  events: TradeEventInput[];
  tickers: string[];
  earliest: string | null;
}

/** Combined manual + wallet trade rows (raw, unresolved), the row source for replay. */
export async function loadAllRows(): Promise<TradeRow[]> {
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

  return [...manualRows, ...walletTrades];
}

/**
 * Resolve one row to its pricing ticker. Wallet rows already carry the resolved
 * equity/pair ticker (the classifier wrote "NVDA", "BTC-USD") — re-running
 * `resolveToken` on a bare "NVDA" wrongly yields "unknown" and would drop the
 * position, so we take it as-is (cash/stablecoin tickers still drop to null).
 * Manual rows hold raw symbols and go through the caller's resolver: the global
 * `resolveToken`, or the subtree-aware `scopedTicker` for a portfolio scope.
 */
function tickerForRow(
  row: TradeRow,
  resolveTicker: (asset: string) => string | null,
): string | null {
  if (row.source === "wallet") {
    return isStablecoin(row.asset) ? null : row.asset.toUpperCase();
  }
  return resolveTicker(row.asset)?.toUpperCase() ?? null;
}

/**
 * Tag each trade row with its pricing ticker (dropping rows that don't resolve),
 * then derive the classified event stream the ledger replays. `resolveTicker`
 * varies by caller: the global ledger uses plain `resolveToken`; a portfolio uses
 * the subtree-aware `scopedTicker`. When `keep` is given, only trades whose
 * resolved ticker is in it survive (scopes a portfolio to its own positions).
 */
export function buildLoaded(
  rows: TradeRow[],
  resolveTicker: (asset: string) => string | null,
  keep?: Set<string>,
): LoadedTrades {
  const trades: TaggedTrade[] = rows
    .map((row) => {
      const ticker = tickerForRow(row, resolveTicker);
      return ticker && (!keep || keep.has(ticker)) ? { row, ticker } : null;
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

/** Load daily-close history per ticker over [startIso, today], seed captured
 *  1-leg (delivery/send) prices, and back-fill missing closes on each requested
 *  valuation date. Returns a (ticker, date) → close lookup that forward-fills. */
export async function loadHistories(
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
export async function getTimeframePnl(
  opts: { tickers?: Set<string> } = {},
): Promise<TimeframePnl[]> {
  const supabase = await createClient();
  // Scope to a portfolio subtree / single asset when `tickers` is given (same
  // bare-ticker-aware resolver the performance series uses); else whole ledger.
  const rows = await loadAllRows();
  const resolver = opts.tickers
    ? (a: string) => scopedTicker(a, opts.tickers)
    : (a: string) => resolveToken(a).ticker;
  const { trades, events, tickers } = buildLoaded(rows, resolver, opts.tickers);
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
