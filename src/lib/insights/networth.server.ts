"use server";

/**
 * Server assembly for net worth (EN5.2). Pulls the live inputs — priced
 * holdings — and runs the pure aggregation in `networth.ts`. Used by the
 * dashboard (read).
 *
 * Degrades gracefully: an empty `live_prices` cache values holdings at 0 (the UI
 * shows them but they don't inflate net worth).
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
  type NetWorthBreakdowns,
} from "./networth";

export interface NetWorthSummary {
  netWorth: number;
  holdingsValue: number;
  breakdowns: NetWorthBreakdowns;
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

  return {
    netWorth,
    holdingsValue,
    breakdowns,
    hasMissingPrices: hasMissingPrices(holdings, holdingValues),
  };
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
