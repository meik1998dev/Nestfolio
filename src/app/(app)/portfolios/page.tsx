import { Suspense } from "react";
import Link from "next/link";
import { FolderTree, Scale, Inbox, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { HeroValueSkeleton, TableSkeleton } from "@/components/skeletons";
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
import { SortableTable } from "@/components/sortable-table";
import { Badge } from "@/components/ui/badge";
import { AssetLink } from "@/components/asset-link";
import { formatUSD, formatPct, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listPortfolios, deletePortfolio } from "@/lib/portfolio/portfolios";
import { listHoldings } from "@/lib/ledger/holdings";
import { getLivePricesForHoldings } from "@/lib/portfolio/prices";
import {
  computeHoldingValues,
  excludeDisplaySpam,
  hasPrice,
} from "@/lib/portfolio/valuation";
import {
  buildPortfolioTree,
  rollupValues,
  flattenTree,
  totalAssignedValue,
} from "@/lib/portfolio/tree";
import { rebalanceTree } from "@/lib/portfolio/rebalance";
import { PortfolioForm } from "./portfolio-form";
import { EditPortfolioButton } from "./edit-portfolio";
import { DeleteButton } from "@/components/delete-button";
import { AssignSelect } from "./assign-select";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Portfolios",
  description: "Organize holdings into portfolios and track targets.",
};

/**
 * Synchronous shell: paints the static chrome (PageHeader) instantly without
 * awaiting any slow data. The header's "New portfolio" action and the whole
 * data-driven body each stream in behind their own <Suspense> boundary.
 *
 * The header form needs the portfolio list (for its parent-picker), so we can't
 * keep it fully static — instead we give it a tiny dedicated Suspense with a
 * button-sized fallback so the rest of the header (title/description) still
 * paints immediately. `listPortfolios` is request-cached, so the form loader and
 * the body content below collapse to a single DB read.
 */
export default function PortfoliosPage() {
  return (
    <>
      <PageHeader
        title="Portfolios"
        description="Group holdings into nested portfolios, set target allocations, and rebalance."
      >
        <Suspense fallback={<Skeleton className="h-9 w-36" />}>
          <PortfolioFormLoader />
        </Suspense>
      </PageHeader>

      <Suspense fallback={<PortfoliosSkeleton />}>
        <PortfoliosContent />
      </Suspense>
    </>
  );
}

/** Loads the portfolio list for the header's create-form parent picker. */
async function PortfolioFormLoader() {
  const portfolios = await listPortfolios();
  return <PortfolioForm portfolios={portfolios} />;
}

/** Fallback mirroring the streamed body: hero value + tree table + unassigned. */
function PortfoliosSkeleton() {
  return (
    <>
      <HeroValueSkeleton className="mb-6" />
      {/* Tree: Portfolio, Target %, % of parent, Value, actions */}
      <TableSkeleton columns={5} />
      {/* Unassigned holdings: Asset, Source, Value, Assign to */}
      <TableSkeleton columns={4} className="mt-6" />
    </>
  );
}

/** All portfolio data fetching + the data-driven Cards. Streamed behind Suspense. */
async function PortfoliosContent() {
  const [portfolios, allHoldings] = await Promise.all([
    listPortfolios(),
    listHoldings(),
  ]);
  // Hide unpriceable airdrop spam from the tree/allocation (ledger row stays).
  const holdings = excludeDisplaySpam(allHoldings);
  const prices = await getLivePricesForHoldings(holdings);

  const holdingValues = computeHoldingValues(holdings, prices);
  const roots = rollupValues(
    buildPortfolioTree(portfolios, holdings),
    holdingValues,
  );
  const flat = flattenTree(roots);
  const grandTotal = totalAssignedValue(roots);
  const levels = rebalanceTree(roots);

  const unassigned = holdings.filter((h) => !h.portfolio_id);
  const anyTargets = portfolios.some((p) => p.target_pct != null);

  return (
    <>
      {portfolios.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardDescription>Total allocated value</CardDescription>
            <CardTitle className="text-3xl tabular-nums">
              {formatUSD(grandTotal)}
            </CardTitle>
            {prices.size === 0 && (
              <p className="text-muted-foreground text-xs">
                No live prices yet — values populate once price syncing runs.
              </p>
            )}
          </CardHeader>
        </Card>
      )}

      {/* --- Tree ---------------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderTree className="text-muted-foreground size-4" />
            Portfolio tree
          </CardTitle>
          <CardDescription>
            Rolled-up value per node. Target % is relative to the parent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {flat.length === 0 ? (
            <EmptyState
              title="No portfolios yet"
              body="Create your first portfolio — nest sub-portfolios to any depth (e.g. Stocks → NVDA / MSFT)."
              action={<PortfolioForm portfolios={portfolios} />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Portfolio</TableHead>
                  <TableHead className="text-right">Target %</TableHead>
                  <TableHead className="text-right">% of parent</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {flat.map((node) => {
                  const parentValue =
                    node.parentId == null
                      ? grandTotal
                      : (flat.find((n) => n.id === node.parentId)?.totalValue ??
                        0);
                  const pctOfParent =
                    parentValue > 0
                      ? (node.totalValue / parentValue) * 100
                      : null;
                  const portfolio = portfolios.find((p) => p.id === node.id)!;
                  return (
                    <TableRow key={node.id}>
                      <TableCell>
                        <span
                          className="font-medium"
                          style={{ paddingLeft: `${node.depth * 1.25}rem` }}
                        >
                          {node.depth > 0 && (
                            <span className="text-muted-foreground">└ </span>
                          )}
                          <Link
                            href={`/portfolios/${node.id}`}
                            className="hover:underline"
                          >
                            {node.name}
                          </Link>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {node.targetPct != null
                          ? formatPct(node.targetPct)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {pctOfParent != null ? formatPct(pctOfParent) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatUSD(node.totalValue)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <EditPortfolioButton
                            portfolio={portfolio}
                            portfolios={portfolios}
                          />
                          <DeleteButton
                            id={node.id}
                            action={deletePortfolio}
                            label={`Delete ${node.name}`}
                            successMessage="Portfolio deleted"
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* --- Rebalance ---------------------------------------------------- */}
      {levels.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Scale className="text-muted-foreground size-4" />
              Rebalance
            </CardTitle>
            <CardDescription>
              Per level: target vs actual, drift, and the exact trade to hit
              your policy.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {!anyTargets ? (
              <p className="text-muted-foreground text-sm">
                Set a target % on portfolios (edit a node) to see rebalancing
                advice. Siblings should sum to 100%.
              </p>
            ) : (
              levels
                .filter((l) => l.targetedChildren > 0)
                .map((level) => (
                  <div
                    key={level.parentId ?? "__total__"}
                    className="space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">
                        {level.parentName}
                        <span className="text-muted-foreground ml-2 font-normal tabular-nums">
                          {formatUSD(level.parentValue)}
                        </span>
                      </h3>
                      {!level.targetsValid && (
                        <Badge variant="destructive" className="gap-1">
                          <TriangleAlert className="size-3" />
                          Targets sum to {formatPct(level.targetSum)} (should be
                          100%)
                        </Badge>
                      )}
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Holding / sub-portfolio</TableHead>
                          <TableHead className="text-right">Target</TableHead>
                          <TableHead className="text-right">Actual</TableHead>
                          <TableHead className="text-right">Drift</TableHead>
                          <TableHead className="text-right">
                            Suggestion
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {level.children.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium">
                              {c.name}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-right tabular-nums">
                              {c.targetPct != null
                                ? formatPct(c.targetPct)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {c.actualPct != null
                                ? formatPct(c.actualPct)
                                : "—"}
                            </TableCell>
                            <TableCell
                              className={cn(
                                "text-right tabular-nums",
                                c.driftPct != null && pnlColor(c.driftPct),
                              )}
                            >
                              {c.driftPct != null
                                ? formatPct(c.driftPct, { signed: true })
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <TradeSuggestion entry={c} />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))
            )}
          </CardContent>
        </Card>
      )}

      {/* --- Unassigned holdings ----------------------------------------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="text-muted-foreground size-4" />
            Unassigned holdings
          </CardTitle>
          <CardDescription>
            Holdings not yet in a portfolio. Assign each to slot it into your
            allocation — works for manual and wallet-synced positions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {unassigned.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              Every holding is assigned to a portfolio.
            </p>
          ) : (
            <SortableTable
              initialSort={{ key: "value", dir: "desc" }}
              columns={[
                { key: "asset", header: "Asset" },
                { key: "source", header: "Source" },
                {
                  key: "value",
                  header: "Value",
                  align: "right",
                  sortable: true,
                },
                { key: "assign", header: "Assign to", headClassName: "w-56" },
              ]}
              rows={unassigned.map((h) => {
                const priced = hasPrice(h, prices);
                return {
                  key: h.id,
                  sort: {
                    value: priced ? (holdingValues.get(h.id) ?? 0) : null,
                  },
                  cells: {
                    asset: (
                      <span className="font-medium">
                        <AssetLink symbol={h.asset} />
                      </span>
                    ),
                    source: (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant={
                            h.source === "wallet" ? "outline" : "secondary"
                          }
                        >
                          {h.source === "wallet" ? "Wallet" : "Manual"}
                        </Badge>
                        {h.wallet_ref && (
                          <span className="text-muted-foreground font-mono text-xs">
                            {shortRef(h.wallet_ref)}
                          </span>
                        )}
                      </div>
                    ),
                    value: priced ? (
                      <span className="tabular-nums">
                        {formatUSD(holdingValues.get(h.id) ?? 0)}
                      </span>
                    ) : (
                      <Badge variant="ghost" className="text-muted-foreground">
                        no price
                      </Badge>
                    ),
                    assign: (
                      <AssignSelect
                        holdingId={h.id}
                        portfolios={portfolios}
                        currentPortfolioId={null}
                      />
                    ),
                  },
                };
              })}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function TradeSuggestion({
  entry,
}: {
  entry: ReturnType<typeof rebalanceTree>[number]["children"][number];
}) {
  if (entry.action === "hold" || entry.deltaUSD == null) {
    return <Badge variant="secondary">Hold</Badge>;
  }
  const amount = Math.abs(entry.deltaUSD);
  const isBuy = entry.action === "buy";
  return (
    <span
      className={cn(
        "font-medium tabular-nums",
        isBuy
          ? "text-emerald-600 dark:text-emerald-500"
          : "text-red-600 dark:text-red-500",
      )}
    >
      {isBuy ? "Buy" : "Sell"} {formatUSD(amount)} {entry.name}
    </span>
  );
}

/** Shorten a wallet ref / address for display (0x1234…abcd). */
function shortRef(ref: string): string {
  if (ref.length <= 12) return ref;
  return `${ref.slice(0, 6)}…${ref.slice(-4)}`;
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
