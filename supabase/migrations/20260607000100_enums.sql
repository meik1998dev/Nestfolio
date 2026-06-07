-- EN1.2 — Seed enums shared across the schema.

create type account_type as enum (
  'cash', 'crypto_wallet', 'gold', 'stock', 'expense', 'external'
);

create type transaction_type as enum (
  'income', 'buy', 'sell', 'transfer', 'expense'
);

create type holding_source as enum (
  'manual', 'wallet'
);

create type trade_event_type as enum (
  'buy', 'sell', 'delivery', 'send', 'deposit'
);

create type sync_status as enum (
  'idle', 'syncing', 'synced', 'degraded', 'error'
);

create type transfer_direction as enum (
  'in', 'out'
);
