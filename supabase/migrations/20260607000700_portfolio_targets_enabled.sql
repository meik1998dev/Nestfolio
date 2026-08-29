-- Per-portfolio switch for the target / rebalancing feature. When false, the
-- targets set INSIDE this portfolio (its direct sub-portfolios and its own
-- holdings) are ignored everywhere: allocation ring, target alignment, target
-- columns, rebalance levels and the contribution planner. The portfolio's own
-- `target_pct` (relative to its parent) is unaffected — the parent owns that.
-- Not inherited: every portfolio carries its own setting.
alter table portfolios
  add column if not exists targets_enabled boolean not null default true;
