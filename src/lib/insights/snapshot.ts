"use server";

/**
 * Snapshot job (EN5.1) — persists a point-in-time net worth + breakdown to power
 * the history chart and the monthly review.
 *
 * `takeSnapshot(userId)` recomputes net worth from the same inputs the dashboard
 * uses, then inserts a `snapshots` row. It is reusable by:
 *   - the daily Vercel cron (`/api/cron/snapshot`), running under the service role,
 *   - the dashboard "Take snapshot now" action (authenticated user),
 *   - F2 after a transaction is logged (not wired here — exposed for reuse).
 *
 * Idempotent-ish: it skips if a snapshot already exists for the user TODAY (UTC),
 * so repeated cron runs / button mashing don't spam the history.
 *
 * Reads + writes go through the SERVICE role (RLS bypassed) so the cron — which
 * has no user session — can run; every query passes an explicit `user_id`.
 */
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type {
  Account,
  Holding,
  Liability,
  Portfolio,
  Transaction,
} from "@/lib/types";
import { deriveAccountBalances } from "@/lib/ledger/balances";
import { computeHoldingValues } from "@/lib/portfolio/valuation";
import { buildBreakdowns, computeNetWorth, sumLiabilities } from "./networth";

type Service = ReturnType<typeof createServiceClient>;

export interface SnapshotResult {
  /** "created" when a row was written, "skipped" when one already exists today. */
  status: "created" | "skipped";
  netWorth: number;
  takenAt: string;
}

/** Compute + store today's net-worth snapshot for one user (idempotent per day). */
export async function takeSnapshot(userId: string): Promise<SnapshotResult> {
  const supabase = createServiceClient();

  const existing = await todaysSnapshot(supabase, userId);
  if (existing) {
    return {
      status: "skipped",
      netWorth: Number(existing.net_worth),
      takenAt: existing.taken_at,
    };
  }

  const [accounts, transactions, holdings, prices, liabilities, portfolios] =
    await Promise.all([
      rows<Account>(supabase, "accounts", userId),
      rows<Transaction>(supabase, "transactions", userId),
      rows<Holding>(supabase, "holdings", userId),
      readLivePrices(supabase),
      rows<Liability>(supabase, "liabilities", userId),
      rows<Portfolio>(supabase, "portfolios", userId),
    ]);

  // Derive cash balances from the ledger (same logic the accounts page uses).
  // Coerce numeric strings from the service client to numbers first.
  const balances = deriveAccountBalances(
    accounts,
    transactions.map((t) => ({ ...t, amount: Number(t.amount) })),
  );
  const assetAccounts = accounts
    .filter((a) => a.type !== "expense" && a.type !== "external")
    .map((a) => ({ account: a, balance: balances.get(a.id) ?? 0 }));
  const cash = assetAccounts.reduce((s, a) => s + a.balance, 0);

  const holdingValues = computeHoldingValues(holdings, prices);
  const holdingsValue = [...holdingValues.values()].reduce((s, v) => s + v, 0);
  const liabilitiesTotal = sumLiabilities(liabilities);

  const netWorth = computeNetWorth({
    cash,
    holdingsValue,
    liabilities: liabilitiesTotal,
  });

  const portfolioNames = new Map(portfolios.map((p) => [p.id, p.name]));
  const breakdowns = buildBreakdowns({
    accounts: assetAccounts,
    holdings,
    holdingValues,
    portfolioNames,
  });

  const takenAt = new Date().toISOString();
  const { error } = await supabase.from("snapshots").insert({
    user_id: userId,
    taken_at: takenAt,
    net_worth: netWorth,
    breakdown: {
      cash,
      holdingsValue,
      liabilities: liabilitiesTotal,
      byAssetClass: breakdowns.byAssetClass,
      byPortfolio: breakdowns.byPortfolio,
    },
  });
  if (error) throw new Error(`insert snapshot: ${error.message}`);

  return { status: "created", netWorth, takenAt };
}

/**
 * Dashboard action: take a snapshot for the currently signed-in user, then
 * revalidate the dashboard so the new point appears in the history chart.
 */
export async function takeSnapshotForCurrentUser(): Promise<SnapshotResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const result = await takeSnapshot(user.id);
  revalidatePath("/dashboard");
  return result;
}

/** Snapshot history for the signed-in user, oldest first (feeds S5.3 chart). */
export async function listSnapshots(): Promise<
  Array<{ net_worth: number; taken_at: string }>
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("snapshots")
    .select("net_worth, taken_at")
    .order("taken_at", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ net_worth: number; taken_at: string }>).map(
    (r) => ({ net_worth: Number(r.net_worth), taken_at: r.taken_at }),
  );
}

/** Every user id that has any tracked data — the cron iterates these. */
export async function allUserIdsWithData(): Promise<string[]> {
  const supabase = createServiceClient();
  const ids = new Set<string>();
  for (const table of ["accounts", "holdings", "liabilities"] as const) {
    const { data } = await supabase.from(table).select("user_id");
    for (const r of (data ?? []) as Array<{ user_id: string }>)
      ids.add(r.user_id);
  }
  return [...ids];
}

async function todaysSnapshot(
  supabase: Service,
  userId: string,
): Promise<{ net_worth: number; taken_at: string } | null> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { data } = await supabase
    .from("snapshots")
    .select("net_worth, taken_at")
    .eq("user_id", userId)
    .gte("taken_at", startOfDay.toISOString())
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { net_worth: number; taken_at: string } | null) ?? null;
}

async function rows<T>(
  supabase: Service,
  table: string,
  userId: string,
): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("user_id", userId);
  if (error) throw new Error(`read ${table}: ${error.message}`);
  return (data ?? []) as T[];
}

async function readLivePrices(supabase: Service): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const { data } = await supabase.from("live_prices").select("ticker, price");
  for (const r of (data ?? []) as Array<{ ticker: string; price: number }>)
    map.set(r.ticker.toUpperCase(), Number(r.price));
  return map;
}
