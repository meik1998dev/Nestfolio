import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Wallet,
  Sparkles,
  LineChart as LineIcon,
  ArrowLeftRight,
  TriangleAlert,
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
import { formatUSD, formatQty, formatDate, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getAssetDetail, parseRange } from "@/lib/asset/detail";
import { AssetChart } from "./asset-chart";

const TYPE_BADGE: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
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

/** "—" for null P&L (no live price), else a signed USD figure. */
function pnl(value: number | null): string {
  return value == null ? "—" : formatUSD(value, { signed: true });
}

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ asset: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { asset } = await params;
  const { range } = await searchParams;
  const detail = await getAssetDetail(
    decodeURIComponent(asset),
    parseRange(range),
  );
  if (!detail) notFound();

  const heldLabel =
    detail.amountHeld > 0
      ? `${formatQty(detail.amountHeld)} held`
      : "No current position";

  return (
    <>
      <PageHeader
        title={detail.displayName}
        description={`${detail.symbol} · ${detail.kind} · ${heldLabel}`}
      >
        <Link
          href="/holdings"
          className="text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4" />
          Holdings
        </Link>
      </PageHeader>

      <div className="space-y-6">
        {detail.kind === "unknown" && (
          <div className="border-border bg-muted/40 text-muted-foreground flex items-start gap-2 rounded-lg border p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              <span className="text-foreground font-medium">
                {detail.symbol}
              </span>{" "}
              isn&apos;t recognized by the price feed, so it can&apos;t be valued,
              charted, or have P&amp;L. This is usually an airdropped or spam token.
              If it&apos;s a real asset, re-add the holding under its market ticker
              (e.g. <span className="font-medium">AAPL</span>).
            </p>
          </div>
        )}

        {/* P&L stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
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
              detail.pnlKnown && detail.total != null ? pnlColor(detail.total) : ""
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
              value={detail.livePrice != null ? formatUSD(detail.livePrice) : "—"}
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
              symbol={detail.symbol}
              series={detail.series}
              range={detail.range}
              hasPrice={detail.hasPrice}
              pnlKnown={detail.pnlKnown}
            />
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
