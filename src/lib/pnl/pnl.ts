/**
 * PnL read path (EN6.3) — the LIGHT side of the two-speed model.
 *
 * `getPnl` reads the materialized `cost_basis` (realized + remaining cost,
 * computed by the heavy sync) and the live equity prices, then computes
 * per-holding unrealized/total PnL and a portfolio rollup — pure DB + price-cache
 * math, no chain calls. It refreshes stale live prices via the PriceProvider
 * (F4 `refreshLivePrices`) and runs the reconciliation guard so the UI can show
 * an error instead of a wrong number when cash doesn't tie out.
 *
 * Degrades gracefully: a missing live price yields null PnL for that holding and
 * flags the rollup; everything else still renders last-known values.
 */
import { createClient } from "@/lib/supabase/server";
import { priceProvider, type PriceProvider } from "@/lib/price/provider";
import { refreshLivePrices } from "@/lib/sync/orchestrator";
import { resolveToken } from "@/lib/price/ticker";
import {
  positionPnl,
  rollup,
  type LedgerPosition,
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
  /** True when no wallet or no cost-basis rows exist yet. */
  empty: boolean;
}

type SupabaseLike = Awaited<ReturnType<typeof createClient>>;

export interface GetPnlDeps {
  supabase?: SupabaseLike;
  prices?: PriceProvider;
}

/**
 * Compute the full PnL view for the user. Reads cost_basis, refreshes + reads
 * live prices, runs the reconciliation guard. Pure DB + price-cache math.
 */
export async function getPnl(
  _userId: string,
  deps: GetPnlDeps = {},
): Promise<PnlView> {
  const supabase = deps.supabase ?? (await createClient());
  const prices = deps.prices ?? priceProvider();

  // RLS scopes these reads to the user; no explicit user_id filter needed.
  const { data: cbRows, error: cbErr } = await supabase
    .from("cost_basis")
    .select("ticker, shares, cost_basis, realized_pnl, wallet_id");
  if (cbErr) throw new Error(`read cost_basis: ${cbErr.message}`);

  const positions: LedgerPosition[] = (cbRows ?? []).map(
    (r: {
      ticker: string;
      shares: number;
      cost_basis: number;
      realized_pnl: number;
      wallet_id: string | null;
    }) => ({
      ticker: r.ticker,
      shares: Number(r.shares),
      costBasis: Number(r.cost_basis),
      realizedPnl: Number(r.realized_pnl),
      walletId: r.wallet_id ?? undefined,
    }),
  );

  if (positions.length === 0) {
    return {
      holdings: [],
      rollup: rollup([]),
      reconciliation: null,
      empty: true,
    };
  }

  // Refresh + read live prices for held tickers (TTL-gated inside the provider).
  const tickers = positions.filter((p) => p.shares > 0).map((p) => p.ticker);
  await refreshLivePrices(tickers, prices);
  const priceByTicker = await readLivePrices(supabase, tickers);

  const holdings = positions
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

/** Read cached live prices for the given tickers. */
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
    map.set(p.ticker, Number(p.price));
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
