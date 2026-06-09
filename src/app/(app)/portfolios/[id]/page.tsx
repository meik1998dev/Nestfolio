/**
 * Per-portfolio detail (EN3.x). Scopes value, allocation, PnL, and transactions
 * down to one portfolio node and everything nested under it.
 * Server Component: `getPortfolioDetail` assembles the data; small client charts
 * (reused from the dashboard) render it.
 */
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Coins,
  PieChart as PieIcon,
  ArrowLeftRight,
  LineChart as LineChartIcon,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HeroValueSkeleton,
  StatCardsSkeleton,
  ChartCardSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import { AssetLink } from "@/components/asset-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SortableTable } from "@/components/sortable-table";
import { Badge } from "@/components/ui/badge";
import { formatUSD, formatQty, formatDate, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPortfolioDetail } from "@/lib/portfolio/detail";
import {
  getPortfolioPerformance,
  getTimeframePnl,
} from "@/lib/insights/performance";
import { parsePerfRange } from "@/lib/insights/performance.types";
import type { TimeframePnl } from "@/lib/pnl/timeframe.types";
import { resolveToken } from "@/lib/price/ticker";
import { PerformanceChart } from "@/components/performance-chart";
import { PnlStatTabs } from "@/components/pnl-stat-tabs";
import { TargetAllocationPie } from "./allocation";
import { TargetInput } from "./target-input";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const detail = await getPortfolioDetail(id);
  if (!detail) return { title: "Portfolio" };
  return {
    title: detail.name,
    description: `${detail.name} — value, allocation, and PnL.`,
  };
}

/**
 * Synchronous shell: paints the always-visible "Portfolios" back-link instantly
 * (it depends on no data) above a <Suspense> boundary. The PageHeader title and
 * the full body depend on the fetched detail, so they live inside the async
 * child and stream in behind the skeleton. params/searchParams flow down as
 * un-awaited promises so the shell never suspends.
 */
export default function PortfolioDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  return (
    <>
      <div className="mb-2">
        <Link
          href="/portfolios"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Portfolios
        </Link>
      </div>

      <Suspense fallback={<PortfolioDetailSkeleton />}>
        <PortfolioDetailContent params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** Fallback mirroring the streamed body: header line, hero, PnL tabs, charts, tables. */
function PortfolioDetailSkeleton() {
  return (
    <>
      {/* PageHeader title line */}
      <Skeleton className="mb-6 h-9 w-64" />
      <div className="space-y-6">
        <HeroValueSkeleton />
        {/* PnlStatTabs: Return % / Total / Realized / Unrealized */}
        <StatCardsSkeleton count={4} columns={4} />
        <ChartCardSkeleton /> {/* Performance */}
        <ChartCardSkeleton /> {/* Allocation */}
        <TableSkeleton columns={6} /> {/* Holdings */}
        <TableSkeleton columns={6} /> {/* Transactions */}
      </div>
    </>
  );
}

/** All data fetching + the full detail body. Streamed behind Suspense. */
async function PortfolioDetailContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { id } = await params;
  const detail = await getPortfolioDetail(id);
  if (!detail) notFound();

  // Scope the performance curve to the tickers the PnL rollup covers (incl.
  // fully-closed positions, so realized P&L ties out), unioned with currently-
  // held tickers (in case a holding has no cost-basis row yet).
  const range = parsePerfRange((await searchParams).range);
  const tickers = new Set<string>(detail.pnlTickers);
  for (const h of detail.holdings) {
    const t = resolveToken(h.holding.asset).ticker;
    if (t) tickers.add(t.toUpperCase());
  }
  const [performance, windowed] = await Promise.all([
    getPortfolioPerformance(range, { tickers, benchmark: true }),
    getTimeframePnl({ tickers }),
  ]);

  // "All" is the authoritative scoped rollup (ties to the headline); the rest are
  // period deltas from the ledger replay, scoped to this portfolio's tickers.
  const timeframes: TimeframePnl[] = [
    {
      timeframe: "all",
      realized: detail.pnl.realized,
      unrealized: detail.pnl.unrealized,
      total: detail.pnl.total,
      partial: detail.pnl.hasMissingPrices,
    },
    ...windowed,
  ];

  return (
    <>
      <PageHeader
        title={detail.name}
        description="Value, allocation, PnL, and trades for this portfolio and everything nested under it."
      />

      <div className="space-y-6">
        {/* Hero value */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Portfolio value</CardDescription>
            <CardTitle className="text-4xl tabular-nums sm:text-5xl">
              {formatUSD(detail.totalValue)}
            </CardTitle>
          </CardHeader>
          {detail.hasMissingPrices && (
            <CardContent>
              <p className="text-muted-foreground text-xs">
                Some holdings have no live price yet and are valued at $0.
              </p>
            </CardContent>
          )}
        </Card>

        {/* PnL by timeframe: Return % / Total / Realized / Unrealized with tabs */}
        <PnlStatTabs data={timeframes} investedCapital={detail.pnl.costBasis} />

        {/* Performance & P&L over time */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LineChartIcon className="text-muted-foreground size-4" />
              Performance
            </CardTitle>
            <CardDescription>
              Value, P&amp;L, and return over time — with an optional S&amp;P
              500 benchmark.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {performance.empty ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                No priceable trade history for this portfolio yet.
              </p>
            ) : (
              <PerformanceChart
                series={performance.series}
                range={range}
                basePath={`/portfolios/${id}`}
              />
            )}
          </CardContent>
        </Card>

        {/* Allocation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PieIcon className="text-muted-foreground size-4" />
              Allocation
            </CardTitle>
            <CardDescription>
              Live allocation (inner ring) vs target (outer ring).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TargetAllocationPie slices={detail.allocation} />
          </CardContent>
        </Card>

        {/* Holdings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="text-muted-foreground size-4" />
              Holdings
            </CardTitle>
            <CardDescription>
              Positions in this portfolio and its sub-portfolios.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.holdings.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                No holdings assigned here yet.
              </p>
            ) : (
              <SortableTable
                initialSort={{ key: "value", dir: "desc" }}
                columns={[
                  { key: "asset", header: "Asset" },
                  {
                    key: "amount",
                    header: "Amount",
                    align: "right",
                    sortable: true,
                  },
                  {
                    key: "value",
                    header: "Value",
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
                    key: "total",
                    header: "Total P&L",
                    align: "right",
                    sortable: true,
                  },
                  {
                    key: "target",
                    header: "Target",
                    align: "right",
                    headClassName: "w-28",
                  },
                ]}
                rows={detail.holdings.map((h) => ({
                  key: h.holding.id,
                  sort: {
                    amount: h.holding.amount,
                    value: h.value,
                    unrealized: h.pnl?.unrealizedPnl ?? null,
                    total: h.pnl?.totalPnl ?? null,
                  },
                  cells: {
                    asset: (
                      <span className="font-medium">
                        <AssetLink symbol={h.holding.asset} />
                      </span>
                    ),
                    amount: (
                      <span className="tabular-nums">
                        {formatQty(h.holding.amount)}
                      </span>
                    ),
                    value: (
                      <span className="tabular-nums">{formatUSD(h.value)}</span>
                    ),
                    unrealized: (
                      <span
                        className={cn(
                          "tabular-nums",
                          h.pnl?.unrealizedPnl != null &&
                            pnlColor(h.pnl.unrealizedPnl),
                        )}
                      >
                        {h.pnl?.unrealizedPnl != null
                          ? formatUSD(h.pnl.unrealizedPnl, { signed: true })
                          : "—"}
                      </span>
                    ),
                    total: (
                      <span
                        className={cn(
                          "tabular-nums",
                          h.pnl?.totalPnl != null && pnlColor(h.pnl.totalPnl),
                        )}
                      >
                        {h.pnl?.totalPnl != null
                          ? formatUSD(h.pnl.totalPnl, { signed: true })
                          : "—"}
                      </span>
                    ),
                    target: (
                      <TargetInput
                        holdingId={h.holding.id}
                        target={h.holding.target_pct}
                      />
                    ),
                  },
                }))}
              />
            )}
          </CardContent>
        </Card>

        {/* Transactions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="text-muted-foreground size-4" />
              Transactions
            </CardTitle>
            <CardDescription>
              Trades touching assets held in this portfolio. Newest first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.transactions.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                No trades for these assets yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.transactions.map((tx) => (
                    <TableRow key={`${tx.source}-${tx.id}`}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(tx.date)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            tx.type === "buy" || tx.type === "delivery"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {tx.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        <AssetLink symbol={tx.asset} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(tx.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {tx.value !== null ? formatUSD(tx.value) : "—"}
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground text-xs">
                          {tx.source === "wallet" ? "Wallet" : "Manual"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
