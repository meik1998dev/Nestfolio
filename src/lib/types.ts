/**
 * Database row types — hand-mirrored from supabase/migrations.
 * Keep in sync with the SQL schema; these are the single source of truth for
 * shapes used across server actions, queries, and components.
 */

// --- Enums (see 20260607000100_enums.sql) ---
/** A trade only ever acquires or disposes an asset. */
export type TransactionType = "buy" | "sell";

export type HoldingSource = "manual" | "wallet";

export type TradeEventType = "buy" | "sell" | "delivery" | "send" | "deposit";

export type SyncStatus = "idle" | "syncing" | "synced" | "degraded" | "error";

export type TransferDirection = "in" | "out";

// --- Core tables ---
export interface Portfolio {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  /** Target allocation %, relative to its parent's value (siblings sum to 100). */
  target_pct: number | null;
  /**
   * Is the target / rebalancing feature on INSIDE this portfolio? When false,
   * the targets of its direct children and of its own holdings are ignored and
   * hidden everywhere. Its own `target_pct` (owned by the parent) still counts.
   * Not inherited — each portfolio carries its own setting.
   */
  targets_enabled: boolean;
  created_at: string;
}

export interface Holding {
  id: string;
  user_id: string;
  portfolio_id: string | null;
  asset: string;
  amount: number;
  source: HoldingSource;
  wallet_ref: string | null;
  /** Optional target allocation %, relative to its portfolio (0..100). */
  target_pct: number | null;
  created_at: string;
}

/** A manual asset trade — one buy or sell of `amount` units of `asset`. */
export interface Transaction {
  id: string;
  user_id: string;
  date: string;
  type: TransactionType;
  /** Ticker/symbol traded (e.g. BTC, NVDA, XAU). */
  asset: string;
  /** Quantity of the asset bought or sold. */
  amount: number;
  /** Unit price in USD; null when not recorded. */
  price: number | null;
  note: string | null;
  created_at: string;
}

// --- Sync & PnL persistence ---
export interface Wallet {
  id: string;
  user_id: string;
  address: string;
  last_synced_block: number | null;
  last_synced_at: string | null;
  sync_status: SyncStatus;
  created_at: string;
}

export interface WalletTransfer {
  id: string;
  user_id: string;
  wallet_id: string;
  tx_hash: string;
  log_index: number;
  block_number: number;
  ts: string;
  token_address: string;
  token_symbol: string | null;
  direction: TransferDirection;
  counterparty: string | null;
  raw_amount: string;
  decimals: number;
  created_at: string;
}

export interface TradeEvent {
  id: string;
  user_id: string;
  wallet_id: string;
  ts: string;
  type: TradeEventType;
  ticker: string;
  shares: number;
  usd_value: number | null;
  unit_price: number | null;
  price_source: string | null;
  tx_hash: string | null;
  created_at: string;
}

export interface CostBasis {
  id: string;
  user_id: string;
  wallet_id: string;
  ticker: string;
  shares: number;
  cost_basis: number;
  realized_pnl: number;
  updated_at: string;
}

// --- Global market data ---
export interface PriceHistory {
  ticker: string;
  date: string;
  close: number;
}

export interface LivePrice {
  ticker: string;
  price: number;
  fetched_at: string;
}
