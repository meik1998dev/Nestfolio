/**
 * Database row types — hand-mirrored from supabase/migrations.
 * Keep in sync with the SQL schema; these are the single source of truth for
 * shapes used across server actions, queries, and components.
 */

// --- Enums (see 20260607000100_enums.sql) ---
export type AccountType =
  | "cash"
  | "crypto_wallet"
  | "gold"
  | "stock"
  | "expense"
  | "external";

export type TransactionType =
  | "income"
  | "buy"
  | "sell"
  | "transfer"
  | "expense";

export type HoldingSource = "manual" | "wallet";

export type TradeEventType = "buy" | "sell" | "delivery" | "send" | "deposit";

export type SyncStatus = "idle" | "syncing" | "synced" | "degraded" | "error";

export type TransferDirection = "in" | "out";

// --- Core tables ---
export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  currency: string;
  created_at: string;
}

export interface Portfolio {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  /** Target allocation %, relative to its parent's value (siblings sum to 100). */
  target_pct: number | null;
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
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  date: string;
  type: TransactionType;
  source_account: string | null;
  dest_account: string | null;
  amount: number;
  category: string | null;
  note: string | null;
  created_at: string;
}

export interface Liability {
  id: string;
  user_id: string;
  name: string;
  balance: number;
  type: string | null;
  created_at: string;
}

export interface Snapshot {
  id: string;
  user_id: string;
  taken_at: string;
  net_worth: number;
  breakdown: Record<string, unknown>;
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
