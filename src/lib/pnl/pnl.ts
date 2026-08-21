/**
 * PnL read path (EN6.3) — replays the FULL trade ledger (manual + wallet)
 * through the same average-cost engine the performance chart uses, then prices
 * open positions at live quotes.
 *
 * Why replay instead of reading the materialized `cost_basis`: cost_basis is
 * rebuilt from WALLET transfers only — manual transactions never enter it, and
 * rows written by older code for now-manual tickers linger as stale artifacts
 * (upserts don't prune obsolete tickers). The header cards and the charts MUST
 * show the same numbers, so both consume one ledger replay. Single-user scale
 * (~150 trades) makes this cheap; pure DB + price-cache math, no chain calls.
 *
 * Degrades gracefully: a missing live price yields null PnL for that holding
 * and flags the rollup; everything else still renders last-known values.
 */
import { createClient } from "@/lib/supabase/server";
import { priceProvider, type PriceProvider } from "@/lib/price/provider";
import { refreshLivePrices } from "@/lib/sync/orchestrator";
import { resolveToken } from "@/lib/price/ticker";
import { todayIso } from "@/lib/price/history";
import {
  loadAllRows,
  buildLoaded,
  loadHistories,
} from "@/lib/insights/performance";
import {
  buildLedger,
  positionPnl,
  rollup,
  type PositionPnl,
  type PnlRollup,
} from "./costbasis";
import { classifyTransfers, type TransferLeg } from "./classify";
import { reconcileCash, type ReconcileResult } from "./reconcile";

export interface PnlView {
  holdings: PositionPnl[];
  rollup: PnlRollup;
  /** Reconciliation status, or null if there's no wallet/cash to check. */
  reconciliation: ReconcileResult | null;
  /** True when there are no trades to replay yet. */
  empty: boolean;
}

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export interface GetPnlDeps {
  supabase?: SupabaseLike;
  prices?: PriceProvider;
}

/**
 * Compute the full PnL view for the user: ledger replay + live prices +
 * reconciliation guard. Shares its engine with the performance series, so the
 * headline cards tie to the charts by construction.
 */
export async function getPnl(
  _userId: string,
  deps: GetPnlDeps = {},
): Promise<PnlView> {
  const supabase = deps.supabase ?? (await createClient());
  const prices = deps.prices ?? priceProvider();

  const rows = await loadAllRows();
  const { trades, events, tickers } = buildLoaded(rows, (a) => resolveToken(a).ticker);
  if (trades.length === 0) {
    return { holdings: [], rollup: rollup([]), reconciliation: null, empty: true };
  }

  // Historical prices only matter for 1-leg events (delivery/send); their
  // captured unit prices seed the lookup, so this is usually zero-fetch.
  const today = todayIso();
  const startIso = events.reduce(
    (min, e) => (e.ts.slice(0, 10) < min ? e.ts.slice(0, 10) : min),
    today,
  );
  const histLookup = await loadHistories(supabase, trades, tickers, startIso, today, [today]);

  // Average-cost positions across the merged manual + wallet ledger.
  const positions = buildLedger(events, histLookup);
  if (positions.length === 0) {
    return { holdings: [], rollup: rollup([]), reconciliation: null, empty: true };
  }

  // Wallet attribution per ticker — scopes fully-closed positions to portfolio
  // subtrees (they have no current holding row to match on).
  const walletsByTicker = new Map<string, Set<string>>();
  for (const t of trades) {
    if (t.row.source !== "wallet" || !t.row.walletId) continue;
    let set = walletsByTicker.get(t.ticker);
    if (!set) walletsByTicker.set(t.ticker, (set = new Set()));
    set.add(t.row.walletId);
  }

  const heldTickers = positions
    .filter((p) => p.shares > 1e-9)
    .map((p) => p.ticker);

  // Refresh + read live prices for held tickers (TTL-gated inside).
  await refreshLivePrices(heldTickers, prices);
  const priceByTicker = await readLivePrices(supabase, heldTickers);

  const scoped = positions.map((p) => ({
    ...p,
    walletIds: [...(walletsByTicker.get(p.ticker) ?? [])],
  }));
  const holdings = scoped
    .map((p) => positionPnl(p, priceByTicker.get(p.ticker) ?? null))
    // Brokerage-style: biggest total PnL first; losers at the bottom.
    .sort((a, b) => (b.totalPnl ?? -Infinity) - (a.totalPnl ?? -Infinity));

  const reconciliation = await reconcile(supabase);

  return {
    holdings,
    rollup: rollup(holdings),
    reconciliation,
    empty: false,
  };
}

/** Read cached live prices for the given tickers into a ticker→price map. */
async function readLivePrices(
  supabase: SupabaseLike,
  tickers: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (tickers.length === 0) return map;
  const { data } = await supabase
    .from("live_prices")
    .select("ticker, price")
    .in("ticker", tickers);
  for (const p of (data ?? []) as Array<{ ticker: string; price: number }>) {
    map.set(p.ticker.toUpperCase(), Number(p.price));
  }
  return map;
}

/**
 * Run the cash-reconciliation guard from stored transfers + current stablecoin
 * holdings. Returns null when there's no wallet to reconcile.
 */
async function reconcile(
  supabase: SupabaseLike,
): Promise<ReconcileResult | null> {
  const { data: wallet } = await supabase
    .from("wallets")
    .select("id, address")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!wallet) return null;

  const { data: transferRows } = await supabase
    .from("wallet_transfers")
    .select("tx_hash, ts, token_symbol, direction, raw_amount, decimals")
    .eq("wallet_id", (wallet as { id: string }).id);
  const transfers = (transferRows ?? []) as TransferLeg[];
  if (transfers.length === 0) return null;

  const { events } = classifyTransfers(transfers);

  const { data: holdings } = await supabase
    .from("holdings")
    .select("asset, amount")
    .eq("source", "wallet")
    .eq("wallet_ref", (wallet as { address: string }).address);
  let stableBalance = 0;
  for (const h of (holdings ?? []) as Array<{
    asset: string;
    amount: number;
  }>) {
    if (resolveToken(h.asset).kind === "stablecoin") {
      stableBalance += Number(h.amount);
    }
  }

  return reconcileCash(events, stableBalance);
}
