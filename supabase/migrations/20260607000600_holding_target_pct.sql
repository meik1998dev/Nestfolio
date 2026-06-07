-- Per-asset target allocation. A holding may carry an optional target % of its
-- portfolio (0..100). Null = no target. Siblings within a portfolio should sum
-- to ~100, but this is advisory and not enforced (partial targets are allowed).
alter table holdings
  add column if not exists target_pct numeric(6, 3)
    check (target_pct is null or (target_pct >= 0 and target_pct <= 100));
