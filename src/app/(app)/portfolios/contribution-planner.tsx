"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Wallet, Copy, ArrowDown, ArrowUp } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/info-tip";
import { formatUSD, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  planContribution,
  type ContribInputNode,
  type ContributionEntry,
} from "@/lib/portfolio/contribution";

const PRESETS = [250, 500, 1000];

/**
 * Monthly contribution planner — purely client-side, no persistence.
 *
 * The investor types one figure (this month's deposit) and the card shows how
 * many dollars to add to each sub-portfolio to move the whole tree toward its
 * targets *without selling*. The split mirrors the rebalance engine but only
 * ever tops up underweight buckets; overweight ones wait until next month.
 *
 * All math lives in `planContribution` (pure, unit-tested); this component just
 * owns the amount/rounding state and renders. Nothing touches the ledger or DB.
 */
export function ContributionPlanner({
  nodes,
  grandTotal,
}: {
  /** Serializable portfolio forest with rolled-up values and targets. */
  nodes: ContribInputNode[];
  /** Σ of every root's value — used to scale the slider range. */
  grandTotal: number;
}) {
  const [amount, setAmount] = useState<number>(0);
  const [round, setRound] = useState<boolean>(true);

  const plan = useMemo(
    () => planContribution(nodes, amount, { round: round ? 1 : undefined }),
    [nodes, amount, round],
  );

  // Slider tops out at a round number near 20% of the pot (min $2k) so the
  // common monthly deposit sits comfortably mid-track.
  const sliderMax = useMemo(() => {
    const target = Math.max(2000, grandTotal * 0.2);
    const mag = Math.pow(10, Math.floor(Math.log10(target)));
    return Math.ceil(target / mag) * mag;
  }, [grandTotal]);

  const safeAmount = Number.isFinite(amount) ? amount : 0;

  function copyPlan() {
    const lines = plan.entries
      .filter((e) => e.add > 0)
      .map((e) => `${"  ".repeat(e.depth)}${e.name}: ${formatUSD(e.add)}`);
    const text =
      `Invest this month: ${formatUSD(plan.contribution)}\n\n` +
      (lines.length ? lines.join("\n") : "Nothing to add — already on target.");
    navigator.clipboard.writeText(text).then(
      () => toast.success("Plan copied to clipboard"),
      () => toast.error("Couldn't copy plan"),
    );
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="text-muted-foreground size-4" />
          Monthly contribution
        </CardTitle>
        <CardDescription>
          Enter what you&apos;re investing this month — see how many dollars to
          add to each sub-portfolio to move toward your targets. Never suggests
          selling; overweight buckets just wait. Nothing is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {plan.noTargets ? (
          <p className="text-muted-foreground text-sm">
            Set a target % on your portfolios (edit a node) to plan
            contributions. Siblings should sum to 100%.
          </p>
        ) : (
          <>
            {/* Amount input + presets + rounding toggle */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="contribution-amount">Invest this month</Label>
                  <div className="relative">
                    <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                      $
                    </span>
                    <Input
                      id="contribution-amount"
                      type="number"
                      min={0}
                      step="any"
                      inputMode="decimal"
                      value={Number.isFinite(amount) ? amount : ""}
                      onChange={(e) => setAmount(parseFloat(e.target.value))}
                      className="pl-6 tabular-nums"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESETS.map((p) => (
                    <Button
                      key={p}
                      variant={safeAmount === p ? "default" : "outline"}
                      size="sm"
                      onClick={() => setAmount(p)}
                    >
                      {formatUSD(p, { compact: true })}
                    </Button>
                  ))}
                  <Button
                    variant={round ? "default" : "outline"}
                    size="sm"
                    aria-pressed={round}
                    onClick={() => setRound((r) => !r)}
                    title="Round each add to whole dollars"
                  >
                    Round $
                  </Button>
                </div>
              </div>

              <input
                type="range"
                min={0}
                max={sliderMax}
                step={50}
                value={Math.min(sliderMax, Math.max(0, safeAmount))}
                onChange={(e) => setAmount(parseFloat(e.target.value))}
                className="accent-primary h-1.5 w-full cursor-pointer"
                aria-label="Contribution amount slider"
              />
            </div>

            {safeAmount > 0 ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sub-portfolio</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1">
                          Now
                          <InfoTip>
                            Current share of its parent, with a drift arrow when
                            it&apos;s off target.
                          </InfoTip>
                        </span>
                      </TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead className="text-right">Add</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1">
                          After
                          <InfoTip>
                            Projected share of its parent once this month&apos;s
                            money lands.
                          </InfoTip>
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plan.entries.map((e) => (
                      <PlanRow key={e.id} entry={e} />
                    ))}
                  </TableBody>
                </Table>

                {/* Footer: total + shortfall + copy */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                  <p className="text-sm">
                    <span className="text-muted-foreground">Allocating </span>
                    <span className="font-semibold tabular-nums">
                      {formatUSD(plan.totalAllocated)}
                    </span>
                    {plan.fullyFunds ? (
                      <span className="text-emerald-600 dark:text-emerald-500">
                        {" "}
                        — fully funds your underweight buckets ✓
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {" "}
                        — still {formatUSD(plan.topLevelShortfall)} short of full
                        target
                      </span>
                    )}
                  </p>
                  <Button variant="outline" size="sm" onClick={copyPlan}>
                    <Copy className="size-4" />
                    Copy plan
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Enter an amount above to see the split.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One table row — indented by depth, drift arrow on "Now", add highlighted. */
function PlanRow({ entry: e }: { entry: ContributionEntry }) {
  return (
    <TableRow>
      <TableCell>
        <span
          className="font-medium"
          style={{ paddingLeft: `${e.depth * 1.25}rem` }}
        >
          {e.depth > 0 && <span className="text-muted-foreground">└ </span>}
          {e.name}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span className="inline-flex items-center justify-end gap-1">
          {e.nowPct != null ? formatPct(e.nowPct) : "—"}
          <DriftArrow drift={e.driftPct} />
        </span>
      </TableCell>
      <TableCell className="text-muted-foreground text-right tabular-nums">
        {e.targetPct != null ? formatPct(e.targetPct) : "—"}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-medium tabular-nums",
          e.add > 0
            ? "text-emerald-600 dark:text-emerald-500"
            : "text-muted-foreground",
        )}
      >
        {e.add > 0 ? `+${formatUSD(e.add)}` : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {e.afterPct != null ? formatPct(e.afterPct) : "—"}
      </TableCell>
    </TableRow>
  );
}

/** Up arrow = overweight (red), down = underweight (amber). Hidden near target. */
function DriftArrow({ drift }: { drift: number | null }) {
  if (drift == null || Math.abs(drift) < 0.5) return null;
  return drift > 0 ? (
    <ArrowUp className="size-3 text-red-600 dark:text-red-500" aria-label="over target" />
  ) : (
    <ArrowDown
      className="size-3 text-amber-600 dark:text-amber-500"
      aria-label="under target"
    />
  );
}
