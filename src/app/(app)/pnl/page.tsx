import { CircleCheck, AlertTriangle, TrendingUp } from "lucide-react";
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
import { formatUSD, formatQty, pnlColor } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getPnl, type PnlView } from "@/lib/pnl/pnl";
import { RecomputeButton } from "./recompute-button";

export default async function PnlPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const view = await getPnl(user!.id);

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
          <HeadlineCards view={view} />
          <HoldingsTable view={view} />
        </>
      )}
    </>
  );
}

function HeadlineCards({ view }: { view: PnlView }) {
  const { realized, unrealized, total, hasMissingPrices } = view.rollup;
  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <MetricCard
        label="Realized PnL"
        value={realized}
        hint="Locked-in gains from disposals."
      />
      <MetricCard
        label="Unrealized PnL"
        value={unrealized}
        hint={
          hasMissingPrices
            ? "Paper gains at live prices — some prices unavailable."
            : "Paper gains on open positions at live prices."
        }
      />
      <MetricCard
        label="Total PnL"
        value={total}
        hint="Realized + unrealized."
        emphasize
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: number;
  hint: string;
  emphasize?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={`tabular-nums ${emphasize ? "text-3xl" : "text-2xl"} ${pnlColor(value)}`}
        >
          {formatUSD(value, { signed: true })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-xs">{hint}</p>
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
                <TableCell className="font-medium">{h.ticker}</TableCell>
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
          by {formatUSD(r.difference)}. Re-sync the wallet; the transfer parse
          may be incomplete.
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
