/**
 * Sync orchestrator (EN4.2 + EN4.5) — the two-speed, incremental, async model.
 *
 * HEAVY (incremental): fetch transfers since `last_synced_block` (with a reorg
 * overlap), idempotently upsert raw `wallet_transfers`, then upsert `holdings`
 * from CURRENT balances (unassigned bucket), then refresh live prices for held
 * tickers. F4 deliberately stops there — classification into trade_events,
 * cost_basis and PnL are F6, which consume `wallet_transfers` + the PriceProvider.
 *
 * Correctness rules (see sync-and-persistence-design.md):
 *   - Idempotent appends: re-running never duplicates transfers (unique key).
 *   - Reorg overlap: re-scan the last N blocks; dedup absorbs duplicates.
 *   - Degrade gracefully: any failure → status 'degraded'/'error', last-known
 *     rows preserved, never wiped.
 *
 * All external dependencies (DB, wallet provider, price provider) are injected
 * so the whole flow is unit-testable with zero network access.
 */
import { createServiceClient } from "@/lib/supabase/service";
import {
  walletProvider,
  type WalletProvider,
  type NormalizedTransfer,
  type WalletBalance,
} from "@/lib/wallet/provider";
import { priceProvider, type PriceProvider } from "@/lib/price/provider";
import { resolveToken } from "@/lib/price/ticker";
import type { SyncStatus } from "@/lib/types";

/** How many blocks to re-scan each sync to absorb shallow reorgs. */
const REORG_OVERLAP_BLOCKS = 20;

/** Cap pages per run so one sync can't loop forever on a busy wallet. */
const MAX_PAGES = 50;

type Db = ReturnType<typeof createServiceClient>;

export interface SyncDeps {
  db?: Db;
  wallet?: WalletProvider;
  prices?: PriceProvider;
}

export interface SyncResult {
  status: SyncStatus;
  transfersAdded: number;
  holdingsUpserted: number;
  lastSyncedBlock: number | null;
  error?: string;
}

interface WalletRow {
  id: string;
  user_id: string;
  address: string;
  last_synced_block: number | null;
}

/**
 * Run a sync for one wallet. Reads the cursor, fetches the delta, persists it,
 * reconciles holdings to current balances, and refreshes live prices. Never
 * throws — returns a result with a degraded/error status on failure.
 */
export async function runSync(
  userId: string,
  walletId: string,
  deps: SyncDeps = {},
): Promise<SyncResult> {
  const db = deps.db ?? createServiceClient();
  const wallet = deps.wallet ?? walletProvider();
  const prices = deps.prices ?? priceProvider();

  const { data: walletRow, error: wErr } = await db
    .from("wallets")
    .select("id, user_id, address, last_synced_block")
    .eq("id", walletId)
    .eq("user_id", userId)
    .maybeSingle();

  if (wErr || !walletRow) {
    return {
      status: "error",
      transfersAdded: 0,
      holdingsUpserted: 0,
      lastSyncedBlock: null,
      error: wErr?.message ?? "Wallet not found",
    };
  }
  const w = walletRow as WalletRow;

  await setStatus(db, walletId, "syncing");

  try {
    // 1. Incremental transfer fetch from the cursor (with reorg overlap).
    const fromBlock =
      w.last_synced_block !== null
        ? Math.max(0, w.last_synced_block - REORG_OVERLAP_BLOCKS)
        : undefined;

    const { transfers, maxBlock } = await fetchTransfers(
      wallet,
      w.address,
      fromBlock,
    );

    // 2. Idempotent upsert of raw transfers on (wallet_id, tx_hash, log_index).
    const transfersAdded = await upsertTransfers(
      db,
      userId,
      walletId,
      transfers,
    );

    // 3. Reconcile holdings to CURRENT balances (unassigned bucket).
    const balances = await wallet.getBalances(w.address);
    const holdingsUpserted = await syncHoldings(
      db,
      userId,
      w.address,
      balances,
    );

    // 4. Refresh live prices for held, priceable tickers (TTL-gated inside).
    const tickers = tickersFor(balances);
    await refreshLivePrices(tickers, prices);

    // 5. Success: advance cursor, mark synced.
    const nextBlock = maxBlock ?? w.last_synced_block ?? null;
    await db
      .from("wallets")
      .update({
        last_synced_block: nextBlock,
        last_synced_at: new Date().toISOString(),
        sync_status: "synced" satisfies SyncStatus,
      })
      .eq("id", walletId);

    return {
      status: "synced",
      transfersAdded,
      holdingsUpserted,
      lastSyncedBlock: nextBlock,
    };
  } catch (err) {
    // Degrade gracefully: keep last-known rows, flag the wallet, never wipe.
    await setStatus(db, walletId, "degraded");
    return {
      status: "degraded",
      transfersAdded: 0,
      holdingsUpserted: 0,
      lastSyncedBlock: w.last_synced_block ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Paginate all transfers from the provider, tracking the highest block seen. */
async function fetchTransfers(
  wallet: WalletProvider,
  address: string,
  fromBlock: number | undefined,
): Promise<{ transfers: NormalizedTransfer[]; maxBlock: number | null }> {
  const all: NormalizedTransfer[] = [];
  let cursor: string | undefined;
  let maxBlock: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await wallet.getTransfers(address, { fromBlock, cursor });
    for (const t of res.transfers) {
      all.push(t);
      if (maxBlock === null || t.blockNumber > maxBlock)
        maxBlock = t.blockNumber;
    }
    if (!res.cursor) break;
    cursor = res.cursor;
  }

  return { transfers: all, maxBlock };
}

/**
 * Upsert raw transfers idempotently. The unique (wallet_id, tx_hash, log_index)
 * constraint means re-running with overlapping blocks never duplicates rows.
 * Returns the number of rows in the batch (upsert is idempotent regardless).
 */
async function upsertTransfers(
  db: Db,
  userId: string,
  walletId: string,
  transfers: NormalizedTransfer[],
): Promise<number> {
  if (transfers.length === 0) return 0;

  const rows = transfers.map((t) => ({
    user_id: userId,
    wallet_id: walletId,
    tx_hash: t.txHash,
    log_index: t.logIndex,
    block_number: t.blockNumber,
    ts: t.ts,
    token_address: t.tokenAddress,
    token_symbol: t.tokenSymbol,
    direction: t.direction,
    counterparty: t.counterparty,
    raw_amount: t.rawAmount,
    decimals: t.decimals,
  }));

  const { error } = await db.from("wallet_transfers").upsert(rows, {
    onConflict: "wallet_id,tx_hash,log_index",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`transfer upsert: ${error.message}`);

  return rows.length;
}

/**
 * Reconcile wallet holdings to the current on-chain balances. Matches existing
 * rows by (user_id, wallet_ref, asset). Updates amounts, inserts new tokens
 * (portfolio_id null = unassigned bucket; tokenized stocks keep the token symbol
 * as `asset` so F3/F6 can resolve them), and removes ones no longer held.
 */
async function syncHoldings(
  db: Db,
  userId: string,
  address: string,
  balances: WalletBalance[],
): Promise<number> {
  const { data: existing, error } = await db
    .from("holdings")
    .select("id, asset")
    .eq("user_id", userId)
    .eq("source", "wallet")
    .eq("wallet_ref", address);
  if (error) throw new Error(`read holdings: ${error.message}`);

  const existingByAsset = new Map<string, string>(
    ((existing ?? []) as Array<{ id: string; asset: string }>).map((h) => [
      h.asset,
      h.id,
    ]),
  );

  const held = new Set<string>();
  let upserted = 0;

  for (const b of balances) {
    const asset = b.symbol;
    held.add(asset);
    const id = existingByAsset.get(asset);
    if (id) {
      const { error: uErr } = await db
        .from("holdings")
        .update({ amount: b.amount })
        .eq("id", id);
      if (uErr) throw new Error(`update holding: ${uErr.message}`);
    } else {
      const { error: iErr } = await db.from("holdings").insert({
        user_id: userId,
        asset,
        amount: b.amount,
        source: "wallet",
        wallet_ref: address,
        portfolio_id: null, // unassigned bucket
      });
      if (iErr) throw new Error(`insert holding: ${iErr.message}`);
    }
    upserted++;
  }

  // Remove wallet holdings no longer present on-chain (zero balance / sent out).
  const stale = [...existingByAsset.entries()]
    .filter(([asset]) => !held.has(asset))
    .map(([, id]) => id);
  if (stale.length > 0) {
    const { error: dErr } = await db.from("holdings").delete().in("id", stale);
    if (dErr) throw new Error(`prune holdings: ${dErr.message}`);
  }

  return upserted;
}

/** The set of priceable tickers for a balance set (skips stablecoins/unknown). */
function tickersFor(balances: WalletBalance[]): string[] {
  const set = new Set<string>();
  for (const b of balances) {
    const r = resolveToken(b.symbol);
    if (r.ticker) set.add(r.ticker);
  }
  return [...set];
}

/**
 * Light refresh: ensure live_prices is fresh for the given tickers. The
 * PriceProvider's TTL gate means fresh entries are not re-fetched. Failures for
 * individual tickers are swallowed so one bad ticker can't break the sync.
 */
export async function refreshLivePrices(
  tickers: string[],
  prices: PriceProvider = priceProvider(),
): Promise<void> {
  await Promise.all(
    tickers.map(async (t) => {
      try {
        await prices.livePrice(t);
      } catch {
        // best-effort; degrade gracefully
      }
    }),
  );
}

async function setStatus(db: Db, walletId: string, status: SyncStatus) {
  await db.from("wallets").update({ sync_status: status }).eq("id", walletId);
}
