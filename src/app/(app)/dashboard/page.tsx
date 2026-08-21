/**
 * Portfolio command center (F5 — S5.1/S5.3/S5.4/S5.5). The landing screen.
 *
 * Server Component: assembles the holdings-based net worth (`getNetWorthSummary`)
 * and PnL, then hands data to small client charts. Degrades
 * gracefully — empty holdings/prices never blank the page.
 */
import {
  Wallet,
  Coins,
  PieChart as PieIcon,
  LineChart as LineIcon,
  ArrowUpRight,
  ArrowDownRight,
  CircleCheck,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CardSkeleton,
  ChartCardSkeleton,
  HeroValueSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import { SortableTable } from "@/components/sortable-table";
import { AssetLink } from "@/components/asset-link";
import { formatUSD, formatQty, formatRatioPct, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getNetWorthSummary } from "@/lib/insights/networth.server";
import {
  getPortfolioPerformance,
  getTimeframePnl,
  parsePerfRange,
} from "@/lib/insights/performance";
import { getPnl, type PnlView } from "@/lib/pnl/pnl";
import type { TimeframePnl } from "@/lib/pnl/timeframe.types";
import { getCachedUser } from "@/lib/supabase/server";
import { PerformanceChart } from "@/components/performance-chart";
import { AllocationPie } from "./charts";
import { PnlTimeframeCards } from "./pnl-timeframe-cards";
import { RecomputeButton } from "./recompute-button";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Net worth, allocation, and performance at a glance.",
};

/**
 * Instant chrome + streamed body: the page shell is synchronous so Next can
 * flush the `PageHeader` (and its action buttons) immediately — on first load
 * and on client navigation — while the data-dependent body streams in behind a
 * `<Suspense>` boundary. The `searchParams` promise is passed down un-awaited so
 * the shell never suspends; `DashboardBody` awaits it.
 */
export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Everything you hold, valued live — at a glance."
      >
        <RecomputeButton />
      </PageHeader>

      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** Composed fallback mirroring the real body's spacing and shape. */
function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <HeroValueSkeleton />
      <div className="grid gap-4">
        <CardSkeleton descriptionLines={0} body bodyHeight="h-8" />
      </div>
      <div className="grid gap-4">
        <ChartCardSkeleton />
      </div>
      <ChartCardSkeleton />
      <TableSkeleton rows={6} columns={9} />
    </div>
  );
}

async function DashboardBody({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  // Deduped with the (app) layout's auth check via React `cache()`.
  const user = await getCachedUser();
  const userId = user!.id;

  const { range } = await searchParams;
  const [summary, performance, pnl, windowed] = await Promise.all([
    getNetWorthSummary(),
    // `benchmark: true` populates returnPct + the SPY mirror, so the chart's
    // "Return %" view and the S&P 500 overlay have data (else they render blank).
    getPortfolioPerformance(parsePerfRange(range), { benchmark: true }),
    getPnl(userId),
    getTimeframePnl(),
  ]);

  const hasData = summary.holdingsValue > 0 || !pnl.empty;

  // "All" is the authoritative cumulative rollup (cost_basis); the windowed
  // figures are period deltas from the ledger replay.
  const timeframes: TimeframePnl[] = [
    {
      timeframe: "all",
      realized: pnl.rollup.realized,
      unrealized: pnl.rollup.unrealized,
      total: pnl.rollup.total,
      partial: pnl.rollup.hasMissingPrices,
    },
    ...windowed,
  ];

  // The hero's month line: true P&L generated in the past window (ledger
  // replay delta), not a deposit-mixed value change.
  const monthPnl = timeframes.find((t) => t.timeframe === "1M") ?? null;

  return !hasData ? (
    <FirstRunEmptyState />
  ) : (
    <div className="space-y-6">
      <ReconciliationBanner view={pnl} />

      {/* Hero: portfolio value + 1M P&L (from the ledger replay, no snapshots) */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Portfolio value</CardDescription>
          <CardTitle className="text-4xl tabular-nums sm:text-5xl">
            {formatUSD(summary.netWorth)}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {monthPnl ? (
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium",
                pnlColor(monthPnl.total),
              )}
            >
              {monthPnl.total >= 0 ? (
                <ArrowUpRight className="size-4" />
              ) : (
                <ArrowDownRight className="size-4" />
              )}
              <span className="tabular-nums">
                {formatUSD(monthPnl.total, { signed: true })}
              </span>
              <span className="text-muted-foreground font-normal">
                total P&amp;L in the past month
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              Log a trade or sync a wallet — monthly P&amp;L appears once you
              have a month of history.
            </p>
          )}
          {summary.hasMissingPrices && (
            <p className="text-muted-foreground mt-1 text-xs">
              Some holdings have no live price yet and are valued at $0.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Invested */}
      <div className="grid gap-4">
        <StatCard
          icon={<Coins className="size-4" />}
          label="Invested"
          value={formatUSD(pnl.rollup.costBasis)}
          sub="Net cost of what you still hold — excludes P&L."
        />
      </div>

      {/* P&L by timeframe: Realized / Unrealized / Total with tabs */}
      {!pnl.empty && (
        <PnlTimeframeCards
          data={timeframes}
          investedCapital={pnl.rollup.costBasis}
        />
      )}

      {/* Allocation + Pie */}
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PieIcon className="text-muted-foreground size-4" />
              Where your money sits
            </CardTitle>
            <CardDescription>By asset class</CardDescription>
          </CardHeader>
          <CardContent>
            <AllocationPie
              slices={summary.breakdowns.byAssetClass}
              href="/portfolios/360f0f48-7d7f-49ab-9e40-98d6e94a07a1"
            />
          </CardContent>
        </Card>
      </div>

      {/* Performance: value + P&L over time */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LineIcon className="text-muted-foreground size-4" />
            Performance
          </CardTitle>
          <CardDescription>
            Portfolio value and profit/loss over time — pick a range.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!performance.empty ? (
            <PerformanceChart
              series={performance.series}
              range={performance.range}
              basePath="/dashboard"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="font-medium">History is just getting started</p>
              <p className="text-muted-foreground max-w-sm text-sm">
                Log a trade or sync a wallet and your value line fills in from
                recorded prices.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Holdings: average-cost basis per ticker */}
      {!pnl.empty && <HoldingsTable view={pnl} />}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          {icon}
          {label}
        </div>
        <p
          className={cn("mt-1 text-2xl font-semibold tabular-nums", valueClass)}
        >
          {value}
        </p>
        {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function HoldingsTable({ view }: { view: PnlView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Holdings</CardTitle>
        <CardDescription>
          Average-cost basis. Deliveries are priced at the historical equity
          price on their delivery date (approximate to the day).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SortableTable
          initialSort={{ key: "marketValue", dir: "desc" }}
          columns={[
            { key: "ticker", header: "Ticker", sortable: true },
            { key: "shares", header: "Shares", align: "right", sortable: true },
            {
              key: "avgCost",
              header: "Avg cost",
              align: "right",
              sortable: true,
            },
            {
              key: "costBasis",
              header: "Cost basis",
              align: "right",
              sortable: true,
            },
            {
              key: "livePrice",
              header: "Live price",
              align: "right",
              sortable: true,
            },
            {
              key: "marketValue",
              header: "Market value",
              align: "right",
              sortable: true,
            },
            {
              key: "unrealized",
              header: "Unrealized",
              align: "right",
              sortable: true,
            },
            {
              key: "realized",
              header: "Realized",
              align: "right",
              sortable: true,
            },
            { key: "total", header: "Total", align: "right", sortable: true },
            { key: "return", header: "Return", align: "right", sortable: true },
          ]}
          rows={view.holdings.map((h) => ({
            key: h.ticker,
            sort: {
              ticker: h.ticker,
              shares: h.shares,
              avgCost: h.shares > 0 ? h.avgCost : null,
              costBasis: h.costBasis,
              livePrice: h.livePrice,
              marketValue: h.marketValue,
              unrealized: h.unrealizedPnl,
              realized: h.realizedPnl,
              total: h.totalPnl,
              return:
                h.totalPnl !== null && h.costBasis > 1e-6
                  ? h.totalPnl / h.costBasis
                  : null,
            },
            cells: {
              ticker: (
                <span className="font-medium">
                  <AssetLink symbol={h.ticker} />
                </span>
              ),
              shares: (
                <span className="tabular-nums">{formatQty(h.shares)}</span>
              ),
              avgCost: (
                <span className="text-muted-foreground tabular-nums">
                  {h.shares > 0 ? formatUSD(h.avgCost) : "—"}
                </span>
              ),
              costBasis: (
                <span className="tabular-nums">{formatUSD(h.costBasis)}</span>
              ),
              livePrice: (
                <span className="text-muted-foreground tabular-nums">
                  {h.livePrice !== null ? formatUSD(h.livePrice) : "—"}
                </span>
              ),
              marketValue: (
                <span className="tabular-nums">
                  {h.marketValue !== null ? formatUSD(h.marketValue) : "—"}
                </span>
              ),
              unrealized: (
                <span
                  className={cn(
                    "tabular-nums",
                    h.unrealizedPnl !== null && pnlColor(h.unrealizedPnl),
                  )}
                >
                  {h.unrealizedPnl !== null
                    ? formatUSD(h.unrealizedPnl, { signed: true })
                    : "—"}
                </span>
              ),
              realized: (
                <span className={cn("tabular-nums", pnlColor(h.realizedPnl))}>
                  {formatUSD(h.realizedPnl, { signed: true })}
                </span>
              ),
              total: (
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    h.totalPnl !== null && pnlColor(h.totalPnl),
                  )}
                >
                  {h.totalPnl !== null
                    ? formatUSD(h.totalPnl, { signed: true })
                    : "—"}
                </span>
              ),
              return: (() => {
                const pct =
                  h.totalPnl !== null && h.costBasis > 1e-6
                    ? h.totalPnl / h.costBasis
                    : null;
                return (
                  <span
                    className={cn("tabular-nums", pct !== null && pnlColor(pct))}
                  >
                    {pct !== null
                      ? formatRatioPct(pct, { signed: true })
                      : "—"}
                  </span>
                );
              })(),
            },
          }))}
        />
      </CardContent>
    </Card>
  );
}

function ReconciliationBanner({ view }: { view: PnlView }) {
  const r = view.reconciliation;
  if (!r) return null;

  if (r.pass) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
        <CircleCheck className="size-4 shrink-0 text-emerald-600" />
        <span className="text-muted-foreground">
          Cash reconciles — deposits {formatUSD(r.deposited)} − buys{" "}
          {formatUSD(r.spentOnBuys)} + sells {formatUSD(r.fromSells)} ={" "}
          {formatUSD(r.expectedBalance)} (balance {formatUSD(r.actualBalance)}).
        </span>
      </div>
    );
  }

  // Failed guard: surface the numbers, never a (possibly wrong) PnL silently.
  return (
    <div className="border-destructive/30 bg-destructive/5 flex items-start gap-3 rounded-lg border p-4 text-sm">
      <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        <p className="text-destructive font-medium">
          Cash does not reconcile — figures may be unreliable
        </p>
        <p className="text-muted-foreground">
          Expected balance {formatUSD(r.expectedBalance)} (deposits{" "}
          {formatUSD(r.deposited)} − buys {formatUSD(r.spentOnBuys)} + sells{" "}
          {formatUSD(r.fromSells)}) vs actual {formatUSD(r.actualBalance)} — off
          by{" "}
          <span className="text-destructive font-semibold tabular-nums">
            {formatUSD(r.difference)}
          </span>
          . Re-sync the wallet; the transfer parse may be incomplete.
        </p>
      </div>
    </div>
  );
}

function FirstRunEmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <Wallet className="text-muted-foreground size-10" />
        <div className="space-y-1">
          <p className="text-lg font-semibold">
            Let&apos;s build your portfolio
          </p>
          <p className="text-muted-foreground mx-auto max-w-md text-sm">
            Add holdings or sync a wallet, and this screen comes alive — value,
            allocation, history, and projections.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/holdings"
            className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
          >
            Add holdings
          </Link>
          <Link
            href="/wallet"
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
          >
            Sync a wallet
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
