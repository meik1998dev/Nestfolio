import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Wallet,
  Sparkles,
  LineChart as LineIcon,
  ArrowLeftRight,
  TriangleAlert,
  Percent,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  CardSkeleton,
  ChartCardSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  formatUSD,
  formatQty,
  formatDate,
  formatRatioPct,
  pnlColor,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAssetDetail, parseRange } from "@/lib/asset/detail";
import type { AssetTrade } from "@/lib/asset/types";
import { getNetWorthSummary } from "@/lib/insights/networth.server";
import { getTimeframePnl } from "@/lib/insights/performance";
import type { TimeframePnl } from "@/lib/pnl/timeframe.types";
import { PnlStatTabs } from "@/components/pnl-stat-tabs";
import { AssetChart } from "./asset-chart";
import { WhatIf } from "./what-if";
import { DecisionMetrics } from "./decision-metrics";
import { PositionPlanner } from "./position-planner";

const TYPE_BADGE: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
  }
> = {
  buy: { label: "Buy", variant: "default" },
  sell: { label: "Sell", variant: "secondary" },
  delivery: { label: "Delivery", variant: "outline" },
  send: { label: "Send", variant: "outline" },
  deposit: { label: "Deposit", variant: "outline" },
};

function badge(type: string) {
  return TYPE_BADGE[type] ?? { label: type, variant: "outline" as const };
}

function directionColor(type: string): string {
  if (type === "buy" || type === "deposit" || type === "delivery")
    return "text-emerald-600 dark:text-emerald-500";
  if (type === "sell" || type === "send")
    return "text-red-600 dark:text-red-500";
  return "";
}

/**
 * Collapse the asset's already-fetched trade ledger into chart markers: one per
 * (date, side) bucket, with quantities summed. Only buy/sell legs become markers
 * (1-leg wallet moves like delivery/send aren't trades). Reuses `detail.transactions`
 * — no extra DB reads. `qty` is the summed leg amount, omitted only when that sum
 * is non-positive; `price` is the quantity-weighted average over the priced legs
 * (so it may cover fewer units than `qty` when some legs had no price).
 */
function deriveTrades(
  transactions: {
    date: string;
    type: string;
    amount: number;
    price: number | null;
  }[],
): AssetTrade[] {
  const buckets = new Map<
    string,
    { qty: number; cost: number; pricedQty: number }
  >();
  for (const tx of transactions) {
    const side = tx.type === "buy" ? "buy" : tx.type === "sell" ? "sell" : null;
    if (!side) continue;
    const key = `${tx.date.slice(0, 10)}|${side}`;
    const b = buckets.get(key) ?? { qty: 0, cost: 0, pricedQty: 0 };
    b.qty += tx.amount;
    if (tx.price != null) {
      b.cost += tx.price * tx.amount;
      b.pricedQty += tx.amount;
    }
    buckets.set(key, b);
  }
  return [...buckets.entries()].map(([key, b]) => {
    const [date, side] = key.split("|") as [string, "buy" | "sell"];
    return {
      date,
      side,
      qty: b.qty > 0 ? b.qty : undefined,
      price: b.pricedQty > 0 ? b.cost / b.pricedQty : undefined,
    };
  });
}

/** "—" for null P&L (no live price), else a signed USD figure. */
function pnl(value: number | null): string {
  return value == null ? "—" : formatUSD(value, { signed: true });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ asset: string }>;
}): Promise<Metadata> {
  const { asset } = await params;
  const symbol = decodeURIComponent(asset).toUpperCase();
  return { title: symbol, description: `${symbol} position, trades, and PnL.` };
}

/**
 * Instant chrome + streamed body: the page shell is synchronous so Next can
 * flush the page scaffold immediately — the "Holdings" back-link stays visible
 * on first load and on client navigation (mirroring portfolios/[id]). The
 * PageHeader title/description depend on the fetched `detail`, so the header
 * itself plus the whole body stream in behind a `<Suspense>` boundary. The
 * `params`/`searchParams` promises are passed down un-awaited so the shell never
 * suspends; `AssetContent` awaits them.
 */
export default function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ asset: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  return (
    <>
      {/* Instant chrome: always-visible back-link, hoisted above Suspense. */}
      <div className="mb-2">
        <Link
          href="/holdings"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Holdings
        </Link>
      </div>

      <Suspense fallback={<AssetSkeleton />}>
        <AssetContent params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** Streamed body: fetches the asset detail and renders the header + full body. */
async function AssetContent({
  params,
  searchParams,
}: {
  params: Promise<{ asset: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { asset } = await params;
  const { range } = await searchParams;
  // Original-cased symbol from the URL — range links must reuse it verbatim.
  // Tokenized stocks only resolve with their exact casing (e.g. "NVDAon"; the
  // `on` suffix must stay lower-case), so linking by the uppercased display
  // symbol would 404 into the "unknown" state.
  const assetParam = decodeURIComponent(asset);
  const detail = await getAssetDetail(assetParam, parseRange(range));
  if (!detail) notFound();

  // Net worth powers the concentration metric (this position as a % of total).
  const { netWorth } = await getNetWorthSummary();

  // Timeframe P&L scoped to this one asset's pricing ticker. Only meaningful when
  // the position is priceable and fully valued (else fall back to static cards).
  const showTabs =
    detail.pnlKnown &&
    detail.ticker != null &&
    detail.unrealized != null &&
    detail.total != null;
  const windowed = showTabs
    ? await getTimeframePnl({
        tickers: new Set([detail.ticker!.toUpperCase()]),
      })
    : [];
  const timeframes: TimeframePnl[] = showTabs
    ? [
        {
          timeframe: "all",
          realized: detail.realized,
          unrealized: detail.unrealized!,
          total: detail.total!,
          partial: false,
        },
        ...windowed,
      ]
    : [];

  // Buy/sell markers for the Price-view chart, derived from the already-loaded
  // ledger (no extra DB reads). Empty when the asset has no buy/sell trades.
  const trades = deriveTrades(detail.transactions);

  const heldLabel =
    detail.amountHeld > 0
      ? `${formatQty(detail.amountHeld)} held`
      : "No current position";

  return (
    <>
      <PageHeader
        title={detail.displayName}
        description={`${detail.symbol} · ${detail.kind} · ${heldLabel}`}
      />

      <div className="space-y-6">
        {detail.kind === "unknown" && (
          <div className="border-border bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-lg border p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="text-foreground font-medium">
                {detail.symbol}
              </span>{" "}
              isn&apos;t recognized by the price feed, so it can&apos;t be
              valued, charted, or have P&amp;L. This is usually an airdropped or
              spam token. If it&apos;s a real asset, re-add the holding under
              its market ticker (e.g. <span className="font-medium">AAPL</span>
              ).
            </p>
          </div>
        )}

        {/* P&L by timeframe (Return % / Total / Realized / Unrealized) with tabs;
            falls back to static cards when the asset isn't priceable. */}
        {showTabs ? (
          <PnlStatTabs data={timeframes} investedCapital={detail.costBasis} />
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              icon={<Percent className="size-4" />}
              label="Return"
              value={
                detail.pnlKnown &&
                detail.total != null &&
                detail.costBasis > 1e-6
                  ? formatRatioPct(detail.total / detail.costBasis, {
                      signed: true,
                    })
                  : "—"
              }
              valueClass={
                detail.pnlKnown && detail.total != null
                  ? pnlColor(detail.total)
                  : ""
              }
            />
            <StatCard
              icon={
                (detail.total ?? 0) >= 0 ? (
                  <TrendingUp className="size-4" />
                ) : (
                  <TrendingDown className="size-4" />
                )
              }
              label="Total P&L"
              value={detail.pnlKnown ? pnl(detail.total) : "—"}
              valueClass={
                detail.pnlKnown && detail.total != null
                  ? pnlColor(detail.total)
                  : ""
              }
            />
            <StatCard
              icon={<Wallet className="size-4" />}
              label="Realized P&L"
              value={
                detail.pnlKnown
                  ? formatUSD(detail.realized, { signed: true })
                  : "—"
              }
              valueClass={detail.pnlKnown ? pnlColor(detail.realized) : ""}
            />
            <StatCard
              icon={<Sparkles className="size-4" />}
              label="Unrealized P&L"
              value={detail.pnlKnown ? pnl(detail.unrealized) : "—"}
              valueClass={
                detail.pnlKnown && detail.unrealized != null
                  ? pnlColor(detail.unrealized)
                  : ""
              }
            />
          </div>
        )}

        {/* Position summary */}
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4">
            <Metric label="Amount held" value={formatQty(detail.amountHeld)} />
            <Metric
              label="Avg cost"
              value={detail.avgCost > 0 ? formatUSD(detail.avgCost) : "—"}
            />
            <Metric
              label="Live price"
              value={
                detail.livePrice != null ? formatUSD(detail.livePrice) : "—"
              }
            />
            <Metric
              label="Market value"
              value={
                detail.marketValue != null ? formatUSD(detail.marketValue) : "—"
              }
            />
          </CardContent>
        </Card>

        {/* Price + P&L chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LineIcon className="text-muted-foreground size-4" />
              Performance
            </CardTitle>
            <CardDescription>
              Price and profit/loss over time. Daily closes — pick a range.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssetChart
              linkSymbol={assetParam}
              series={detail.series}
              range={detail.range}
              hasPrice={detail.hasPrice}
              pnlKnown={detail.pnlKnown}
              rangeChanges={detail.rangeChanges}
              trades={trades}
            />
          </CardContent>
        </Card>

        {/* Decision metrics */}
        {detail.kind !== "unknown" && (
          <DecisionMetrics
            amountHeld={detail.amountHeld}
            avgCost={detail.avgCost}
            livePrice={detail.livePrice}
            marketValue={detail.marketValue}
            costBasis={detail.costBasis}
            pnlKnown={detail.pnlKnown}
            metrics={detail.metrics}
            netWorth={netWorth}
          />
        )}

        {/* What-if price calculator */}
        {detail.kind !== "unknown" && (
          <WhatIf
            symbol={detail.symbol}
            amountHeld={detail.amountHeld}
            avgCost={detail.avgCost}
            livePrice={detail.livePrice}
            netWorth={netWorth}
            currentValue={detail.marketValue}
          />
        )}

        {/* Position planner — trade simulator + stop-loss/take-profit */}
        {detail.kind !== "unknown" && (
          <PositionPlanner
            symbol={detail.symbol}
            amountHeld={detail.amountHeld}
            avgCost={detail.avgCost}
            livePrice={detail.livePrice}
          />
        )}

        {/* Transactions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="text-muted-foreground size-4" />
              Transactions
            </CardTitle>
            <CardDescription>
              Every trade touching {detail.symbol}, newest first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {detail.transactions.length === 0 ? (
              <div className="text-muted-foreground py-8 text-center text-sm">
                No trades recorded for this asset.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Price</TableHead>
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
                        <Badge variant={badge(tx.type).variant}>
                          {badge(tx.type).label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(tx.amount)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {tx.price !== null ? formatUSD(tx.price) : "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${directionColor(tx.type)}`}
                      >
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

/**
 * Suspense fallback for the streamed body: a header title-line skeleton, the
 * P&L stat grid (matching the static `grid-cols-2 lg:grid-cols-3` fallback), the
 * position-summary Card, the Performance chart Card, and the transactions table.
 */
function AssetSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header area (title from `detail.displayName` + description line). */}
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <StatCardsSkeleton count={3} columns={3} breakpoint="lg" />
      <CardSkeleton title={false} descriptionLines={0} bodyHeight="h-16" />
      <ChartCardSkeleton />
      <TableSkeleton columns={6} />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
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
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
