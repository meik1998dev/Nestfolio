"use server";

/**
 * Server assembly for net worth (EN5.2). Pulls the live inputs — account cash
 * balances, priced holdings, liabilities — and runs the pure aggregation in
 * `networth.ts`. Shared by the dashboard (read) and the snapshot job (write).
 *
 * Degrades gracefully: an empty `live_prices` cache values holdings at 0 (the UI
 * shows them but they don't inflate net worth); no snapshots → null MoM change.
 */
import { createClient } from "@/lib/supabase/server";
import type { Account, Holding, Liability, Portfolio } from "@/lib/types";
import { getAccountsWithBalances } from "@/lib/ledger/accounts";
import { listHoldings } from "@/lib/ledger/holdings";
import { getLivePricesForHoldings } from "@/lib/portfolio/prices";
import { computeHoldingValues } from "@/lib/portfolio/valuation";
import {
  buildBreakdowns,
  computeNetWorth,
  momChange,
  sumLiabilities,
  totalAssets,
  type MoMChange,
  type NetWorthBreakdowns,
} from "./networth";

export interface NetWorthSummary {
  netWorth: number;
  totalAssets: number;
  cash: number;
  holdingsValue: number;
  liabilities: number;
  breakdowns: NetWorthBreakdowns;
  /** vs the most recent snapshot ≥ ~1 month old; null if none. */
  momChange: MoMChange | null;
  /** True when the price cache is missing some held assets' prices. */
  hasMissingPrices: boolean;
}

/** Liability stored on the wealth screen — the read used by the summary + UI. */
export async function readLiabilities(): Promise<Liability[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("liabilities")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as Liability[];
}

/** Assemble the full net-worth summary for the signed-in user. */
export async function getNetWorthSummary(): Promise<NetWorthSummary> {
  const supabase = await createClient();
  const [accountsWithBal, holdings, liabilities, portfolios] =
    await Promise.all([
      getAccountsWithBalances(),
      listHoldings(),
      readLiabilities(),
      listPortfolios(supabase),
    ]);
  // Warm + read live prices for every held ticker (manual + wallet).
  const prices = await getLivePricesForHoldings(holdings);

  // Only real assets count as wealth — drop expense/external sinks.
  const assetAccounts = accountsWithBal
    .filter((a) => a.type !== "expense" && a.type !== "external")
    .map((a) => ({ account: a as Account, balance: a.balance }));
  const cash = assetAccounts.reduce((s, a) => s + a.balance, 0);

  const holdingValues = computeHoldingValues(holdings, prices);
  const holdingsValue = sumValues(holdingValues);
  const liabilitiesTotal = sumLiabilities(liabilities);

  const inputs = {
    cash,
    holdingsValue,
    liabilities: liabilitiesTotal,
  };
  const netWorth = computeNetWorth(inputs);

  const portfolioNames = new Map(portfolios.map((p) => [p.id, p.name]));
  const breakdowns = buildBreakdowns({
    accounts: assetAccounts,
    holdings,
    holdingValues,
    portfolioNames,
  });

  const prior = await priorSnapshotForMoM(supabase);
  const mom = momChange(netWorth, prior);

  return {
    netWorth,
    totalAssets: totalAssets(inputs),
    cash,
    holdingsValue,
    liabilities: liabilitiesTotal,
    breakdowns,
    momChange: mom,
    hasMissingPrices: hasMissingPrices(holdings, holdingValues),
  };
}

/** The most recent snapshot taken ≥ ~28 days ago (the MoM comparison point). */
async function priorSnapshotForMoM(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ netWorth: number; takenAt: string } | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 28);
  const { data } = await supabase
    .from("snapshots")
    .select("net_worth, taken_at")
    .lte("taken_at", cutoff.toISOString())
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const row = data as { net_worth: number; taken_at: string };
  return { netWorth: Number(row.net_worth), takenAt: row.taken_at };
}

async function listPortfolios(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Portfolio[]> {
  const { data, error } = await supabase.from("portfolios").select("*");
  if (error) throw new Error(error.message);
  return (data ?? []) as Portfolio[];
}

function sumValues(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

/** True when a held holding has no resolvable price (value === 0 with amount). */
function hasMissingPrices(
  holdings: Holding[],
  values: Map<string, number>,
): boolean {
  return holdings.some((h) => h.amount > 0 && (values.get(h.id) ?? 0) === 0);
}
