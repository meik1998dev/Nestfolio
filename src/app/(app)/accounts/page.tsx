import { Landmark, Coins } from "lucide-react";
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
import type { AccountType } from "@/lib/types";
import { getAccountsWithBalances, deleteAccount } from "@/lib/ledger/accounts";
import { listHoldings, deleteHolding } from "@/lib/ledger/holdings";
import { getLivePricesForHoldings } from "@/lib/portfolio/prices";
import { computeHoldingValues } from "@/lib/portfolio/valuation";
import { AccountForm } from "./account-form";
import { HoldingForm } from "./holding-form";
import { DeleteButton } from "./delete-button";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "Cash",
  crypto_wallet: "Crypto wallet",
  gold: "Gold",
  stock: "Stock",
  expense: "Expense",
  external: "External",
};

export default async function AccountsPage() {
  const [accounts, holdings] = await Promise.all([
    getAccountsWithBalances(),
    listHoldings(),
  ]);
  // Live USD value per holding (manual + wallet), priced from the API.
  const prices = await getLivePricesForHoldings(holdings);
  const holdingValues = computeHoldingValues(holdings, prices);
  const holdingsTotal = holdings.reduce(
    (sum, h) => sum + (holdingValues.get(h.id) ?? 0),
    0,
  );

  // Net cash across real accounts (the expense/external sinks aren't wealth).
  const totalCash = accounts
    .filter((a) => a.type !== "expense" && a.type !== "external")
    .reduce((sum, a) => sum + a.balance, 0);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Containers of value. Balances are derived from your transaction ledger."
      >
        <AccountForm />
      </PageHeader>

      {accounts.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardDescription>Total cash balance</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatUSD(totalCash)}
            </CardTitle>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Landmark className="text-muted-foreground size-4" />
            Accounts
          </CardTitle>
          <CardDescription>
            Cash, brokerage, wallets, and the external world.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <EmptyState
              title="No accounts yet"
              body="Add your first account to start tracking where your money lives."
              action={<AccountForm />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      {account.name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {ACCOUNT_TYPE_LABELS[account.type]}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${pnlColor(account.balance)}`}
                    >
                      {formatUSD(account.balance)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton
                        id={account.id}
                        action={deleteAccount}
                        label={`Delete ${account.name}`}
                        successMessage="Account deleted"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Coins className="text-muted-foreground size-4" />
              Holdings
            </CardTitle>
            <CardDescription>
              Manual asset positions, priced live from market data. Wallet-synced
              holdings appear here too.
              {holdings.length > 0 && (
                <span className="text-foreground ml-1 font-medium tabular-nums">
                  Total {formatUSD(holdingsTotal)}.
                </span>
              )}
            </CardDescription>
          </div>
          <HoldingForm />
        </CardHeader>
        <CardContent>
          {holdings.length === 0 ? (
            <EmptyState
              title="No holdings yet"
              body="Add a manual position — units of an asset like BTC, gold, or shares."
              action={<HoldingForm />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {holdings.map((holding) => {
                  const value = holdingValues.get(holding.id) ?? 0;
                  const priced = holding.amount > 0 ? value > 0 : true;
                  return (
                  <TableRow key={holding.id}>
                    <TableCell className="font-medium">
                      {holding.asset}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          holding.source === "wallet" ? "outline" : "secondary"
                        }
                      >
                        {holding.source === "wallet" ? "Wallet" : "Manual"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQty(holding.amount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {priced ? (
                        formatUSD(value)
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          no price
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {holding.source === "manual" && (
                        <DeleteButton
                          id={holding.id}
                          action={deleteHolding}
                          label={`Delete ${holding.asset}`}
                          successMessage="Holding deleted"
                        />
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground max-w-sm text-sm">{body}</p>
      {action}
    </div>
  );
}
