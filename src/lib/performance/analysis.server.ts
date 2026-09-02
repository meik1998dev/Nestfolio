import { createClient } from "@/lib/supabase/server";
import { listHoldings } from "@/lib/ledger/holdings";
import { listPortfolios } from "@/lib/portfolio/portfolios";
import { buildPortfolioTree, flattenTree, type PortfolioNode } from "@/lib/portfolio/tree";
import { tickerForAsset } from "@/lib/portfolio/valuation";
import { isCashLike, isStablecoin, resolveToken } from "@/lib/price/ticker";
import {
  buildLoaded,
  loadAllRows,
  loadHistories,
  readLivePrices,
} from "@/lib/insights/performance";
import type { TradeRow } from "@/lib/ledger/transactions";
import {
  dropWeekendCloses,
  ensurePriceRange,
  loadHistory,
  priceOnOrBefore,
  rangeStart,
  sampleDates,
  todayIso,
} from "@/lib/price/history";
import { buildLedger, positionPnl, rollup } from "@/lib/pnl/costbasis";
import {
  calculateDailyReturns,
  calculateHistoricalValueAtRisk,
  tradingDayCount,
} from "./metrics";
import type {
  PerformanceAnalysis,
  PerformanceRange,
  PerformanceScopeOption,
} from "./types";
import { buildBenchmarkSeries, compareSameMoney } from "./benchmark";

const ALL_SCOPE = "all";
const SPY_TICKER = "SPY";

export function parsePerformanceRange(value: string | undefined): PerformanceRange {
  return value === "1M" || value === "3M" || value === "6M" || value === "1Y" || value === "Max"
    ? value
    : "1Y";
}

function findNode(roots: PortfolioNode[], id: string): PortfolioNode | null {
  for (const node of flattenTree(roots)) if (node.id === id) return node;
  return null;
}

function collectTickers(node: PortfolioNode): Set<string> {
  const tickers = new Set<string>();
  const visit = (current: PortfolioNode) => {
    for (const holding of current.holdings) {
      const resolved = resolveToken(holding.asset).ticker;
      tickers.add((resolved ?? tickerForAsset(holding.asset)).toUpperCase());
    }
    current.children.forEach(visit);
  };
  visit(node);
  return tickers;
}

/** Wallet addresses that feed this subtree through a non-cash holding. */
function collectWalletAddresses(node: PortfolioNode): Set<string> {
  const addresses = new Set<string>();
  const visit = (current: PortfolioNode) => {
    for (const holding of current.holdings) {
      if (holding.wallet_ref && resolveToken(holding.asset).kind !== "stablecoin") {
        addresses.add(holding.wallet_ref.toLowerCase());
      }
    }
    current.children.forEach(visit);
  };
  visit(node);
  return addresses;
}

/**
 * Tickers that were fully sold out (or sent away) in a wallet that feeds this
 * subtree. They have no holding row to match on, so without this the realized
 * P&L and the history of every closed trade would vanish from the scope. Same
 * rule as the portfolio detail page.
 */
async function closedTickersInSubtree(
  supabase: Awaited<ReturnType<typeof createClient>>,
  node: PortfolioNode,
  rows: TradeRow[],
): Promise<Set<string>> {
  const addresses = collectWalletAddresses(node);
  if (addresses.size === 0) return new Set();
  const { data } = await supabase.from("wallets").select("id, address");
  const walletIds = new Set(
    ((data ?? []) as Array<{ id: string; address: string }>)
      .filter((wallet) => addresses.has(wallet.address.toLowerCase()))
      .map((wallet) => wallet.id),
  );
  const netShares = new Map<string, number>();
  const inSubtree = new Set<string>();
  for (const row of rows) {
    if (row.source !== "wallet" || isStablecoin(row.asset)) continue;
    const ticker = (resolveToken(row.asset).ticker ?? row.asset).toUpperCase();
    const sign = row.type === "buy" || row.type === "delivery" ? 1 : row.type === "sell" || row.type === "send" ? -1 : 0;
    netShares.set(ticker, (netShares.get(ticker) ?? 0) + sign * row.amount);
    if (row.walletId && walletIds.has(row.walletId)) inSubtree.add(ticker);
  }
  return new Set(
    [...inSubtree].filter((ticker) => Math.abs(netShares.get(ticker) ?? 0) < 1e-9),
  );
}

export async function getPerformanceScopes(): Promise<{
  options: PerformanceScopeOption[];
  roots: PortfolioNode[];
}> {
  const [portfolios, holdings] = await Promise.all([listPortfolios(), listHoldings()]);
  const roots = buildPortfolioTree(portfolios, holdings);
  return {
    roots,
    options: [
      { id: ALL_SCOPE, name: "All holdings", depth: 0 },
      ...flattenTree(roots).map((node) => ({ id: node.id, name: node.name, depth: node.depth })),
    ],
  };
}

export async function getPerformanceAnalysis(
  range: PerformanceRange,
  requestedScopeId: string,
): Promise<PerformanceAnalysis> {
  const supabase = await createClient();
  const { options, roots } = await getPerformanceScopes();
  const selected = options.find((option) => option.id === requestedScopeId) ?? options[0];
  const scopeNode = selected.id === ALL_SCOPE ? null : findNode(roots, selected.id);
  const rows = await loadAllRows();
  const tickers = scopeNode ? collectTickers(scopeNode) : undefined;
  if (scopeNode && tickers) {
    for (const ticker of await closedTickersInSubtree(supabase, scopeNode, rows)) tickers.add(ticker);
  }
  const resolver = tickers
    ? (asset: string) => {
        if (isCashLike(asset)) return null;
        const resolved = resolveToken(asset).ticker?.toUpperCase();
        const fallback = tickerForAsset(asset).toUpperCase();
        return resolved && tickers.has(resolved) ? resolved : tickers.has(fallback) ? fallback : null;
      }
    // Whole ledger: the global resolver only, exactly like the dashboard and
    // the P&L cards. A bare-symbol fallback here would price unknown crypto
    // symbols as same-named stocks (SEI the token became SEI the stock).
    : (asset: string) => (isCashLike(asset) ? null : resolveToken(asset).ticker ?? null);
  const loaded = buildLoaded(rows, resolver, tickers);

  if (loaded.trades.length === 0) return emptyAnalysis(selected.id, selected.name, range);

  const today = todayIso();
  const requestedStart = rangeStart(range, loaded.earliest);
  const start = loaded.earliest && loaded.earliest > requestedStart ? loaded.earliest : requestedStart;
  const dates = sampleDates(start, today, 1);
  const historyStart = loaded.earliest && loaded.earliest < start ? loaded.earliest : start;
  const closes = await loadHistories(
    supabase,
    loaded.trades,
    loaded.tickers,
    historyStart,
    today,
    dates,
  );
  // Today's point uses live prices so it ties out with the P&L cards and the
  // dashboard; every earlier date keeps the stored daily close.
  const live = await readLivePrices(supabase, loaded.tickers);
  const price = (ticker: string, date: string) =>
    date === today ? (live.get(ticker.toUpperCase()) ?? closes(ticker, date)) : closes(ticker, date);
  const metrics = calculateDailyReturns({ events: loaded.events, start, end: today, price });

  const spyMap = await loadHistory(supabase, SPY_TICKER, start, today);
  await ensurePriceRange(spyMap, SPY_TICKER, start, today);
  dropWeekendCloses(spyMap, SPY_TICKER);
  const benchmarkSeries = buildBenchmarkSeries(metrics.series, (date) => priceOnOrBefore(spyMap, date));
  const benchmarkReturn = benchmarkSeries.at(-1)?.benchmarkReturn ?? null;
  const sameMoney = compareSameMoney(
    metrics.windowCashFlows,
    metrics.series.at(-1)?.value ?? 0,
    today,
    (date) => priceOnOrBefore(spyMap, date),
  );
  const positions = buildLedger(loaded.events, price).map((position) =>
    positionPnl(position, price(position.ticker, today)),
  );
  const pnl = rollup(positions);
  const returnOnCost = pnl.costBasis > 0 ? pnl.total / pnl.costBasis : null;
  const currentValue = metrics.series.at(-1)?.value ?? 0;
  const valueAtRisk95Pct = calculateHistoricalValueAtRisk(metrics.riskSeries);

  return {
    scopeId: selected.id,
    scopeName: selected.name,
    range,
    empty: false,
    firstTradeDate: loaded.earliest,
    historyDays: metrics.historyDays,
    tradingDays: tradingDayCount(metrics.riskSeries),
    readiness: metrics.readiness,
    timeWeightedReturn: metrics.timeWeightedReturn,
    annualizedTimeWeightedReturn: metrics.annualizedTimeWeightedReturn,
    moneyWeightedAnnual: metrics.moneyWeightedReturn.annual,
    moneyWeightedPeriod: metrics.moneyWeightedReturn.period,
    returnOnCost,
    invested: pnl.costBasis,
    totalPnl: pnl.total,
    benchmarkReturn,
    benchmarkSeries,
    sameMoney,
    annualizedVolatility: metrics.annualizedVolatility,
    maxDrawdown: metrics.maxDrawdown.value,
    drawdownPeakDate: metrics.maxDrawdown.peakDate,
    drawdownTroughDate: metrics.maxDrawdown.troughDate,
    drawdownRecovered: metrics.maxDrawdown.recovered,
    valueAtRisk95: valueAtRisk95Pct == null ? null : currentValue * Math.abs(valueAtRisk95Pct),
    valueAtRisk95Pct,
    currentValue,
  };
}

function emptyAnalysis(scopeId: string, scopeName: string, range: PerformanceRange): PerformanceAnalysis {
  return {
    scopeId,
    scopeName,
    range,
    empty: true,
    firstTradeDate: null,
    historyDays: 0,
    tradingDays: 0,
    readiness: "waiting",
    timeWeightedReturn: null,
    annualizedTimeWeightedReturn: null,
    moneyWeightedAnnual: null,
    moneyWeightedPeriod: null,
    returnOnCost: null,
    invested: 0,
    totalPnl: 0,
    benchmarkReturn: null,
    benchmarkSeries: [],
    sameMoney: null,
    annualizedVolatility: null,
    maxDrawdown: null,
    drawdownPeakDate: null,
    drawdownTroughDate: null,
    drawdownRecovered: false,
    valueAtRisk95: null,
    valueAtRisk95Pct: null,
    currentValue: 0,
  };
}
