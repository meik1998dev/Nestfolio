/**
 * Monthly wealth review (S5.6) — pure computation of "what changed this month".
 *
 * From snapshots (net-worth history), transactions (income vs spend), and the
 * PnL view (per-holding gains), derive a plain-language month summary:
 *   - net-worth change over the month (latest snapshot vs ~1-month-prior),
 *   - income added (salary etc.) vs investment gains,
 *   - the biggest winner and loser holdings by total PnL.
 *
 * Injected inputs only — no DB, no clock. The caller selects the window.
 */
import type { Transaction } from "@/lib/types";

/** A trimmed snapshot the review needs (id + value + timestamp). */
export interface ReviewSnapshot {
  net_worth: number;
  taken_at: string;
}

/** A trimmed per-holding PnL row the review ranks. */
export interface ReviewHolding {
  ticker: string;
  /** Total PnL (realized + unrealized); null when unpriced. */
  totalPnl: number | null;
}

export interface ReviewInputs {
  /** Snapshot at (or nearest before) the start of the window. */
  startSnapshot: ReviewSnapshot | null;
  /** Latest snapshot (end of the window / now). */
  endSnapshot: ReviewSnapshot | null;
  /** Transactions dated within the window. */
  transactions: Transaction[];
  /** Per-holding PnL for winner/loser selection. */
  holdings: ReviewHolding[];
}

export interface MonthlyReview {
  /** True when we lack the snapshots needed to compute a change. */
  insufficient: boolean;
  /** End − start net worth (0 when insufficient). */
  netWorthChange: number;
  /** Income (salary etc.) booked in the window. */
  incomeAdded: number;
  /** Spending booked in the window (positive number). */
  spent: number;
  /** Investment gains over the window (change − net contributions). */
  investmentGains: number;
  /** Best holding by total PnL, or null when none priced. */
  winner: ReviewHolding | null;
  /** Worst holding by total PnL, or null when none priced. */
  loser: ReviewHolding | null;
  /** Window bounds echoed back for display. */
  windowStart: string | null;
  windowEnd: string | null;
}

/**
 * Compute the monthly review. `investmentGains` is the part of the net-worth
 * change NOT explained by net cash you added (income − spend) — i.e. how much
 * the markets did for you, independent of saving.
 */
export function computeMonthlyReview(input: ReviewInputs): MonthlyReview {
  const { startSnapshot, endSnapshot, transactions, holdings } = input;

  let incomeAdded = 0;
  let spent = 0;
  for (const t of transactions) {
    const amt = Number(t.amount);
    if (t.type === "income") incomeAdded += amt;
    else if (t.type === "expense") spent += amt;
  }

  const { winner, loser } = pickWinnerLoser(holdings);

  if (!startSnapshot || !endSnapshot) {
    return {
      insufficient: true,
      netWorthChange: 0,
      incomeAdded,
      spent,
      investmentGains: 0,
      winner,
      loser,
      windowStart: startSnapshot?.taken_at ?? null,
      windowEnd: endSnapshot?.taken_at ?? null,
    };
  }

  const netWorthChange = endSnapshot.net_worth - startSnapshot.net_worth;
  // Net new money you put in (savings). Gains = total change minus that.
  const netContributions = incomeAdded - spent;
  const investmentGains = netWorthChange - netContributions;

  return {
    insufficient: false,
    netWorthChange,
    incomeAdded,
    spent,
    investmentGains,
    winner,
    loser,
    windowStart: startSnapshot.taken_at,
    windowEnd: endSnapshot.taken_at,
  };
}

/** Pick the highest- and lowest-PnL priced holdings (null if none priced). */
function pickWinnerLoser(holdings: ReviewHolding[]): {
  winner: ReviewHolding | null;
  loser: ReviewHolding | null;
} {
  const priced = holdings.filter((h) => h.totalPnl !== null);
  if (priced.length === 0) return { winner: null, loser: null };
  let winner = priced[0];
  let loser = priced[0];
  for (const h of priced) {
    if ((h.totalPnl ?? 0) > (winner.totalPnl ?? 0)) winner = h;
    if ((h.totalPnl ?? 0) < (loser.totalPnl ?? 0)) loser = h;
  }
  return { winner, loser };
}
