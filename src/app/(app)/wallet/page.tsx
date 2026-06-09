import { Suspense } from "react";
import {
  Wallet as WalletIcon,
  AlertTriangle,
  CircleCheck,
  Clock,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { CardSkeleton, TableSkeleton } from "@/components/skeletons";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SortableTable } from "@/components/sortable-table";
import { Badge } from "@/components/ui/badge";
import { AssetLink } from "@/components/asset-link";
import { formatUSD, formatQty, formatDate } from "@/lib/format";
import type { SyncStatus } from "@/lib/types";
import {
  getWallet,
  getSyncedBalances,
  type WalletBalanceView,
} from "@/lib/wallet/wallets";
import { WalletForm } from "./wallet-form";
import { SyncButton } from "./sync-button";

const STATUS: Record<
  SyncStatus,
  {
    label: string;
    variant: "secondary" | "default" | "destructive" | "outline";
    icon: typeof Clock;
  }
> = {
  idle: { label: "Not synced yet", variant: "secondary", icon: Clock },
  syncing: { label: "Syncing…", variant: "outline", icon: Clock },
  synced: { label: "Synced", variant: "default", icon: CircleCheck },
  degraded: { label: "Degraded", variant: "destructive", icon: AlertTriangle },
  error: { label: "Error", variant: "destructive", icon: AlertTriangle },
};

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wallet",
  description: "On-chain wallet sync — balances and transaction import.",
};

/**
 * Synchronous shell: paints the static chrome (PageHeader) instantly without
 * awaiting any slow data. The header's "Sync now" action (which only shows once
 * a wallet exists) and the whole data-driven body each stream in behind their
 * own <Suspense> boundary.
 *
 * `getWallet` is request-cached, so the header SyncButton loader and the body
 * content below collapse to a single DB read.
 */
export default function WalletPage() {
  return (
    <>
      <PageHeader
        title="Wallet"
        description="Read-only sync of a public BNB-chain address via Moralis. Synced tokens land in the Unassigned bucket — assign them in Portfolios."
      >
        <Suspense fallback={<Skeleton className="h-9 w-24" />}>
          <SyncButtonLoader />
        </Suspense>
      </PageHeader>

      <Suspense fallback={<WalletSkeleton />}>
        <WalletContent />
      </Suspense>
    </>
  );
}

/** Shows the Sync button only once a wallet address has been saved. */
async function SyncButtonLoader() {
  const wallet = await getWallet();
  return wallet ? <SyncButton /> : null;
}

/** Fallback mirroring the streamed body: address card + balances table. */
function WalletSkeleton() {
  return (
    <>
      <CardSkeleton className="mb-6" descriptionLines={2} bodyHeight="h-10" />
      {/* Balances: Token, Resolves to, Amount, Price, USD value */}
      <TableSkeleton columns={5} />
    </>
  );
}

/** All wallet data fetching + the data-driven Cards. Streamed behind Suspense. */
async function WalletContent() {
  const wallet = await getWallet();
  const balances = wallet ? await getSyncedBalances(wallet.address) : [];

  const total = balances.reduce((sum, b) => sum + (b.usdValue ?? 0), 0);
  const status = wallet ? STATUS[wallet.sync_status] : null;
  const degraded =
    wallet?.sync_status === "degraded" || wallet?.sync_status === "error";

  return (
    <>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <WalletIcon className="text-muted-foreground size-4" />
            BNB address
          </CardTitle>
          <CardDescription>
            Paste your public address. Sync is read-only — no signature
            required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <WalletForm currentAddress={wallet?.address} />

          {wallet && status && (
            <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-sm">
              <Badge variant={status.variant} className="gap-1">
                <status.icon className="size-3" />
                {status.label}
              </Badge>
              {wallet.last_synced_at && (
                <span className="text-muted-foreground">
                  Last synced {formatDate(wallet.last_synced_at)}
                </span>
              )}
              {wallet.last_synced_block !== null && (
                <span className="text-muted-foreground tabular-nums">
                  Block {wallet.last_synced_block.toLocaleString()}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {degraded && (
        <div className="border-destructive/30 bg-destructive/5 mb-6 flex items-start gap-3 rounded-lg border p-4 text-sm">
          <AlertTriangle className="text-destructive mt-0.5 size-4 shrink-0" />
          <div>
            <p className="text-destructive font-medium">
              Last sync didn’t complete
            </p>
            <p className="text-muted-foreground">
              Showing your last-known balances below. Try “Sync now” again —
              your stored data is untouched.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <div className="space-y-1.5">
            <CardTitle>Synced balances</CardTitle>
            <CardDescription>
              Valued at last-known live prices. Tokenized stocks (…on) are
              priced by their underlying equity, never the on-chain DEX price.
            </CardDescription>
          </div>
          {balances.length > 0 && (
            <div className="text-right">
              <p className="text-muted-foreground text-xs">Total value</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatUSD(total)}
              </p>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!wallet ? (
            <EmptyState
              title="No wallet yet"
              body="Save a public BNB address above to sync your balances automatically."
            />
          ) : balances.length === 0 ? (
            <EmptyState
              title="No balances synced yet"
              body="Hit “Sync now” to pull your BNB and BEP20 token balances."
            />
          ) : (
            <SortableTable
              initialSort={{ key: "usdValue", dir: "desc" }}
              columns={[
                { key: "token", header: "Token" },
                { key: "resolves", header: "Resolves to" },
                {
                  key: "amount",
                  header: "Amount",
                  align: "right",
                  sortable: true,
                },
                {
                  key: "price",
                  header: "Price",
                  align: "right",
                  sortable: true,
                },
                {
                  key: "usdValue",
                  header: "USD value",
                  align: "right",
                  sortable: true,
                },
              ]}
              rows={balances.map((b) => ({
                key: b.asset,
                sort: {
                  amount: b.amount,
                  price: b.unitPrice,
                  usdValue: b.usdValue,
                },
                cells: {
                  token: (
                    <span className="font-medium">
                      <AssetLink symbol={b.asset} />
                    </span>
                  ),
                  resolves: <ResolvesBadge b={b} />,
                  amount: (
                    <span className="tabular-nums">{formatQty(b.amount)}</span>
                  ),
                  price: (
                    <span className="text-muted-foreground tabular-nums">
                      {b.unitPrice !== null ? formatUSD(b.unitPrice) : "—"}
                    </span>
                  ),
                  usdValue: (
                    <span className="tabular-nums">
                      {b.usdValue !== null ? formatUSD(b.usdValue) : "—"}
                    </span>
                  ),
                },
              }))}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ResolvesBadge({ b }: { b: WalletBalanceView }) {
  return b.kind === "stock" ? (
    <Badge variant="outline">{b.ticker} · equity</Badge>
  ) : b.kind === "stablecoin" ? (
    <Badge variant="secondary">cash $1</Badge>
  ) : b.ticker ? (
    <Badge variant="secondary">{b.ticker}</Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      unmapped
    </Badge>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground max-w-sm text-sm">{body}</p>
    </div>
  );
}
