/**
 * Portfolio command center (F5 — S5.1/S5.3/S5.4/S5.5). The landing screen.
 *
 * Server Component: assembles the holdings-based net worth (`getNetWorthSummary`),
 * the snapshot history, and PnL, then hands data to small client charts. Degrades
 * gracefully — empty holdings/prices never blank the page; missing snapshots show
 * a friendly history empty state.
 */
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Coins,
  PieChart as PieIcon,
  LineChart as LineIcon,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatUSD, formatRatioPct, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getNetWorthSummary } from "@/lib/insights/networth.server";
import {
  getPortfolioPerformance,
  parsePerfRange,
} from "@/lib/insights/performance";
import { getPnl } from "@/lib/pnl/pnl";
import { createClient } from "@/lib/supabase/server";
import { PerformanceChart } from "@/components/performance-chart";
import { AllocationPie } from "./charts";
import { ProjectionPanel } from "./projection";
import { SnapshotButton } from "./snapshot-button";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const { range } = await searchParams;
  const [summary, performance, pnl] = await Promise.all([
    getNetWorthSummary(),
    getPortfolioPerformance(parsePerfRange(range)),
    getPnl(userId),
  ]);

  const hasData = summary.holdingsValue > 0 || !pnl.empty;

  return (
    <>
      <PageHeader
        title="Portfolio"
        description="Everything you hold, valued live — at a glance."
      >
        <SnapshotButton variant="outline" label="Snapshot" />
      </PageHeader>

      {!hasData ? (
        <FirstRunEmptyState />
      ) : (
        <div className="space-y-6">
          {/* Hero: portfolio value + MoM */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Portfolio value</CardDescription>
              <CardTitle className="text-4xl tabular-nums sm:text-5xl">
                {formatUSD(summary.netWorth)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summary.momChange ? (
                <p
                  className={cn(
                    "flex items-center gap-1.5 text-sm font-medium",
                    pnlColor(summary.momChange.absolute),
                  )}
                >
                  {summary.momChange.absolute >= 0 ? (
                    <ArrowUpRight className="size-4" />
                  ) : (
                    <ArrowDownRight className="size-4" />
                  )}
                  <span className="tabular-nums">
                    {formatUSD(summary.momChange.absolute, { signed: true })}
                  </span>
                  <span className="tabular-nums">
                    ({formatRatioPct(summary.momChange.pct, { signed: true })})
                  </span>
                  <span className="text-muted-foreground font-normal">
                    over the past month
                  </span>
                </p>
              ) : (
                <p className="text-muted-foreground text-sm">
                  Month-over-month change appears once you have a snapshot from
                  a month ago.
                </p>
              )}
              {summary.hasMissingPrices && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Some holdings have no live price yet and are valued at $0.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              icon={<Coins className="size-4" />}
              label="Invested"
              value={formatUSD(summary.holdingsValue)}
            />
            <StatCard
              icon={
                pnl.rollup.total >= 0 ? (
                  <TrendingUp className="size-4" />
                ) : (
                  <TrendingDown className="size-4" />
                )
              }
              label="Total P&L"
              value={formatUSD(pnl.rollup.total, { signed: true })}
              valueClass={pnlColor(pnl.rollup.total)}
            />
            <StatCard
              icon={<Wallet className="size-4" />}
              label="Realized P&L"
              value={formatUSD(pnl.rollup.realized, { signed: true })}
              valueClass={pnlColor(pnl.rollup.realized)}
            />
            <StatCard
              icon={<Sparkles className="size-4" />}
              label="Unrealized P&L"
              value={formatUSD(pnl.rollup.unrealized, { signed: true })}
              valueClass={pnlColor(pnl.rollup.unrealized)}
            />
          </div>

          {/* Allocation + Pie */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <PieIcon className="text-muted-foreground size-4" />
                  Where your money sits
                </CardTitle>
                <CardDescription>By asset class</CardDescription>
              </CardHeader>
              <CardContent>
                <AllocationPie slices={summary.breakdowns.byAssetClass} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="text-muted-foreground size-4" />
                  Where you&apos;re headed
                </CardTitle>
                <CardDescription>
                  Projected value at your savings rate.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProjectionPanel startingNetWorth={summary.netWorth} />
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
                    Log a trade or sync a wallet and your value line fills in
                    from recorded prices. Take a snapshot to start the record.
                  </p>
                  <SnapshotButton />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
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

function FirstRunEmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
        <Wallet className="text-muted-foreground size-10" />
        <div className="space-y-1">
          <p className="text-lg font-semibold">Let&apos;s build your portfolio</p>
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
