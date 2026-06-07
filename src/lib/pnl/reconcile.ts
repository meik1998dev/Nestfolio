/**
 * Cash reconciliation guard (EN6.1) — `pnl-and-pricing-method.md` §6.
 *
 * The on-chain cash must tie out:
 *
 *   USDT deposited − USDT spent on buys + USDT from sells == current USDT balance
 *      299.99       −       395.86       +     395.86      ==      299.99      ✓
 *
 * If it doesn't tie out, the transfer parse is wrong — the UI must surface an
 * error and show last-known values, never a silently-wrong number.
 *
 * Pure: takes classified events + the current stablecoin balance, returns the
 * numbers and a pass/fail. No network, no DB.
 */
import type { TradeEventInput } from "./classify";

/** Default tolerance — penny-level rounding on the recycled USDT cash flow. */
const DEFAULT_TOLERANCE = 0.01;

export interface ReconcileResult {
  pass: boolean;
  deposited: number;
  spentOnBuys: number;
  fromSells: number;
  /** deposited − spentOnBuys + fromSells — what the balance *should* be. */
  expectedBalance: number;
  /** The actual current stablecoin balance reported on-chain. */
  actualBalance: number;
  /** |expected − actual|. */
  difference: number;
}

/**
 * Reconcile cash from classified events against the current stablecoin balance.
 * `actualBalance` is the wallet's combined stablecoin balance (USD ≈ units).
 */
export function reconcileCash(
  events: TradeEventInput[],
  actualBalance: number,
  tolerance = DEFAULT_TOLERANCE,
): ReconcileResult {
  let deposited = 0;
  let spentOnBuys = 0;
  let fromSells = 0;

  for (const ev of events) {
    switch (ev.type) {
      case "deposit":
        deposited += ev.usdValue ?? ev.shares;
        break;
      case "buy":
        spentOnBuys += ev.usdValue ?? 0;
        break;
      case "sell":
        fromSells += ev.usdValue ?? 0;
        break;
      // delivery / send do not move on-chain cash.
    }
  }

  const expectedBalance = deposited - spentOnBuys + fromSells;
  const difference = Math.abs(expectedBalance - actualBalance);

  return {
    pass: difference <= tolerance,
    deposited,
    spentOnBuys,
    fromSells,
    expectedBalance,
    actualBalance,
    difference,
  };
}
