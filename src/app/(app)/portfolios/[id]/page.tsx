/**
 * Per-portfolio detail (EN3.x). Scopes value, allocation, PnL, value history,
 * and transactions down to one portfolio node and everything nested under it.
 * Server Component: `getPortfolioDetail` assembles the data; small client charts
 * (reused from the dashboard) render it.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Coins,
  TrendingUp,
  TrendingDown,
  Wallet,
  Sparkles,
  PieChart as PieIcon,
  LineChart as LineIcon,
  ArrowLeftRight,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
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
import { Badge } from "@/components/ui/badge";
import { formatUSD, formatQty, formatDate, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPortfolioDetail } from "@/lib/portfolio/detail";
import { NetWorthHistory } from "../../dashboard/charts";
import { TargetAllocationPie } from "./allocation";
import { TargetInput } from "./target-input";

export default async function PortfolioDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getPortfolioDetail(id);
  if (!detail) notFound();

  const series = detail.history.map((h) => ({
    taken_at: h.taken_at,
    net_worth: h.value,
  }));

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

        {/* PnL stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            icon={<Coins className="size-4" />}
            label="Market value"
            value={formatUSD(detail.pnl.marketValue)}
          />
          <StatCard
            icon={
              detail.pnl.total >= 0 ? (
                <TrendingUp className="size-4" />
              ) : (
                <TrendingDown className="size-4" />
              )
            }
            label="Total P&L"
            value={formatUSD(detail.pnl.total, { signed: true })}
            valueClass={pnlColor(detail.pnl.total)}
          />
          <StatCard
            icon={<Wallet className="size-4" />}
            label="Realized P&L"
            value={formatUSD(detail.pnl.realized, { signed: true })}
            valueClass={pnlColor(detail.pnl.realized)}
          />
          <StatCard
            icon={<Sparkles className="size-4" />}
            label="Unrealized P&L"
            value={formatUSD(detail.pnl.unrealized, { signed: true })}
            valueClass={pnlColor(detail.pnl.unrealized)}
          />
        </div>

        {/* Allocation + history */}
        <div className="grid gap-4 lg:grid-cols-2">
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <LineIcon className="text-muted-foreground size-4" />
                Value history
              </CardTitle>
              <CardDescription>Builds up as daily snapshots accrue.</CardDescription>
            </CardHeader>
            <CardContent>
              {series.length >= 2 ? (
                <NetWorthHistory series={series} />
              ) : (
                <p className="text-muted-foreground py-10 text-center text-sm">
                  History builds as snapshots accrue (one is taken automatically
                  each day).
                </p>
              )}
            </CardContent>
          </Card>
        </div>

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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Unrealized</TableHead>
                    <TableHead className="text-right">Total P&L</TableHead>
                    <TableHead className="w-28 text-right">Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.holdings.map((h) => (
                    <TableRow key={h.holding.id}>
                      <TableCell className="font-medium">
                        <AssetLink symbol={h.holding.asset} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatQty(h.holding.amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUSD(h.value)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          h.pnl?.unrealizedPnl != null &&
                            pnlColor(h.pnl.unrealizedPnl),
                        )}
                      >
                        {h.pnl?.unrealizedPnl != null
                          ? formatUSD(h.pnl.unrealizedPnl, { signed: true })
                          : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          h.pnl?.totalPnl != null && pnlColor(h.pnl.totalPnl),
                        )}
                      >
                        {h.pnl?.totalPnl != null
                          ? formatUSD(h.pnl.totalPnl, { signed: true })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <TargetInput
                          holdingId={h.holding.id}
                          target={h.holding.target_pct}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums", valueClass)}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
