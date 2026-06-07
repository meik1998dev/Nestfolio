/**
 * Cost-basis ledger persistence (EN6.2) — the HEAVY side of the two-speed model.
 *
 * `rebuildCostBasis` reads stored `wallet_transfers`, classifies them into
 * `trade_events`, ensures the historical prices that 1-leg deliveries/sends need
 * exist (immutable, fetched once via the PriceProvider's cache), runs the
 * average-cost loop, and upserts the materialized `cost_basis` rows. Realized PnL
 * is recomputed here (it only changes on new trades).
 *
 * Idempotent: trade_events for the wallet are cleared and rewritten, and
 * cost_basis is upserted on (wallet_id, ticker). Re-running yields the same rows.
 *
 * All external deps (DB, price provider) are injected so this is testable with
 * zero network access. Uses the service-role client (pass explicit user_id).
 */
import { createServiceClient } from "@/lib/supabase/service";
import { priceProvider, type PriceProvider } from "@/lib/price/provider";
import { resolveToken } from "@/lib/price/ticker";
import {
  classifyTransfers,
  type TransferLeg,
  type TradeEventInput,
} from "./classify";
import { buildLedger, isoDay, type HistPriceLookup } from "./costbasis";

type Db = ReturnType<typeof createServiceClient>;

export interface RebuildDeps {
  db?: Db;
  prices?: PriceProvider;
}

export interface RebuildResult {
  eventsWritten: number;
  tickersUpserted: number;
}

/**
 * Rebuild trade_events + cost_basis for one wallet from its stored transfers.
 * Returns counts for logging. Throws on unrecoverable DB errors; the caller
 * (sync orchestrator / route) maps that to a degraded status.
 */
export async function rebuildCostBasis(
  userId: string,
  walletId: string,
  deps: RebuildDeps = {},
): Promise<RebuildResult> {
  const db = deps.db ?? createServiceClient();
  const prices = deps.prices ?? priceProvider();

  // 1. Read raw transfers for this wallet (the immutable source of truth).
  const { data: transferRows, error: tErr } = await db
    .from("wallet_transfers")
    .select("tx_hash, ts, token_symbol, direction, raw_amount, decimals")
    .eq("wallet_id", walletId)
    .order("ts", { ascending: true });
  if (tErr) throw new Error(`read transfers: ${tErr.message}`);

  const transfers = (transferRows ?? []) as TransferLeg[];

  // 2. Classify into normalized economic events.
  const { events } = classifyTransfers(transfers);

  // 3. Ensure historical prices exist for 1-leg events (delivery/send), then
  //    build a synchronous lookup the pure cost-basis loop can use.
  const histLookup = await ensureHistPrices(events, prices);

  // 4. Persist trade_events idempotently (clear + rewrite for this wallet).
  const eventsWritten = await writeTradeEvents(
    db,
    userId,
    walletId,
    events,
    histLookup,
  );

  // 5. Run the average-cost loop and upsert the materialized cost_basis.
  const positions = buildLedger(events, histLookup);
  const tickersUpserted = await upsertCostBasis(
    db,
    userId,
    walletId,
    positions,
  );

  return { eventsWritten, tickersUpserted };
}

/**
 * Fetch (and cache) the historical equity price for every 1-leg event, then
 * return an in-memory synchronous lookup keyed by (ticker, day). The provider
 * writes immutable price_history rows; we only fetch missing pairs.
 */
async function ensureHistPrices(
  events: TradeEventInput[],
  prices: PriceProvider,
): Promise<HistPriceLookup> {
  const needed = new Map<string, { ticker: string; date: string }>();
  for (const ev of events) {
    if (ev.type === "delivery" || ev.type === "send") {
      const date = isoDay(ev.ts);
      needed.set(`${ev.ticker}|${date}`, { ticker: ev.ticker, date });
    }
  }

  const byKey = new Map<string, number>();
  await Promise.all(
    [...needed.values()].map(async ({ ticker, date }) => {
      const close = await prices.histPrice(ticker, date);
      if (close !== null) byKey.set(`${ticker}|${date}`, close);
    }),
  );

  return (ticker, date) => byKey.get(`${ticker}|${date}`) ?? null;
}

/** Clear + rewrite trade_events for this wallet (idempotent rebuild). */
async function writeTradeEvents(
  db: Db,
  userId: string,
  walletId: string,
  events: TradeEventInput[],
  histLookup: HistPriceLookup,
): Promise<number> {
  const { error: delErr } = await db
    .from("trade_events")
    .delete()
    .eq("wallet_id", walletId);
  if (delErr) throw new Error(`clear trade_events: ${delErr.message}`);

  if (events.length === 0) return 0;

  const rows = events.map((ev) => {
    const day = isoDay(ev.ts);
    // For 1-leg events, materialize the resolved unit price + value so the row
    // is self-describing; 2-leg events carry the exact on-chain usd.
    const histUnit =
      ev.type === "delivery" || ev.type === "send"
        ? histLookup(ev.ticker, day)
        : null;
    const usdValue =
      ev.usdValue ?? (histUnit !== null ? histUnit * ev.shares : null);
    const unitPrice =
      ev.usdValue !== undefined && ev.shares > 0
        ? ev.usdValue / ev.shares
        : histUnit;
    return {
      user_id: userId,
      wallet_id: walletId,
      ts: ev.ts,
      type: ev.type,
      ticker: ev.ticker,
      shares: ev.shares,
      usd_value: usdValue,
      unit_price: unitPrice,
      price_source:
        ev.type === "delivery" || ev.type === "send"
          ? "price_history"
          : "on_chain",
      tx_hash: ev.tx_hash,
    };
  });

  const { error: insErr } = await db.from("trade_events").insert(rows);
  if (insErr) throw new Error(`insert trade_events: ${insErr.message}`);
  return rows.length;
}

/** Upsert the materialized cost_basis rows (unique on wallet_id, ticker). */
async function upsertCostBasis(
  db: Db,
  userId: string,
  walletId: string,
  positions: ReturnType<typeof buildLedger>,
): Promise<number> {
  if (positions.length === 0) return 0;

  const rows = positions.map((p) => ({
    user_id: userId,
    wallet_id: walletId,
    ticker: p.ticker,
    shares: p.shares,
    cost_basis: p.costBasis,
    realized_pnl: p.realizedPnl,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from("cost_basis")
    .upsert(rows, { onConflict: "wallet_id,ticker" });
  if (error) throw new Error(`upsert cost_basis: ${error.message}`);
  return rows.length;
}

/**
 * Current stablecoin (USD cash) balance for a wallet, read from synced holdings.
 * Used by the reconciliation guard. Pure DB read — no chain call.
 */
export async function currentStablecoinBalance(
  db: Db,
  walletAddress: string,
): Promise<number> {
  const { data, error } = await db
    .from("holdings")
    .select("asset, amount")
    .eq("source", "wallet")
    .eq("wallet_ref", walletAddress);
  if (error) throw new Error(`read holdings: ${error.message}`);

  let total = 0;
  for (const h of (data ?? []) as Array<{ asset: string; amount: number }>) {
    if (resolveToken(h.asset).kind === "stablecoin") total += Number(h.amount);
  }
  return total;
}
