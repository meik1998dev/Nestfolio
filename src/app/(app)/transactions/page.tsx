import { ArrowLeftRight } from "lucide-react";
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
import { formatUSD, formatQty, formatDate } from "@/lib/format";
import {
  listTransactions,
  listWalletTrades,
  deleteTransaction,
  type TradeRow,
} from "@/lib/ledger/transactions";
import { TransactionForm } from "./transaction-form";
import { DeleteButton } from "@/components/delete-button";
import { AssetLink } from "@/components/asset-link";

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

/** Trade direction tint: acquisitions green, disposals red, transfers neutral. */
function directionColor(type: string): string {
  if (type === "buy" || type === "deposit" || type === "delivery")
    return "text-emerald-600 dark:text-emerald-500";
  if (type === "sell" || type === "send")
    return "text-red-600 dark:text-red-500";
  return "";
}

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Transactions",
  description: "Full trade and transfer history across your portfolios.",
};

export default async function TransactionsPage() {
  const [manual, wallet] = await Promise.all([
    listTransactions(),
    listWalletTrades(),
  ]);

  // Merge manual trades + wallet-synced trades into one chronological history.
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const manualRows: TradeRow[] = manual.map((t) => {
    const qty = num(t.amount) ?? 0;
    const price = num(t.price);
    return {
      id: t.id,
      date: t.date,
      type: t.type,
      asset: t.asset || "—",
      amount: qty,
      price,
      value: price !== null ? price * qty : null,
      source: "manual",
      note: t.note,
    };
  });
  const trades = [...manualRows, ...wallet].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );

  // Distinct asset symbols already seen — feeds the Log-trade autocomplete.
  const assetOptions = Array.from(
    new Set(
      trades
        .map((t) => t.asset)
        .filter((a): a is string => Boolean(a) && a !== "—"),
    ),
  ).sort();

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Your asset trading history. Log trades by hand or sync them from your wallet."
      >
        <TransactionForm assets={assetOptions} />
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="text-muted-foreground size-4" />
            Trade history
          </CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {trades.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="font-medium">No trades yet</p>
              <p className="text-muted-foreground max-w-sm text-sm">
                Log a buy or sell, or sync your wallet to pull trades
                automatically.
              </p>
              <TransactionForm assets={assetOptions} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.map((tx) => (
                  <TableRow key={`${tx.source}-${tx.id}`}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(tx.date)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge(tx.type).variant}>
                        {badge(tx.type).label}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">
                      {tx.asset && tx.asset !== "—" ? (
                        <AssetLink symbol={tx.asset} />
                      ) : (
                        tx.asset
                      )}
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
                    <TableCell className="text-right">
                      {tx.source === "manual" && (
                        <DeleteButton
                          id={tx.id}
                          action={deleteTransaction}
                          label="Delete trade"
                          successMessage="Trade deleted"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
