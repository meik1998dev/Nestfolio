/**
 * Cost-basis ledger + PnL math (EN6.2 / EN6.3) — the validated average-cost
 * method from `pnl-and-pricing-method.md` §5.
 *
 *   ACQUIRE (BUY or DELIVERY):
 *     shares += q ; cost += (BUY: usd_paid) OR (DELIVERY: q × histPrice)
 *   DISPOSE (SELL or SEND):
 *     avg = cost / shares
 *     proceeds = (SELL: usd_received) OR (SEND: q × histPrice)
 *     realized += proceeds − avg×q ; cost −= avg×q ; shares −= q
 *   AT END (per ticker):
 *     unrealized = shares × livePrice − cost ; total = realized + unrealized
 *
 * DELIVERY/SEND prices are *injected* (a `histPriceLookup`), so this module is
 * pure and synchronous — no network, no DB. The caller (ledger.ts) is
 * responsible for ensuring those historical prices exist before calling.
 */
import type { TradeEventInput } from "./classify";

/** Materialized per-ticker ledger position (matches the `cost_basis` table). */
export interface LedgerPosition {
  ticker: string;
  shares: number;
  /** Remaining cost basis of the shares still held. */
  costBasis: number;
  realizedPnl: number;
}

/** A historical-price lookup for 1-leg events: ticker + ISO date → USD close. */
export type HistPriceLookup = (ticker: string, date: string) => number | null;

/** A live-price lookup for unrealized PnL: ticker → USD price (or null). */
export type LivePriceLookup = (ticker: string) => number | null;

/** YYYY-MM-DD (UTC) for an ISO timestamp — the key historical prices are stored by. */
export function isoDay(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Walk classified events in chronological order, applying average-cost
 * bookkeeping per ticker. Deposits are ignored (cash, not a position). Returns
 * one position per ticker that ever traded.
 *
 * Throws if a 1-leg event has no historical price — we must never silently
 * record a $0-cost delivery (that would understate cost basis).
 */
export function buildLedger(
  events: TradeEventInput[],
  histPrice: HistPriceLookup,
): LedgerPosition[] {
  const sorted = [...events].sort((a, b) =>
    a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0,
  );

  const positions = new Map<string, LedgerPosition>();
  const get = (ticker: string): LedgerPosition => {
    let p = positions.get(ticker);
    if (!p) {
      p = { ticker, shares: 0, costBasis: 0, realizedPnl: 0 };
      positions.set(ticker, p);
    }
    return p;
  };

  for (const ev of sorted) {
    switch (ev.type) {
      case "deposit":
        // Cash in — tracked by reconciliation, not the position ledger.
        break;

      case "buy": {
        const p = get(ev.ticker);
        p.shares += ev.shares;
        p.costBasis += requireUsd(ev, "buy");
        break;
      }

      case "delivery": {
        const p = get(ev.ticker);
        const price = requirePrice(histPrice, ev);
        p.shares += ev.shares;
        p.costBasis += ev.shares * price;
        break;
      }

      case "sell": {
        const p = get(ev.ticker);
        const avg = avgCost(p);
        const proceeds = requireUsd(ev, "sell");
        p.realizedPnl += proceeds - avg * ev.shares;
        p.costBasis -= avg * ev.shares;
        p.shares -= ev.shares;
        break;
      }

      case "send": {
        const p = get(ev.ticker);
        const avg = avgCost(p);
        const price = requirePrice(histPrice, ev);
        const proceeds = ev.shares * price;
        p.realizedPnl += proceeds - avg * ev.shares;
        p.costBasis -= avg * ev.shares;
        p.shares -= ev.shares;
        break;
      }
    }
  }

  // Clean tiny residue from float subtraction so fully-closed positions read 0.
  for (const p of positions.values()) {
    if (Math.abs(p.shares) < 1e-9) {
      p.shares = 0;
      p.costBasis = 0;
    }
  }

  return [...positions.values()];
}

/** PnL for one position at a live price. Returns market value + the three PnLs. */
export interface PositionPnl extends LedgerPosition {
  /** Average remaining cost per share (0 when no shares held). */
  avgCost: number;
  /** Live price used (null if unavailable → unrealized/total are null). */
  livePrice: number | null;
  /** shares × livePrice, or null if no live price. */
  marketValue: number | null;
  /** shares × livePrice − costBasis, or null if no live price. */
  unrealizedPnl: number | null;
  /** realized + unrealized, or null if no live price. */
  totalPnl: number | null;
}

/** Compute PnL for one ledger position given a live price (may be null). */
export function positionPnl(
  pos: LedgerPosition,
  livePrice: number | null,
): PositionPnl {
  const avg = pos.shares > 0 ? pos.costBasis / pos.shares : 0;
  if (livePrice === null) {
    return {
      ...pos,
      avgCost: avg,
      livePrice: null,
      marketValue: null,
      unrealizedPnl: null,
      totalPnl: null,
    };
  }
  const marketValue = pos.shares * livePrice;
  const unrealized = marketValue - pos.costBasis;
  return {
    ...pos,
    avgCost: avg,
    livePrice,
    marketValue,
    unrealizedPnl: unrealized,
    totalPnl: pos.realizedPnl + unrealized,
  };
}

/** Portfolio rollup: Σ realized / unrealized / total over positions. */
export interface PnlRollup {
  realized: number;
  /** Sum of unrealized over positions that HAVE a live price. */
  unrealized: number;
  total: number;
  marketValue: number;
  costBasis: number;
  /** True if any held position is missing a live price (totals are partial). */
  hasMissingPrices: boolean;
}

export function rollup(positions: PositionPnl[]): PnlRollup {
  let realized = 0;
  let unrealized = 0;
  let marketValue = 0;
  let costBasis = 0;
  let hasMissingPrices = false;

  for (const p of positions) {
    realized += p.realizedPnl;
    costBasis += p.costBasis;
    if (p.livePrice === null && p.shares > 0) {
      hasMissingPrices = true;
      continue;
    }
    unrealized += p.unrealizedPnl ?? 0;
    marketValue += p.marketValue ?? 0;
  }

  return {
    realized,
    unrealized,
    total: realized + unrealized,
    marketValue,
    costBasis,
    hasMissingPrices,
  };
}

function avgCost(p: LedgerPosition): number {
  return p.shares > 0 ? p.costBasis / p.shares : 0;
}

function requireUsd(ev: TradeEventInput, kind: string): number {
  if (ev.usdValue === undefined || ev.usdValue === null) {
    throw new Error(`${kind} event ${ev.tx_hash} is missing its USD value`);
  }
  return ev.usdValue;
}

function requirePrice(histPrice: HistPriceLookup, ev: TradeEventInput): number {
  const price = histPrice(ev.ticker, isoDay(ev.ts));
  if (price === null || price === undefined) {
    throw new Error(
      `no historical price for ${ev.ticker} on ${isoDay(ev.ts)} (tx ${ev.tx_hash})`,
    );
  }
  return price;
}
