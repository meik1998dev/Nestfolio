"use server";

/**
 * Server assembly for net worth (EN5.2). Pulls the live inputs — priced
 * holdings — and runs the pure aggregation in `networth.ts`. Shared by the
 * dashboard (read) and the snapshot job (write).
 *
 * Degrades gracefully: an empty `live_prices` cache values holdings at 0 (the UI
 * shows them but they don't inflate net worth); no snapshots → null MoM change.
 */
import { createClient } from "@/lib/supabase/server";
import type { Holding, Portfolio } from "@/lib/types";
import { listHoldings } from "@/lib/ledger/holdings";
import { getLivePricesForHoldings } from "@/lib/portfolio/prices";
import {
  computeHoldingValues,
  excludeDisplaySpam,
} from "@/lib/portfolio/valuation";
import {
  buildBreakdowns,
  computeNetWorth,
  momChange,
  type MoMChange,
  type NetWorthBreakdowns,
} from "./networth";

export interface NetWorthSummary {
  netWorth: number;
  holdingsValue: number;
  breakdowns: NetWorthBreakdowns;
  /** vs the most recent snapshot ≥ ~1 month old; null if none. */
  momChange: MoMChange | null;
  /** True when the price cache is missing some held assets' prices. */
  hasMissingPrices: boolean;
}

/** Assemble the full net-worth summary for the signed-in user. */
export async function getNetWorthSummary(): Promise<NetWorthSummary> {
  const supabase = await createClient();
  const [allHoldings, portfolios] = await Promise.all([
    listHoldings(),
    listPortfolios(supabase),
  ]);
  // Hide unpriceable airdrop spam from net worth, breakdowns and the
  // missing-prices warning (it'd always value $0 and skew nothing but clutter).
  const holdings = excludeDisplaySpam(allHoldings);
  // Warm + read live prices for every held ticker (manual + wallet).
  const prices = await getLivePricesForHoldings(holdings);

  const holdingValues = computeHoldingValues(holdings, prices);
  const holdingsValue = sumValues(holdingValues);

  const netWorth = computeNetWorth({ holdingsValue });

  const portfolioNames = new Map(portfolios.map((p) => [p.id, p.name]));
  const breakdowns = buildBreakdowns({
    holdings,
    holdingValues,
    portfolioNames,
  });

  const prior = await priorSnapshotForMoM(supabase);
  const mom = momChange(netWorth, prior);

  return {
    netWorth,
    holdingsValue,
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
