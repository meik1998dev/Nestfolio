-- Simplify to an asset tracker: drop accounts & liabilities, and reshape the
-- `transactions` ledger from cash double-entry into an asset-trade log
-- (buy/sell of `amount` units of `asset` at an optional unit `price`).
-- Holdings, portfolios, snapshots, wallets and PnL tables are unchanged.

-- 1. Add the trade columns.
alter table transactions
  add column if not exists asset text not null default '',
  add column if not exists price numeric(38, 18);

-- 2. Backfill structured trade data from legacy notes, e.g.
--    "BUY 0.00069 BTC @ $71,453.75 (Binance spot)"
--    → asset=BTC, amount(qty)=0.00069, price=71453.75
--    (the old `amount` held the USD value = qty x price; we replace it with qty).
update transactions t
set
  amount = (parts[1])::numeric,
  asset = parts[2],
  price = replace(parts[3], ',', '')::numeric
from (
  select
    id,
    regexp_match(
      note,
      '^(?:BUY|SELL)\s+([0-9.]+)\s+([A-Za-z]+).*?@\s*\$([0-9,]+(?:\.[0-9]+)?)'
    ) as parts
  from transactions
) sub
where t.id = sub.id
  and sub.parts is not null;

-- 3. Drop the legacy cash-ledger columns.
alter table transactions
  drop column if exists source_account,
  drop column if exists dest_account,
  drop column if exists category;

-- amount keeps its check (>= 0) and now means "quantity of the asset".
-- Restrict the type to actual trades (the enum still carries legacy values).
alter table transactions
  drop constraint if exists transactions_trade_type,
  add constraint transactions_trade_type check (type in ('buy', 'sell'));

-- 4. Drop the removed features. RLS policies drop automatically with the table.
drop table if exists accounts cascade;
drop table if exists liabilities cascade;
