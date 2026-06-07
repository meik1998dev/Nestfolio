/**
 * Net Worth command center (F5 — S5.1/S5.3/S5.4/S5.5/S5.6). The landing screen.
 *
 * Server Component: assembles every input through the shared aggregation
 * (`getNetWorthSummary`), the snapshot history, the monthly review, and PnL, then
 * hands data to small client charts. Degrades gracefully — empty accounts/prices
 * never blank the page; missing snapshots show a friendly history empty state.
 */
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Landmark,
  Scale,
  PieChart as PieIcon,
  LineChart as LineIcon,
  Sparkles,
  CalendarClock,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
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
import { Badge } from "@/components/ui/badge";
import { formatUSD, formatRatioPct, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  getNetWorthSummary,
  readLiabilities,
} from "@/lib/insights/networth.server";
import { listSnapshots } from "@/lib/insights/snapshot";
import { getMonthlyReview } from "@/lib/insights/review.server";
import { deleteLiability } from "@/lib/insights/liabilities";
import { getPnl } from "@/lib/pnl/pnl";
import { createClient } from "@/lib/supabase/server";
import { AllocationPie, AssetLiabilityBars, NetWorthHistory } from "./charts";
import { ProjectionPanel } from "./projection";
import { SnapshotButton } from "./snapshot-button";
import { LiabilityForm } from "./liability-form";
import { DeleteButton } from "../accounts/delete-button";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user!.id;

  const [summary, snapshots, liabilities, review, pnl] = await Promise.all([
    getNetWorthSummary(),
    listSnapshots(),
    readLiabilities(),
    getMonthlyReview(userId),
    getPnl(userId),
  ]);

  const hasData =
    summary.totalAssets > 0 ||
    summary.liabilities > 0 ||
    liabilities.length > 0;

  return (
    <>
      <PageHeader
        title="Net Worth"
        description="Everything you own, minus what you owe — at a glance."
      >
        <SnapshotButton variant="outline" label="Snapshot" />
      </PageHeader>

      {!hasData ? (
        <FirstRunEmptyState />
      ) : (
        <div className="space-y-6">
          {/* Hero: net worth + MoM */}
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total net worth</CardDescription>
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
              icon={<Wallet className="size-4" />}
              label="Total assets"
              value={formatUSD(summary.totalAssets)}
            />
            <StatCard
              icon={<Scale className="size-4" />}
              label="Liabilities"
              value={formatUSD(summary.liabilities)}
            />
            <StatCard
              icon={<Landmark className="size-4" />}
              label="Cash"
              value={formatUSD(summary.cash)}
              sub={`${formatUSD(summary.holdingsValue)} invested`}
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
              value={formatUSD(pnl.rollup.total)}
              valueClass={pnlColor(pnl.rollup.total)}
            />
          </div>

          {/* Bars + Pie */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Scale className="text-muted-foreground size-4" />
                  Assets vs liabilities
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AssetLiabilityBars
                  assets={summary.totalAssets}
                  liabilities={summary.liabilities}
                />
              </CardContent>
            </Card>
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
          </div>

          {/* History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LineIcon className="text-muted-foreground size-4" />
                Net-worth history
              </CardTitle>
              <CardDescription>
                Builds up as daily snapshots accrue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {snapshots.length >= 2 ? (
                <NetWorthHistory series={snapshots} />
              ) : (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="font-medium">History is just getting started</p>
                  <p className="text-muted-foreground max-w-sm text-sm">
                    Your net-worth line builds as snapshots accrue (one is taken
                    automatically each day). Take the first one now.
                  </p>
                  <SnapshotButton />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Projection + Monthly review */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="text-muted-foreground size-4" />
                  Where you&apos;re headed
                </CardTitle>
                <CardDescription>
                  Projected net worth at your savings rate.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProjectionPanel startingNetWorth={summary.netWorth} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="text-muted-foreground size-4" />
                  This month
                </CardTitle>
                <CardDescription>What moved your net worth.</CardDescription>
              </CardHeader>
              <CardContent>
                <MonthlyReviewBody review={review} />
              </CardContent>
            </Card>
          </div>

          {/* Liabilities */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="space-y-1.5">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Scale className="text-muted-foreground size-4" />
                  Liabilities
                </CardTitle>
                <CardDescription>
                  Debts that reduce your net worth.
                </CardDescription>
              </div>
              <LiabilityForm />
            </CardHeader>
            <CardContent>
              {liabilities.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No liabilities tracked. Add a loan or credit card so your net
                  worth reflects what you truly own.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liabilities.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.name}</TableCell>
                        <TableCell>
                          {l.type ? (
                            <Badge variant="secondary">{l.type}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-red-600 tabular-nums dark:text-red-500">
                          {formatUSD(Number(l.balance))}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end">
                            <LiabilityForm liability={l} />
                            <DeleteButton
                              id={l.id}
                              action={deleteLiability}
                              label={`Delete ${l.name}`}
                              successMessage="Liability deleted"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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

function MonthlyReviewBody({
  review,
}: {
  review: Awaited<ReturnType<typeof getMonthlyReview>>;
}) {
  return (
    <div className="space-y-4">
      {review.insufficient ? (
        <p className="text-muted-foreground text-sm">
          A full review needs a snapshot from a month ago. Income and gains
          appear once history builds.
        </p>
      ) : (
        <div className="flex items-baseline justify-between">
          <span className="text-muted-foreground text-sm">
            Net worth change
          </span>
          <span
            className={cn(
              "text-lg font-semibold tabular-nums",
              pnlColor(review.netWorthChange),
            )}
          >
            {formatUSD(review.netWorthChange, { signed: true })}
          </span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <ReviewStat
          label="Income added"
          value={formatUSD(review.incomeAdded)}
        />
        <ReviewStat
          label="Investment gains"
          value={formatUSD(review.investmentGains, { signed: true })}
          valueClass={pnlColor(review.investmentGains)}
        />
      </dl>

      <div className="grid grid-cols-2 gap-3">
        <WinnerLoser
          kind="winner"
          ticker={review.winner?.ticker ?? null}
          pnl={review.winner?.totalPnl ?? null}
        />
        <WinnerLoser
          kind="loser"
          ticker={review.loser?.ticker ?? null}
          pnl={review.loser?.totalPnl ?? null}
        />
      </div>
    </div>
  );
}

function ReviewStat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("font-medium tabular-nums", valueClass)}>{value}</dd>
    </div>
  );
}

function WinnerLoser({
  kind,
  ticker,
  pnl,
}: {
  kind: "winner" | "loser";
  ticker: string | null;
  pnl: number | null;
}) {
  const isWinner = kind === "winner";
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        {isWinner ? (
          <TrendingUp className="size-3.5" />
        ) : (
          <TrendingDown className="size-3.5" />
        )}
        {isWinner ? "Biggest winner" : "Biggest loser"}
      </p>
      {ticker ? (
        <>
          <p className="font-medium">{ticker}</p>
          <p className={cn("text-sm tabular-nums", pnlColor(pnl ?? 0))}>
            {formatUSD(pnl ?? 0, { signed: true })}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground text-sm">—</p>
      )}
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
            Let&apos;s build your net worth
          </p>
          <p className="text-muted-foreground mx-auto max-w-md text-sm">
            Add accounts and holdings, or sync a wallet, and this screen comes
            alive — net worth, allocation, history, and projections.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <a
            href="/accounts"
            className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
          >
            Add accounts
          </a>
          <a
            href="/wallet"
            className="inline-flex h-9 items-center rounded-md border px-4 text-sm font-medium"
          >
            Sync a wallet
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
