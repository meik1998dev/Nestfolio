import { Coins } from "lucide-react";
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
import { formatUSD, formatQty } from "@/lib/format";
import { listHoldings, deleteHolding } from "@/lib/ledger/holdings";
import { getLivePricesForHoldings } from "@/lib/portfolio/prices";
import { computeHoldingValues } from "@/lib/portfolio/valuation";
import { HoldingForm } from "./holding-form";
import { DeleteButton } from "@/components/delete-button";
import { AssetLink } from "@/components/asset-link";

export default async function HoldingsPage() {
  const holdings = await listHoldings();
  // Live USD value per holding (manual + wallet), priced from the API.
  const prices = await getLivePricesForHoldings(holdings);
  const holdingValues = computeHoldingValues(holdings, prices);
  const holdingsTotal = holdings.reduce(
    (sum, h) => sum + (holdingValues.get(h.id) ?? 0),
    0,
  );

  return (
    <>
      <PageHeader
        title="Holdings"
        description="The assets you own — added manually or synced from your wallet. Priced live from market data."
      >
        <HoldingForm />
      </PageHeader>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Coins className="text-muted-foreground size-4" />
              Positions
            </CardTitle>
            <CardDescription>
              {holdings.length > 0 ? (
                <span className="text-foreground font-medium tabular-nums">
                  Total {formatUSD(holdingsTotal)}.
                </span>
              ) : (
                "Add a manual position or sync a wallet."
              )}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {holdings.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="font-medium">No holdings yet</p>
              <p className="text-muted-foreground max-w-sm text-sm">
                Add a manual position — units of an asset like BTC, gold, or
                shares — or sync a wallet.
              </p>
              <HoldingForm />
            </div>
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
                        <AssetLink symbol={holding.asset} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            holding.source === "wallet"
                              ? "outline"
                              : "secondary"
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
