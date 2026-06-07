import { ArrowRight, ArrowLeftRight } from "lucide-react";
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
import { formatUSD, formatDate } from "@/lib/format";
import type { TransactionType } from "@/lib/types";
import { listAccounts } from "@/lib/ledger/accounts";
import { listTransactions, deleteTransaction } from "@/lib/ledger/transactions";
import { expenseByCategory, totalExpenses } from "@/lib/ledger/balances";
import { TransactionForm } from "./transaction-form";
import { DeleteButton } from "../accounts/delete-button";

const TYPE_BADGE: Record<
  TransactionType,
  {
    label: string;
    variant: "default" | "secondary" | "outline" | "destructive";
  }
> = {
  income: { label: "Income", variant: "default" },
  buy: { label: "Buy", variant: "secondary" },
  sell: { label: "Sell", variant: "secondary" },
  transfer: { label: "Transfer", variant: "outline" },
  expense: { label: "Expense", variant: "destructive" },
};

export default async function TransactionsPage() {
  const [accounts, transactions] = await Promise.all([
    listAccounts(),
    listTransactions(),
  ]);

  const accountName = new Map(accounts.map((a) => [a.id, a.name]));
  const label = (id: string | null) =>
    id ? (accountName.get(id) ?? "Deleted account") : "External";

  // This-month expense breakdown for the summary panel.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const breakdown = expenseByCategory(transactions, thisMonth);
  const monthTotal = totalExpenses(transactions, thisMonth);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Your ledger. Every entry moves value between accounts."
      >
        <TransactionForm accounts={accounts} />
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="text-muted-foreground size-4" />
              Ledger
            </CardTitle>
            <CardDescription>Newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="font-medium">No transactions yet</p>
                <p className="text-muted-foreground max-w-sm text-sm">
                  {accounts.length === 0
                    ? "Add an account first, then log your first transaction."
                    : "Log income, a purchase, a transfer, or an expense to get started."}
                </p>
                {accounts.length > 0 && <TransactionForm accounts={accounts} />}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Movement</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((tx) => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(tx.date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={TYPE_BADGE[tx.type].variant}>
                          {TYPE_BADGE[tx.type].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <span>{label(tx.source_account)}</span>
                          <ArrowRight className="text-muted-foreground size-3" />
                          <span>{label(tx.dest_account)}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {tx.category ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-40 truncate">
                        {tx.note ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatUSD(tx.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DeleteButton
                          id={tx.id}
                          action={deleteTransaction}
                          label="Delete transaction"
                          successMessage="Transaction deleted"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardDescription>Expenses this month</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {formatUSD(monthTotal)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {breakdown.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No expenses logged this month.
              </p>
            ) : (
              <ul className="space-y-2">
                {breakdown.map((entry) => (
                  <li
                    key={entry.category}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">
                      {entry.category}
                    </span>
                    <span className="tabular-nums">
                      {formatUSD(entry.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
