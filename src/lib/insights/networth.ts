/**
 * Net-worth aggregation (EN5.2) — the single source of truth used by the
 * dashboard, the snapshot job, and the monthly review.
 *
 *   Net Worth = Σ account cash balances + Σ holding market values − Σ liabilities
 *
 * Everything here is PURE: callers inject already-priced inputs (cash balances,
 * holding USD values, liabilities) so this module never touches the DB or a
 * price feed and stays trivially testable. Server assembly lives in
 * `getNetWorthSummary` (networth.server.ts).
 */
import type { Account, AccountType, Holding, Liability } from "@/lib/types";
import { resolveToken } from "@/lib/price/ticker";

/** The three top-line components of net worth. */
export interface NetWorthInputs {
  /** Σ cash balances of real accounts (excludes expense/external sinks). */
  cash: number;
  /** Σ market value of all holdings (priced; missing prices count as 0). */
  holdingsValue: number;
  /** Σ outstanding liability balances. */
  liabilities: number;
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
  return inputs.cash + inputs.holdingsValue - inputs.liabilities;
}

/** Total assets (cash + holdings) — the positive side of the balance. */
export function totalAssets(inputs: NetWorthInputs): number {
  return inputs.cash + inputs.holdingsValue;
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

/** Map an account type to an asset class for the allocation breakdown. */
export function assetClassForAccountType(type: AccountType): AssetClass {
  switch (type) {
    case "cash":
      return "cash";
    case "crypto_wallet":
      return "crypto";
    case "stock":
      return "stock";
    case "gold":
      return "gold";
    default:
      // expense / external accounts hold no wealth — caller filters them out,
      // but classify defensively as "other".
      return "other";
  }
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
  /** Where assets sit, by asset class (cash + each holding class). */
  byAssetClass: BreakdownSlice[];
  /** Where holdings sit, by their portfolio (unassigned bucketed together). */
  byPortfolio: BreakdownSlice[];
  /** Asset accounts grouped by account type (cash containers). */
  byAccountType: BreakdownSlice[];
}

/** Inputs for the breakdown builder — all pre-derived, no IO. */
export interface BreakdownInputs {
  /** Asset accounts (expense/external already removed) + their balances. */
  accounts: Array<{ account: Account; balance: number }>;
  holdings: Holding[];
  /** holdingId → USD market value. */
  holdingValues: Map<string, number>;
  /** portfolioId → display name, for the by-portfolio breakdown. */
  portfolioNames: Map<string, string>;
}

/** Build the chart breakdowns for the dashboard (and snapshot payload). */
export function buildBreakdowns(input: BreakdownInputs): NetWorthBreakdowns {
  const { accounts, holdings, holdingValues, portfolioNames } = input;

  // --- By asset class: cash (from accounts) + holdings grouped by class ---
  const classTotals = new Map<AssetClass, number>();
  const cashTotal = accounts.reduce((s, a) => s + a.balance, 0);
  if (cashTotal > 0) classTotals.set("cash", cashTotal);
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

  // --- By account type (cash containers) ---
  const typeTotals = new Map<AccountType, number>();
  for (const { account, balance } of accounts) {
    typeTotals.set(account.type, (typeTotals.get(account.type) ?? 0) + balance);
  }
  const byAccountType = toBreakdown(
    [...typeTotals.entries()].map(([type, value]) => ({
      key: type,
      label: ACCOUNT_TYPE_LABELS_SHORT[type],
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

  return { byAssetClass, byAccountType, byPortfolio };
}

const ACCOUNT_TYPE_LABELS_SHORT: Record<AccountType, string> = {
  cash: "Cash",
  crypto_wallet: "Crypto wallet",
  gold: "Gold",
  stock: "Brokerage",
  expense: "Expense",
  external: "External",
};

/** Sum outstanding liability balances. */
export function sumLiabilities(liabilities: Liability[]): number {
  return liabilities.reduce((s, l) => s + Number(l.balance), 0);
}

/** Month-over-month change vs a prior net worth. Null prior → null change. */
export interface MoMChange {
  /** Absolute change in USD. */
  absolute: number;
  /** Fractional change (0.05 = +5%); 0 when prior is 0. */
  pct: number;
  /** The prior net worth compared against. */
  prior: number;
  /** When that prior value was taken (ISO). */
  priorAt: string;
}

export function momChange(
  current: number,
  prior: { netWorth: number; takenAt: string } | null,
): MoMChange | null {
  if (!prior) return null;
  const absolute = current - prior.netWorth;
  const pct = prior.netWorth !== 0 ? absolute / prior.netWorth : 0;
  return { absolute, pct, prior: prior.netWorth, priorAt: prior.takenAt };
}
