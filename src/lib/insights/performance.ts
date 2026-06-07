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
  todayIso,
  rangeStart,
  sampleDates,
  loadHistory,
  ensurePrices,
  priceOnOrBefore,
} from "@/lib/price/history";
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

  // Tag every trade with its pricing ticker; drop unpriceable assets (spam /
  // unknown tokens) — they can't be valued or contribute P&L.
  const trades: TaggedTrade[] = [...manualRows, ...walletTrades]
    .map((row) => {
      const ticker = resolveToken(row.asset).ticker;
      return ticker ? { row, ticker: ticker.toUpperCase() } : null;
    })
    .filter((t): t is TaggedTrade => t !== null);

  if (trades.length === 0) {
    return { range, series: [], empty: true };
  }

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
  const startIso = rangeStart(range, earliest);
  const today = todayIso();
  const axis = sampleDates(startIso, today, STEP_DAYS[range]);

  // --- Historical closes per ticker over the axis + any 1-leg event dates ---
  const histByTicker = new Map<string, Map<string, number>>();
  await Promise.all(
    tickers.map(async (ticker) => {
      const map = await loadHistory(supabase, ticker, startIso, today);
      // Seed captured 1-leg (delivery/send) prices so the ledger can price them
      // even if a historical re-fetch fails.
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
      await ensurePrices(map, ticker, [...axis, ...onLegDates]);
      histByTicker.set(ticker, map);
    }),
  );

  const histLookup = (ticker: string, date: string): number | null => {
    const map = histByTicker.get(ticker);
    return map ? priceOnOrBefore(map, date) : null;
  };

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
