/**
 * Per-asset detail assembly (e.g. PAXG / Pax Gold). Scopes the trade ledger and
 * price history down to a single asset so its page can show realized / unrealized
 * / total P&L, every trade touching it, and a Google-Finance-style time series of
 * price and P&L.
 *
 * Why not `getPnl`: the materialized `cost_basis` table is populated ONLY from
 * wallet-synced trades. Manual `transactions` (buy/sell) never feed it. So we
 * recompute the ledger directly from ALL trades (manual + wallet) for the one
 * asset, reusing the pure `buildLedger` / `positionPnl` math. Replaying that
 * ledger at each past date also gives us the historical P&L series for free.
 *
 * Degrades gracefully: a missing/unfetchable price yields null P&L (rendered as
 * "—"); a ledger that can't be built (e.g. a 1-leg trade with no historical
 * price) collapses to an empty series rather than crashing the page.
 */
import { createClient } from "@/lib/supabase/server";
import { resolveToken } from "@/lib/price/ticker";
import { listHoldings } from "@/lib/ledger/holdings";
import {
  listTransactions,
  listWalletTrades,
  type TradeRow,
} from "@/lib/ledger/transactions";
import { getLivePricesForHoldings } from "@/lib/portfolio/prices";
import { tickerForAsset } from "@/lib/portfolio/valuation";
import {
  buildLedger,
  positionPnl,
  type LedgerPosition,
} from "@/lib/pnl/costbasis";
import type { TradeEventInput, TradeEventKind } from "@/lib/pnl/classify";
import {
  todayIso,
  rangeStart as rangeStartFor,
  sampleDates,
  loadHistory,
  ensurePrices,
  priceOnOrBefore,
} from "@/lib/price/history";
import type { AssetRange, AssetSeriesPoint } from "./types";

export { ASSET_RANGES, parseRange } from "./types";
export type { AssetRange, AssetSeriesPoint } from "./types";

/** Everything the asset detail page renders. */
export interface AssetDetail {
  symbol: string;
  displayName: string;
  kind: string;
  /** Pricing ticker (e.g. "PAXG-USD"), or null when unpriceable. */
  ticker: string | null;
  range: AssetRange;
  /** Units currently held across all matching holdings. */
  amountHeld: number;
  livePrice: number | null;
  marketValue: number | null;
  avgCost: number;
  costBasis: number;
  realized: number;
  unrealized: number | null;
  total: number | null;
  /** True when a live price is available (drives "—" fallbacks). */
  hasPrice: boolean;
  /**
   * True when there's trade history to derive cost basis from. When false (a
   * holding with no recorded trades), P&L is genuinely unknown — the page shows
   * "—" rather than a misleading $0.
   */
  pnlKnown: boolean;
  transactions: TradeRow[];
  series: AssetSeriesPoint[];
}

/** Days between sampled series points, per range — keeps history calls bounded. */
const STEP_DAYS: Record<AssetRange, number> = {
  "1M": 1,
  "3M": 2,
  "6M": 3,
  "1Y": 7,
  Max: 7,
};

/**
 * Identity keys for an asset symbol — every form the same asset might be spelled
 * as: the raw uppercase symbol, its resolved pricing ticker, and its stripped
 * equity ticker. Two symbols are "the same asset" if their key sets intersect.
 */
function assetKeys(symbol: string): Set<string> {
  const keys = new Set<string>();
  const upper = symbol.trim().toUpperCase();
  if (upper) keys.add(upper);
  const t = resolveToken(symbol).ticker;
  if (t) keys.add(t.toUpperCase());
  const stripped = tickerForAsset(symbol);
  if (stripped) keys.add(stripped);
  return keys;
}

/** Empty position so pre-first-trade points read a flat zero rather than a gap. */
function emptyPosition(ticker: string): LedgerPosition {
  return { ticker, shares: 0, costBasis: 0, realizedPnl: 0 };
}

/**
 * Assemble the full detail view for one asset symbol, or null when the user has
 * never held or traded it (the page renders a 404).
 */
export async function getAssetDetail(
  symbol: string,
  range: AssetRange,
): Promise<AssetDetail | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const resolved = resolveToken(symbol);
  const rawUpper = symbol.trim().toUpperCase();

  // Assets are spelled differently across the app: the on-chain symbol
  // ("ORCLON"), the equity ticker the trade classifier emits ("ORCL"), or the
  // pricing pair ("PAXG-USD"). Match on the intersection of identity keys so all
  // forms of the same asset resolve to one page.
  const pageKeys = assetKeys(symbol);
  const matches = (asset: string): boolean => {
    for (const k of assetKeys(asset)) if (pageKeys.has(k)) return true;
    return false;
  };

  const [manual, walletTrades, holdings] = await Promise.all([
    listTransactions(),
    listWalletTrades(),
    listHoldings(),
  ]);

  const manualRows: TradeRow[] = manual
    .filter((t) => matches(t.asset))
    .map((t) => ({
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
  const walletRows = walletTrades.filter((t) => matches(t.asset));
  const matchingHoldings = holdings.filter((h) => matches(h.asset));

  if (
    manualRows.length === 0 &&
    walletRows.length === 0 &&
    matchingHoldings.length === 0
  ) {
    return null;
  }

  const transactions: TradeRow[] = [...manualRows, ...walletRows].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  const amountHeld = matchingHoldings.reduce(
    (sum, h) => sum + Number(h.amount),
    0,
  );

  // Live price: resolve every holding to its ticker and pull a fresh quote.
  const priceMap = await getLivePricesForHoldings(matchingHoldings);
  const livePrice =
    resolved.kind === "stablecoin"
      ? 1
      : resolved.ticker
        ? (priceMap.get(resolved.ticker.toUpperCase()) ?? null)
        : null;

  // All trades become one event stream, keyed by the single pricing ticker so
  // they aggregate into one position regardless of how each row spelled the asset.
  const ledgerTicker = resolved.ticker ?? rawUpper;
  const events: TradeEventInput[] = transactions.map((t) => ({
    type: t.type as TradeEventKind,
    ticker: ledgerTicker,
    shares: t.amount,
    usdValue: t.value ?? undefined,
    ts: t.date,
    tx_hash: t.id,
  }));

  // --- Historical prices for the range + any 1-leg event dates ---
  const earliestTrade = transactions.reduce<string | null>(
    (min, t) => (min === null || t.date < min ? t.date : min),
    null,
  );
  const startIso = rangeStartFor(range, earliestTrade);
  const today = todayIso();
  const histMap = await loadHistory(supabase, ledgerTicker, startIso, today);
  const lookup = (date: string): number | null =>
    priceOnOrBefore(histMap, date);

  // Seed the captured unit price for 1-leg trades (delivery/send) at their date —
  // it's the price recorded at sync time, so buildLedger can price them even if a
  // historical re-fetch later fails.
  for (const t of transactions) {
    if ((t.type === "delivery" || t.type === "send") && t.price != null) {
      const d = t.date.slice(0, 10);
      if (!histMap.has(d)) histMap.set(d, t.price);
    }
  }

  // 1-leg events (delivery/send) are priced from history by buildLedger and will
  // throw if absent — ensure their dates exist no matter the chart range.
  await ensurePrices(
    histMap,
    ledgerTicker,
    events
      .filter((e) => e.type === "delivery" || e.type === "send")
      .map((e) => e.ts.slice(0, 10)),
  );

  // Sampled axis dates for the chart; fetch any missing closes once.
  const axis = sampleDates(startIso, today, STEP_DAYS[range]);
  await ensurePrices(histMap, ledgerTicker, axis);

  // --- Current headline P&L ---
  let current = positionPnl(emptyPosition(ledgerTicker), livePrice);
  let ledgerOk = true;
  try {
    const pos = buildLedger(events, lookup)[0] ?? emptyPosition(ledgerTicker);
    current = positionPnl(pos, livePrice);
  } catch {
    // Unbuildable ledger (e.g. unpriceable 1-leg trade) — P&L is unknown.
    ledgerOk = false;
  }

  // --- Price + P&L time series ---
  const series = buildSeries(events, axis, lookup, livePrice, today, ledgerTicker);

  // P&L needs trade history we can actually price. With no trades — or a ledger
  // we couldn't build — we still know the position (from holdings) and its market
  // value, but P&L is unknown: surface "—" instead of a misleading $0.
  const pnlKnown = transactions.length > 0 && ledgerOk;
  // Market value is driven by the actual amount held (holdings are the source of
  // truth for the current position), not the ledger's share count — so a holding
  // with no trade history still values correctly.
  const marketValue = livePrice !== null ? amountHeld * livePrice : null;

  return {
    symbol: rawUpper,
    displayName: resolved.displayName,
    kind: resolved.kind,
    ticker: resolved.ticker,
    range,
    amountHeld,
    livePrice,
    marketValue,
    avgCost: current.avgCost,
    costBasis: current.costBasis,
    realized: pnlKnown ? current.realizedPnl : 0,
    unrealized: pnlKnown ? current.unrealizedPnl : null,
    total: pnlKnown ? current.totalPnl : null,
    hasPrice: livePrice !== null,
    pnlKnown,
    transactions,
    series,
  };
}

/** Replay the ledger at each sampled date to get price + P&L over time. */
function buildSeries(
  events: TradeEventInput[],
  axis: string[],
  lookup: (date: string) => number | null,
  livePrice: number | null,
  today: string,
  ticker: string,
): AssetSeriesPoint[] {
  const points: AssetSeriesPoint[] = [];
  for (const date of axis) {
    const upTo = events.filter((e) => e.ts.slice(0, 10) <= date);
    let pos: LedgerPosition;
    try {
      pos = buildLedger(upTo, lookup)[0] ?? emptyPosition(ticker);
    } catch {
      // A 1-leg trade in this window has no historical price — skip this point.
      continue;
    }
    // The final point uses the live price so it ties out with the headline cards.
    const price = date === today ? (livePrice ?? lookup(date)) : lookup(date);
    const p = positionPnl(pos, price);
    points.push({
      date,
      price,
      held: pos.shares,
      realized: p.realizedPnl,
      unrealized: p.unrealizedPnl,
      total: p.totalPnl,
    });
  }
  return points;
}
