-- EN1.2 — Async-sync & PnL persistence layer (see sync-and-persistence-design.md).
-- Slow/immutable data is stored once and only appended to; volatile data is a cache.

-- Sync cursor, one per tracked wallet.
create table wallets (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  address             text not null,
  last_synced_block   bigint,
  last_synced_at      timestamptz,
  sync_status         sync_status not null default 'idle',
  created_at          timestamptz not null default now(),
  unique (user_id, address)
);
create index wallets_user_id_idx on wallets (user_id);

-- Raw normalized transfers. Idempotent appends on (wallet_id, tx_hash, log_index).
create table wallet_transfers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  wallet_id       uuid not null references wallets (id) on delete cascade,
  tx_hash         text not null,
  log_index       integer not null,
  block_number    bigint not null,
  ts              timestamptz not null,
  token_address   text not null,
  token_symbol    text,
  direction       transfer_direction not null,
  counterparty    text,
  raw_amount      numeric(78, 0) not null,
  decimals        integer not null default 18,
  created_at      timestamptz not null default now(),
  unique (wallet_id, tx_hash, log_index)
);
create index wallet_transfers_user_id_idx on wallet_transfers (user_id);
create index wallet_transfers_wallet_id_idx on wallet_transfers (wallet_id, ts);

-- Classified economic events derived from new transfers.
create table trade_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  wallet_id     uuid not null references wallets (id) on delete cascade,
  ts            timestamptz not null,
  type          trade_event_type not null,
  ticker        text not null,
  shares        numeric(38, 18) not null,
  usd_value     numeric(38, 18),
  unit_price    numeric(38, 18),
  price_source  text,
  tx_hash       text,
  created_at    timestamptz not null default now()
);
create index trade_events_user_id_idx on trade_events (user_id);
create index trade_events_wallet_ticker_idx on trade_events (wallet_id, ticker, ts);

-- Materialized cost-basis ledger; one row per (wallet, ticker).
create table cost_basis (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  wallet_id     uuid not null references wallets (id) on delete cascade,
  ticker        text not null,
  shares        numeric(38, 18) not null default 0,
  cost_basis    numeric(38, 18) not null default 0,
  realized_pnl  numeric(38, 18) not null default 0,
  updated_at    timestamptz not null default now(),
  unique (wallet_id, ticker)
);
create index cost_basis_user_id_idx on cost_basis (user_id);

-- Global market data — NOT user-scoped. Only the service role (sync job) writes.

-- Immutable daily closes.
create table price_history (
  ticker  text not null,
  date    date not null,
  close   numeric(38, 18) not null,
  primary key (ticker, date)
);

-- Live quote cache with TTL (fetched_at drives staleness).
create table live_prices (
  ticker      text primary key,
  price       numeric(38, 18) not null,
  fetched_at  timestamptz not null default now()
);
