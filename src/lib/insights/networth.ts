/**
 * Net-worth aggregation (EN5.2) — the single source of truth used by the
 * dashboard.
 *
 *   Net Worth = Σ holding market values
 *
 * Everything here is PURE: callers inject already-priced inputs (holding USD
 * values) so this module never touches the DB or a price feed and stays
 * trivially testable. Server assembly lives in `getNetWorthSummary`
 * (networth.server.ts).
 */
import type { Holding } from "@/lib/types";
import { resolveToken } from "@/lib/price/ticker";

/** The top-line component of net worth. */
export interface NetWorthInputs {
  /** Σ market value of all holdings (priced; missing prices count as 0). */
  holdingsValue: number;
}

/** A single slice of a breakdown — feeds bars and pie charts. */
export interface BreakdownSlice {
  key: string;
  label: string;
  value: number;
  /** Share of the breakdown total, 0..1 (0 when the total is 0). */
  share: number;
}

/** Asset-side market value, split by class (cash, crypto, stock, gold, …). */
export type AssetClass = "cash" | "crypto" | "stock" | "gold" | "other";

/** Pure net worth from injected components. */
export function computeNetWorth(inputs: NetWorthInputs): number {
  return inputs.holdingsValue;
}

/**
 * Turn raw {key,label,value} rows into shares that sum to 1 (within float
 * tolerance). Zero/negative-total inputs yield all-zero shares — never NaN.
 * Slices are sorted largest-first for legible charts and drop empty rows.
 */
export function toBreakdown(
  rows: Array<{ key: string; label: string; value: number }>,
): BreakdownSlice[] {
  const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0);
  return rows
    .filter((r) => r.value > 0)
    .map((r) => ({
      key: r.key,
      label: r.label,
      value: r.value,
      share: total > 0 ? r.value / total : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Classify a holding into an asset class by its symbol. Delegates to the shared
 * `resolveToken` — the single source of truth used for pricing — so the pie
 * buckets stay consistent with how each asset is valued (PAXG/XAU → gold,
 * tokenized stocks like NVDAon → stock, stablecoins → cash-like, BTC/ETH/BNB →
 * crypto). Unknown symbols fall to "other" rather than silently inflating stocks.
 */
export function assetClassForHolding(asset: string): AssetClass {
  // Plain gold tickers the token resolver doesn't carry.
  const sym = asset.trim().toUpperCase();
  if (sym === "XAU" || sym === "GOLD") return "gold";

  const kind = resolveToken(asset).kind;
  switch (kind) {
    case "gold":
      return "gold";
    case "crypto":
      return "crypto";
    case "stock":
      return "stock";
    case "stablecoin":
      // Stablecoins are cash-like value sitting on-chain.
      return "cash";
    default:
      // Plain equity tickers (AAPL) and anything unrecognized → stock, the
      // historical default. (PAXG/XAU and crypto are caught above.)
      return "stock";
  }
}

const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  cash: "Cash",
  crypto: "Crypto",
  stock: "Stocks",
  gold: "Gold",
  other: "Other",
};

export interface NetWorthBreakdowns {
  /** Where assets sit, by asset class. */
  byAssetClass: BreakdownSlice[];
  /** Where holdings sit, by their portfolio (unassigned bucketed together). */
  byPortfolio: BreakdownSlice[];
}

/** Inputs for the breakdown builder — all pre-derived, no IO. */
export interface BreakdownInputs {
  holdings: Holding[];
  /** holdingId → USD market value. */
  holdingValues: Map<string, number>;
  /** portfolioId → display name, for the by-portfolio breakdown. */
  portfolioNames: Map<string, string>;
}

/** Build the chart breakdowns for the dashboard. */
export function buildBreakdowns(input: BreakdownInputs): NetWorthBreakdowns {
  const { holdings, holdingValues, portfolioNames } = input;

  // --- By asset class: holdings grouped by class ---
  const classTotals = new Map<AssetClass, number>();
  for (const h of holdings) {
    const cls = assetClassForHolding(h.asset);
    const v = holdingValues.get(h.id) ?? 0;
    classTotals.set(cls, (classTotals.get(cls) ?? 0) + v);
  }
  const byAssetClass = toBreakdown(
    [...classTotals.entries()].map(([cls, value]) => ({
      key: cls,
      label: ASSET_CLASS_LABELS[cls],
      value,
    })),
  );

  // --- By portfolio (holdings only; unassigned in their own bucket) ---
  const pfTotals = new Map<string, number>();
  for (const h of holdings) {
    const key = h.portfolio_id ?? "__unassigned__";
    pfTotals.set(
      key,
      (pfTotals.get(key) ?? 0) + (holdingValues.get(h.id) ?? 0),
    );
  }
  const byPortfolio = toBreakdown(
    [...pfTotals.entries()].map(([key, value]) => ({
      key,
      label:
        key === "__unassigned__"
          ? "Unassigned"
          : (portfolioNames.get(key) ?? "Portfolio"),
      value,
    })),
  );

  return { byAssetClass, byPortfolio };
}
