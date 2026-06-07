-- EN1.2 — Core user-scoped tables. Every row is owned by a user; RLS in
-- 20260607000400_rls.sql locks each row to user_id = auth.uid().

create table accounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  type        account_type not null,
  currency    text not null default 'USD',
  created_at  timestamptz not null default now()
);
create index accounts_user_id_idx on accounts (user_id);

create table portfolios (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  parent_id   uuid references portfolios (id) on delete cascade,
  target_pct  numeric(5, 2) check (target_pct is null or (target_pct >= 0 and target_pct <= 100)),
  created_at  timestamptz not null default now()
);
create index portfolios_user_id_idx on portfolios (user_id);
create index portfolios_parent_id_idx on portfolios (parent_id);

create table holdings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  portfolio_id  uuid references portfolios (id) on delete set null,
  asset         text not null,
  amount        numeric(38, 18) not null default 0,
  source        holding_source not null default 'manual',
  wallet_ref    text,
  created_at    timestamptz not null default now()
);
create index holdings_user_id_idx on holdings (user_id);
create index holdings_portfolio_id_idx on holdings (portfolio_id);

create table transactions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  date            date not null default current_date,
  type            transaction_type not null,
  source_account  uuid references accounts (id) on delete set null,
  dest_account    uuid references accounts (id) on delete set null,
  amount          numeric(38, 18) not null check (amount >= 0),
  category        text,
  note            text,
  created_at      timestamptz not null default now()
);
create index transactions_user_id_idx on transactions (user_id);
create index transactions_date_idx on transactions (user_id, date);

create table liabilities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null,
  balance     numeric(38, 18) not null default 0,
  type        text,
  created_at  timestamptz not null default now()
);
create index liabilities_user_id_idx on liabilities (user_id);

create table snapshots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  taken_at    timestamptz not null default now(),
  net_worth   numeric(38, 18) not null,
  breakdown   jsonb not null default '{}'::jsonb
);
create index snapshots_user_id_idx on snapshots (user_id, taken_at desc);
