"use server";

/**
 * Server assembly for the monthly review (S5.6). Selects the snapshot window
 * (latest vs the nearest snapshot ~1 month before), the in-window transactions,
 * and the PnL holdings, then runs the pure `computeMonthlyReview`.
 */
import { createClient } from "@/lib/supabase/server";
import { listTransactions } from "@/lib/ledger/transactions";
import { getPnl } from "@/lib/pnl/pnl";
import {
  computeMonthlyReview,
  type MonthlyReview,
  type ReviewSnapshot,
} from "./review";

export async function getMonthlyReview(userId: string): Promise<MonthlyReview> {
  const supabase = await createClient();

  // Latest snapshot = end of window.
  const { data: endRow } = await supabase
    .from("snapshots")
    .select("net_worth, taken_at")
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const endSnapshot = endRow ? toReviewSnapshot(endRow) : null;

  // Start = nearest snapshot at/before ~1 month before the end.
  let startSnapshot: ReviewSnapshot | null = null;
  if (endSnapshot) {
    const monthBefore = new Date(endSnapshot.taken_at);
    monthBefore.setMonth(monthBefore.getMonth() - 1);
    const { data: startRow } = await supabase
      .from("snapshots")
      .select("net_worth, taken_at")
      .lte("taken_at", monthBefore.toISOString())
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    startSnapshot = startRow ? toReviewSnapshot(startRow) : null;
  }

  // Transactions within the window (or this calendar month if no start yet).
  const windowStartISO =
    startSnapshot?.taken_at ?? startOfCurrentMonth().toISOString();
  const all = await listTransactions();
  const transactions = all.filter((t) => t.date >= windowStartISO.slice(0, 10));

  const pnl = await getPnl(userId);
  const holdings = pnl.holdings.map((h) => ({
    ticker: h.ticker,
    totalPnl: h.totalPnl,
  }));

  return computeMonthlyReview({
    startSnapshot,
    endSnapshot,
    transactions,
    holdings,
  });
}

function toReviewSnapshot(row: {
  net_worth: number;
  taken_at: string;
}): ReviewSnapshot {
  return { net_worth: Number(row.net_worth), taken_at: row.taken_at };
}

function startOfCurrentMonth(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
