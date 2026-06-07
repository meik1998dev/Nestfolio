import {
  CircleCheck,
  AlertTriangle,
  TrendingUp,
  LineChart as LineIcon,
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
import { AssetLink } from "@/components/asset-link";
import { PerformanceChart } from "@/components/performance-chart";
import { formatUSD, formatQty, pnlColor } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getPnl, type PnlView } from "@/lib/pnl/pnl";
import {
  getPortfolioPerformance,
  getTimeframePnl,
  parsePerfRange,
  type PerformanceView,
} from "@/lib/insights/performance";
import type { TimeframePnl } from "@/lib/pnl/timeframe.types";
import { PnlTimeframeCards } from "./pnl-timeframe-cards";
import { RecomputeButton } from "./recompute-button";

export default async function PnlPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { range } = await searchParams;
  const [view, performance, windowed] = await Promise.all([
    getPnl(user!.id),
    getPortfolioPerformance(parsePerfRange(range)),
    getTimeframePnl(),
  ]);

  // "All" is the authoritative cumulative rollup (cost_basis); the windowed
  // figures are period deltas from the ledger replay.
  const timeframes: TimeframePnl[] = [
    {
      timeframe: "all",
      realized: view.rollup.realized,
      unrealized: view.rollup.unrealized,
      total: view.rollup.total,
      partial: view.rollup.hasMissingPrices,
    },
    ...windowed,
  ];

  return (
    <>
      <PageHeader
        title="Profit & Loss"
        description="Realized, unrealized, and total PnL per holding. Tokenized stocks are valued by their underlying equity price, never the on-chain DEX price."
      >
        <RecomputeButton />
      </PageHeader>

      {view.empty ? (
        <EmptyState />
      ) : (
        <>
          <ReconciliationBanner view={view} />
          <PnlTimeframeCards data={timeframes} />
          <PerformanceCard performance={performance} />
          <HoldingsTable view={view} />
        </>
      )}
    </>
  );
}

function PerformanceCard({ performance }: { performance: PerformanceView }) {
  if (performance.empty) return null;
  return (
    <Card className="mb-6">
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
        <PerformanceChart
          series={performance.series}
          range={performance.range}
          basePath="/pnl"
        />
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">Avg cost</TableHead>
              <TableHead className="text-right">Cost basis</TableHead>
              <TableHead className="text-right">Live price</TableHead>
              <TableHead className="text-right">Market value</TableHead>
              <TableHead className="text-right">Unrealized</TableHead>
              <TableHead className="text-right">Realized</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.holdings.map((h) => (
              <TableRow key={h.ticker}>
                <TableCell className="font-medium">
                  <AssetLink symbol={h.ticker} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQty(h.shares)}
                </TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {h.shares > 0 ? formatUSD(h.avgCost) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatUSD(h.costBasis)}
                </TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {h.livePrice !== null ? formatUSD(h.livePrice) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {h.marketValue !== null ? formatUSD(h.marketValue) : "—"}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${h.unrealizedPnl !== null ? pnlColor(h.unrealizedPnl) : ""}`}
                >
                  {h.unrealizedPnl !== null
                    ? formatUSD(h.unrealizedPnl, { signed: true })
                    : "—"}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums ${pnlColor(h.realizedPnl)}`}
                >
                  {formatUSD(h.realizedPnl, { signed: true })}
                </TableCell>
                <TableCell
                  className={`text-right font-medium tabular-nums ${h.totalPnl !== null ? pnlColor(h.totalPnl) : ""}`}
                >
                  {h.totalPnl !== null
                    ? formatUSD(h.totalPnl, { signed: true })
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ReconciliationBanner({ view }: { view: PnlView }) {
  const r = view.reconciliation;
  if (!r) return null;

  if (r.pass) {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-emerald-600/30 bg-emerald-600/5 p-3 text-sm">
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
    <div className="border-destructive/30 bg-destructive/5 mb-6 flex items-start gap-3 rounded-lg border p-4 text-sm">
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

function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <TrendingUp className="text-muted-foreground size-8" />
        <div className="space-y-1">
          <p className="font-medium">No PnL yet</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            Sync a wallet on the Wallet page, then hit “Recompute” here to build
            your cost basis and see realized / unrealized PnL per holding.
          </p>
        </div>
        <Badge variant="secondary">
          Average-cost · historical delivery pricing
        </Badge>
      </CardContent>
    </Card>
  );
}
