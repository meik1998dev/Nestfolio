/**
 * Transaction classifier (EN6.1) — turns raw `wallet_transfers` into normalized
 * economic events, per the validated rules in `pnl-and-pricing-method.md` §4.
 *
 * We group transfers by `tx_hash`, inspect the wallet's IN and OUT legs, and
 * decide what economically happened. Tokenized stocks (…on) resolve to their
 * equity ticker; stablecoins (USDT/USDC/BUSD/FDUSD) are treated as cash.
 *
 *   2-leg, stock IN  + stablecoin OUT  → BUY      (cost     = stablecoin out)
 *   2-leg, stablecoin IN + stock OUT   → SELL     (proceeds = stablecoin in)
 *   1-leg, stock IN only               → DELIVERY (priced later, historical equity)
 *   1-leg, stock OUT only              → SEND
 *   1-leg, stablecoin IN, no stock     → DEPOSIT  (cash in, not a trade)
 *
 * Pure & dependency-free: takes plain transfer rows, returns plain events. No
 * network, no DB — fully unit-testable.
 */
import { resolveToken, isStablecoin } from "@/lib/price/ticker";

/** The economic kinds we recognise. Mirrors the `trade_event_type` enum. */
export type TradeEventKind = "buy" | "sell" | "delivery" | "send" | "deposit";

/** Minimal transfer shape the classifier needs (subset of `WalletTransfer`). */
export interface TransferLeg {
  tx_hash: string;
  ts: string;
  token_symbol: string | null;
  direction: "in" | "out";
  /** Base-unit integer amount as a string (e.g. wei). */
  raw_amount: string;
  decimals: number;
}

/**
 * A normalized economic event. For stock events `ticker` is the equity ticker
 * and `shares` the quantity; for DEPOSIT `ticker` is the stablecoin symbol.
 * `usdValue` is the exact on-chain cash for 2-leg trades, and the deposited cash
 * for deposits; it is left undefined for 1-leg stock events (priced downstream
 * at the historical equity price by the cost-basis loop).
 */
export interface TradeEventInput {
  type: TradeEventKind;
  /** Equity ticker for stock events; stablecoin symbol for deposits. */
  ticker: string;
  /** Quantity of shares (stock events) or stablecoin units (deposits). */
  shares: number;
  /** Exact USD cash for 2-leg trades / deposits; undefined for 1-leg stock. */
  usdValue?: number;
  ts: string;
  tx_hash: string;
}

/** A transfer that couldn't be classified — surfaced for review, never dropped. */
export interface UnclassifiedTx {
  tx_hash: string;
  reason: string;
}

export interface ClassifyResult {
  events: TradeEventInput[];
  unclassified: UnclassifiedTx[];
}

/** Convert a base-unit integer string + decimals into a JS number. */
export function toDecimalAmount(rawAmount: string, decimals: number): number {
  // Token amounts here are small (shares / cash), well within float precision.
  return Number(rawAmount) / 10 ** decimals;
}

interface Leg {
  symbol: string;
  amount: number;
}

/** Group transfers by tx hash, preserving the earliest timestamp per group. */
function groupByTx(transfers: TransferLeg[]): Map<string, TransferLeg[]> {
  const groups = new Map<string, TransferLeg[]>();
  for (const t of transfers) {
    const list = groups.get(t.tx_hash);
    if (list) list.push(t);
    else groups.set(t.tx_hash, [t]);
  }
  return groups;
}

/**
 * Classify all transfers into normalized events. Groups by tx hash, sorts the
 * resulting events chronologically (the cost-basis loop relies on order).
 */
export function classifyTransfers(transfers: TransferLeg[]): ClassifyResult {
  const events: TradeEventInput[] = [];
  const unclassified: UnclassifiedTx[] = [];

  for (const [txHash, legs] of groupByTx(transfers)) {
    const ts = legs.reduce((min, l) => (l.ts < min ? l.ts : min), legs[0].ts);

    // Aggregate legs by symbol+direction (a tx can have multiple log entries).
    const stockIn: Leg[] = [];
    const stockOut: Leg[] = [];
    let stableIn = 0;
    let stableOut = 0;

    for (const leg of legs) {
      const symbol = leg.token_symbol ?? "";
      const amount = toDecimalAmount(leg.raw_amount, leg.decimals);
      if (isStablecoin(symbol)) {
        if (leg.direction === "in") stableIn += amount;
        else stableOut += amount;
        continue;
      }
      const resolved = resolveToken(symbol);
      if (resolved.kind === "stock" && resolved.ticker) {
        const entry = { symbol: resolved.ticker, amount };
        if (leg.direction === "in") stockIn.push(entry);
        else stockOut.push(entry);
      }
      // Non-stock, non-stablecoin legs (e.g. BNB gas) are ignored for PnL.
    }

    const event = classifyTx(txHash, ts, {
      stockIn,
      stockOut,
      stableIn,
      stableOut,
    });

    if (event) events.push(event);
    else if (stockIn.length || stockOut.length || stableIn || stableOut) {
      unclassified.push({
        tx_hash: txHash,
        reason: describeShape(stockIn, stockOut, stableIn, stableOut),
      });
    }
  }

  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return { events, unclassified };
}

interface TxShape {
  stockIn: Leg[];
  stockOut: Leg[];
  stableIn: number;
  stableOut: number;
}

/** Apply the §4 rules to one tx's aggregated legs. */
function classifyTx(
  txHash: string,
  ts: string,
  { stockIn, stockOut, stableIn, stableOut }: TxShape,
): TradeEventInput | null {
  const hasStockIn = stockIn.length > 0;
  const hasStockOut = stockOut.length > 0;

  // 2-leg BUY: stock IN + stablecoin OUT. Cost = stablecoin spent.
  if (hasStockIn && stableOut > 0 && !hasStockOut) {
    const stock = sumOne(stockIn);
    return {
      type: "buy",
      ticker: stock.symbol,
      shares: stock.amount,
      usdValue: stableOut,
      ts,
      tx_hash: txHash,
    };
  }

  // 2-leg SELL: stablecoin IN + stock OUT. Proceeds = stablecoin received.
  if (hasStockOut && stableIn > 0 && !hasStockIn) {
    const stock = sumOne(stockOut);
    return {
      type: "sell",
      ticker: stock.symbol,
      shares: stock.amount,
      usdValue: stableIn,
      ts,
      tx_hash: txHash,
    };
  }

  // 1-leg DELIVERY: stock IN only (paid off-chain). Priced downstream.
  if (hasStockIn && !hasStockOut && stableIn === 0 && stableOut === 0) {
    const stock = sumOne(stockIn);
    return {
      type: "delivery",
      ticker: stock.symbol,
      shares: stock.amount,
      ts,
      tx_hash: txHash,
    };
  }

  // 1-leg SEND: stock OUT only. Priced downstream.
  if (hasStockOut && !hasStockIn && stableIn === 0 && stableOut === 0) {
    const stock = sumOne(stockOut);
    return {
      type: "send",
      ticker: stock.symbol,
      shares: stock.amount,
      ts,
      tx_hash: txHash,
    };
  }

  // 1-leg DEPOSIT: stablecoin IN, no stock. Cash in (not a trade).
  if (!hasStockIn && !hasStockOut && stableIn > 0 && stableOut === 0) {
    return {
      type: "deposit",
      ticker: "USDT", // cash; symbol is informational
      shares: stableIn,
      usdValue: stableIn,
      ts,
      tx_hash: txHash,
    };
  }

  return null;
}

/** Sum a list of same-ticker legs into one. */
function sumOne(legs: Leg[]): Leg {
  const symbol = legs[0].symbol;
  const amount = legs.reduce((s, l) => s + l.amount, 0);
  return { symbol, amount };
}

function describeShape(
  stockIn: Leg[],
  stockOut: Leg[],
  stableIn: number,
  stableOut: number,
): string {
  const parts: string[] = [];
  if (stockIn.length)
    parts.push(`stockIn=${stockIn.map((l) => l.symbol).join(",")}`);
  if (stockOut.length)
    parts.push(`stockOut=${stockOut.map((l) => l.symbol).join(",")}`);
  if (stableIn) parts.push(`stableIn=${stableIn}`);
  if (stableOut) parts.push(`stableOut=${stableOut}`);
  return `unrecognised leg shape: ${parts.join(" ") || "empty"}`;
}
