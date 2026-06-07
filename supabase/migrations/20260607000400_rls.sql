-- EN1.2 — Row-Level Security.
-- User tables: every row scoped to user_id = auth.uid().
-- Market-data tables: global, read-only to clients; only the service role writes
-- (the service role bypasses RLS, so we add no write policy).

-- Per-user owner policy applied uniformly to all user-scoped tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'accounts', 'portfolios', 'holdings', 'transactions', 'liabilities',
    'snapshots', 'wallets', 'wallet_transfers', 'trade_events', 'cost_basis'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format('alter table %I force row level security;', t);
    execute format($p$
      create policy %1$s_owner on %1$I
        for all
        to authenticated
        using (user_id = auth.uid())
        with check (user_id = auth.uid());
    $p$, t);
  end loop;
end $$;

-- Market data: read-only to any authenticated client, writes only via service role.
alter table price_history enable row level security;
alter table live_prices  enable row level security;

create policy price_history_read on price_history
  for select to authenticated using (true);

create policy live_prices_read on live_prices
  for select to authenticated using (true);
