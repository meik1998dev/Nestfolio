"use server";

/**
 * Per-portfolio detail assembly (EN3.x). Scopes the global net-worth / PnL /
 * trade-ledger data down to a single portfolio node and everything nested under
 * it, so a child portfolio gets its own value, allocation, PnL, and
 * transactions.
 *
 * Scoping strategy:
 *   - SUBTREE = the node plus every descendant (via the pure tree builder).
 *   - Holdings are scoped by `portfolio_id ∈ subtreeIds`.
 *   - PnL (keyed by resolved ticker) and transactions (keyed by raw asset) are
 *     scoped by matching against the subtree holdings' ticker / symbol sets.
 *
 * Degrades gracefully: missing prices → 0 value.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Holding } from "@/lib/types";
import { resolveToken } from "@/lib/price/ticker";
import { listHoldings } from "@/lib/ledger/holdings";
import { listPortfolios } from "@/lib/portfolio/portfolios";
import { getLivePricesForHoldings } from "@/lib/portfolio/prices";
import {
  computeHoldingValues,
  excludeDisplaySpam,
  unitPrice,
} from "@/lib/portfolio/valuation";
import {
  buildPortfolioTree,
  rollupValues,
  type PortfolioNode,
} from "@/lib/portfolio/tree";
import type { BreakdownSlice } from "@/lib/insights/networth";
import { getPnl } from "@/lib/pnl/pnl";
import type { PositionPnl, PnlRollup } from "@/lib/pnl/costbasis";
import { rollup } from "@/lib/pnl/costbasis";
import {
  listTransactions,
  listWalletTrades,
  type TradeRow,
} from "@/lib/ledger/transactions";

/** One holding within the subtree, with its live value + matched PnL position. */
export interface DetailHolding {
  holding: Holding;
  value: number;
  /** Live unit price in USD, or null when the asset has no resolvable price. */
  price: number | null;
  pnl: PositionPnl | null;
}

/**
 * One slice of a portfolio's allocation — ONE LEVEL only: each immediate
 * sub-portfolio is a single rolled-up slice (kind "portfolio"), and each
 * directly-attached holding is its own slice (kind "holding"). Descendants of a
 * sub-portfolio are NOT flattened in — they roll up into that one slice.
 */
export interface AllocationSlice extends BreakdownSlice {
  kind: "portfolio" | "holding";
  /** Holding slices: raw asset symbol (for the asset link). Null for portfolios. */
  symbol: string | null;
  /** Holding slices: id for the inline target editor. Null for portfolios. */
  holdingId: string | null;
  /** Portfolio slices: link to that sub-portfolio's detail page. Null otherwise. */
  href: string | null;
  /** Target % of this portfolio (0..100), or null if none set. */
  targetPct: number | null;
  /** actual share% − target%, when a target is set. */
  driftPct: number | null;
}

/** Everything the portfolio detail page renders. */
export interface PortfolioDetail {
  id: string;
  name: string;
  /** Depth in the tree (0 = root) — drives the breadcrumb hint. */
  depth: number;
  /** Rolled-up USD value of the whole subtree. */
  totalValue: number;
  /**
   * Is the target / rebalancing feature on for this portfolio? When false the
   * allocation slices carry no targets and the page hides every target column.
   */
  targetsEnabled: boolean;
  /** Allocation of subtree holdings by asset, with optional targets + drift. */
  allocation: AllocationSlice[];
  /** PnL rollup over the subtree's positions. */
  pnl: PnlRollup;
  /**
   * Pricing tickers the PnL rollup covers — including fully-closed positions
   * (sold out, no holding row). The performance chart scopes to these so its
   * realized P&L ties out with the rollup, not just currently-held tickers.
   */
  pnlTickers: string[];
  /** Subtree holdings with value + per-holding PnL, biggest value first. */
  holdings: DetailHolding[];
  /** Trades (manual + wallet) touching assets held in this subtree, newest first. */
  transactions: TradeRow[];
  /** True when some subtree holding has no resolvable live price. */
  hasMissingPrices: boolean;
}

/** Collect a node and all of its descendants' ids. */
function subtreeIds(node: PortfolioNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: PortfolioNode) => {
    ids.add(n.id);
    for (const c of n.children) walk(c);
  };
  walk(node);
  return ids;
}

/** Find a node by id anywhere in the forest. */
function findNode(roots: PortfolioNode[], id: string): PortfolioNode | null {
  for (const root of roots) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === id) return n;
      stack.push(...n.children);
    }
  }
  return null;
}

/** The resolved pricing ticker for an asset, or null when unpriceable. */
function tickerFor(asset: string): string | null {
  return resolveToken(asset).ticker;
}

/**
 * Assemble the full detail view for one portfolio, or null if the id doesn't
 * exist (the page renders a 404).
 *
 * Wrapped in React `cache()` for request-level dedup: the detail route calls
 * this once in `generateMetadata` and again in the page render (same `id`,
 * same request), so without memoization every navigation does the full
 * assembly twice. `cache()` collapses the pair into one fetch.
 */
export const getPortfolioDetail = cache(
  async (id: string): Promise<PortfolioDetail | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const [portfolios, allHoldings] = await Promise.all([
      listPortfolios(),
      listHoldings(),
    ]);
    // Hide unpriceable airdrop spam from the tree/holdings (ledger row stays).
    const holdings = excludeDisplaySpam(allHoldings);

    const roots = buildPortfolioTree(portfolios, holdings);
    const node = findNode(roots, id);
    if (!node) return null;

    const ids = subtreeIds(node);
    const subtreeHoldings = holdings.filter(
      (h) => h.portfolio_id && ids.has(h.portfolio_id),
    );

    const prices = await getLivePricesForHoldings(subtreeHoldings);
    const holdingValues = computeHoldingValues(subtreeHoldings, prices);
    // Roll values up the tree so each immediate child's `totalValue` is correct.
    rollupValues(roots, holdingValues);

    // Ticker / symbol sets used to scope ticker-keyed PnL and asset-keyed trades.
    const tickerSet = new Set<string>();
    const rawSet = new Set<string>();
    for (const h of subtreeHoldings) {
      const t = tickerFor(h.asset);
      if (t) tickerSet.add(t);
      rawSet.add(h.asset.trim().toUpperCase());
    }
    const inSubtree = (asset: string): boolean => {
      const t = tickerFor(asset);
      return (
        (t != null && tickerSet.has(t)) ||
        rawSet.has(asset.trim().toUpperCase())
      );
    };

    // Wallets feeding this subtree (by current holdings). Used to attribute the
    // realized PnL of FULLY-CLOSED positions, which have no holding row to match
    // on ticker and would otherwise be silently dropped from the rollup.
    // Cash-like rows (stablecoins/fiat) don't pull trade history: a synced
    // USDT parked in a Cash portfolio must not drag the wallet's whole
    // realized stock P&L into it.
    const subtreeWalletAddrs = new Set(
      subtreeHoldings
        .filter((h) => resolveToken(h.asset).kind !== "stablecoin")
        .map((h) => h.wallet_ref?.toLowerCase())
        .filter((a): a is string => !!a),
    );
    const subtreeWalletIds = new Set<string>();
    if (subtreeWalletAddrs.size > 0) {
      const { data: walletRows } = await supabase
        .from("wallets")
        .select("id, address");
      for (const w of (walletRows ?? []) as Array<{
        id: string;
        address: string;
      }>) {
        if (subtreeWalletAddrs.has(w.address.toLowerCase()))
          subtreeWalletIds.add(w.id);
      }
    }

    // --- Value + allocation (ONE LEVEL: child portfolios + own holdings) ---
    const totalValue = node.totalValue;
    const shareOf = (v: number) => (totalValue > 0 ? v / totalValue : 0);
    // Targets switched off for this portfolio → every slice reads as untargeted,
    // which also removes the target ring and the alignment score downstream.
    const targetsEnabled = node.targetsEnabled;
    const targetOf = (target: number | null) =>
      targetsEnabled ? target : null;
    const driftOf = (share: number, target: number | null) =>
      targetsEnabled && target != null ? share * 100 - target : null;

    // Each immediate sub-portfolio rolls up into a single slice; its target is the
    // portfolio's own target % (relative to this parent).
    const portfolioSlices: AllocationSlice[] = node.children
      .filter((c) => c.totalValue > 0 || targetOf(c.targetPct) != null)
      .map((c) => {
        const share = shareOf(c.totalValue);
        return {
          kind: "portfolio" as const,
          key: c.id,
          holdingId: null,
          symbol: null,
          href: `/portfolios/${c.id}`,
          label: c.name,
          value: c.totalValue,
          share,
          targetPct: targetOf(c.targetPct),
          driftPct: driftOf(share, c.targetPct),
        };
      });

    // Holdings attached DIRECTLY to this node (not to a sub-portfolio).
    const holdingSlices: AllocationSlice[] = node.holdings
      .filter(
        (h) =>
          (holdingValues.get(h.id) ?? 0) > 0 || targetOf(h.target_pct) != null,
      )
      .map((h) => {
        const value = holdingValues.get(h.id) ?? 0;
        const share = shareOf(value);
        return {
          kind: "holding" as const,
          key: h.id,
          holdingId: h.id,
          symbol: h.asset,
          href: null,
          label: resolveToken(h.asset).displayName,
          value,
          share,
          targetPct: targetOf(h.target_pct),
          driftPct: driftOf(share, h.target_pct),
        };
      });

    const allocation: AllocationSlice[] = [
      ...portfolioSlices,
      ...holdingSlices,
    ].sort((a, b) => b.share - a.share);

    // --- PnL scoped to subtree positions ---
    const fullPnl = await getPnl(user.id);
    // A position belongs to this subtree if it's currently held here (ticker match)
    // OR it's fully closed but was traded in a wallet that feeds this subtree —
    // otherwise realized PnL from sold-out positions vanishes from the rollup.
    const isClosed = (p: PositionPnl) => Math.abs(p.shares) < 1e-9;
    const closedWalletIds = (p: PositionPnl): string[] =>
      p.walletIds ?? (p.walletId ? [p.walletId] : []);
    const positions = fullPnl.holdings.filter(
      (p) =>
        tickerSet.has(p.ticker) ||
        (isClosed(p) &&
          closedWalletIds(p).some((w) => subtreeWalletIds.has(w))),
    );
    const positionByTicker = new Map(positions.map((p) => [p.ticker, p]));
    const pnl = rollup(positions);
    const pnlTickers = [
      ...new Set(positions.map((p) => p.ticker.toUpperCase())),
    ];

    const detailHoldings: DetailHolding[] = subtreeHoldings
      .map((h) => {
        const t = tickerFor(h.asset);
        return {
          holding: h,
          value: holdingValues.get(h.id) ?? 0,
          price: unitPrice(h.asset, prices),
          pnl: t ? (positionByTicker.get(t) ?? null) : null,
        };
      })
      .sort((a, b) => b.value - a.value);

    // --- Transactions touching subtree assets ---
    const [manual, walletTrades] = await Promise.all([
      listTransactions(),
      listWalletTrades(),
    ]);
    const manualRows: TradeRow[] = manual
      .filter((t) => inSubtree(t.asset))
      .map((t) => ({
        id: t.id,
        date: t.date,
        type: t.type,
        asset: t.asset,
        amount: t.amount,
        price: t.price,
        value: t.price != null ? t.price * t.amount : null,
        source: "manual",
        note: t.note,
      }));
    const transactions = [
      ...manualRows,
      ...walletTrades.filter((t) => inSubtree(t.asset)),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    return {
      id: node.id,
      name: node.name,
      depth: node.depth,
      totalValue,
      targetsEnabled,
      allocation,
      pnl,
      pnlTickers,
      holdings: detailHoldings,
      transactions,
      hasMissingPrices: subtreeHoldings.some(
        (h) => h.amount > 0 && (holdingValues.get(h.id) ?? 0) === 0,
      ),
    };
  },
);
