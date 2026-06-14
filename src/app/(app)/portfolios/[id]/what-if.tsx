"use client";

import { useMemo, useState } from "react";
import { Calculator, RotateCcw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InfoTip } from "@/components/info-tip";
import { formatUSD, formatRatioPct, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Portfolio what-if scenario — purely client-side. A portfolio holds many assets,
 * so there's no single price to type; instead the investor sets one portfolio-wide
 * % move (slider or input) applied uniformly to every priceable holding. We then
 * recompute the projected value, the change, and the resulting unrealized P&L and
 * total return. No persistence — a scratchpad, nothing touches the ledger or DB.
 *
 * Math mirrors the per-asset card at the rollup level. `openCostBasis` is derived
 * as `currentValue − unrealized` so the projected unrealized stays internally
 * consistent, and `Return %` divides total P&L by `costBasis` (invested capital),
 * matching the P&L tabs above.
 */
export function PortfolioWhatIf({
  currentValue,
  unrealized,
  realized,
  costBasis,
  hasMissingPrices,
}: {
  /** Current portfolio value at live prices — the move scales this. */
  currentValue: number;
  /** Current unrealized P&L over priceable open positions. */
  unrealized: number;
  /** Realized P&L (unaffected by the hypothetical move). */
  realized: number;
  /** Invested capital — the base for Return %. */
  costBasis: number;
  /** True when some holding has no live price (totals are partial). */
  hasMissingPrices: boolean;
}) {
  // The portfolio-wide move, in percent (e.g. 15 → +15%).
  const [pct, setPct] = useState<number>(0);

  const { projValue, changeAbs, projUnrealized, projReturn } = useMemo(() => {
    const m = (Number.isFinite(pct) ? pct : 0) / 100;
    const projValue = currentValue * (1 + m);
    const changeAbs = currentValue * m;
    const openCostBasis = currentValue - unrealized;
    const projUnrealized = projValue - openCostBasis;
    const projTotal = realized + projUnrealized;
    const projReturn = costBasis > 1e-6 ? projTotal / costBasis : null;
    return { projValue, changeAbs, projUnrealized, projReturn };
  }, [pct, currentValue, unrealized, realized, costBasis]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="text-muted-foreground size-4" />
          What-if scenario
        </CardTitle>
        <CardDescription>
          Move the whole portfolio up or down by a percentage to see the
          resulting value and P&amp;L. Applied evenly to every priceable
          holding. Nothing is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {currentValue > 0 ? (
          <>
            <div className="space-y-3">
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="portfolio-whatif-move">Portfolio move</Label>
                  <div className="relative">
                    <Input
                      id="portfolio-whatif-move"
                      type="number"
                      step="any"
                      value={Number.isFinite(pct) ? pct : ""}
                      onChange={(e) => setPct(parseFloat(e.target.value))}
                      className="pr-7 tabular-nums"
                    />
                    <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                      %
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Reset to no change"
                  onClick={() => setPct(0)}
                >
                  <RotateCcw className="size-4" />
                </Button>
              </div>

              <input
                type="range"
                min={-100}
                max={200}
                step={1}
                value={Math.min(
                  200,
                  Math.max(-100, Number.isFinite(pct) ? pct : 0),
                )}
                onChange={(e) => setPct(parseFloat(e.target.value))}
                className="accent-primary h-1.5 w-full cursor-pointer"
                aria-label="Portfolio move slider"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Projected
                label="Projected value"
                tip="What the whole portfolio would be worth after the move: current value × (1 + move%)."
                value={formatUSD(projValue)}
              />
              <Projected
                label="Change"
                tip="Dollar change in portfolio value from the move, relative to its current live value."
                value={formatUSD(changeAbs, { signed: true })}
                valueClass={pnlColor(changeAbs)}
              />
              <Projected
                label="Unrealized P&L"
                tip="Paper gain or loss at the projected prices: projected value − cost basis of currently-held positions. Not booked until you sell."
                value={formatUSD(projUnrealized, { signed: true })}
                valueClass={pnlColor(projUnrealized)}
              />
              <Projected
                label="Return"
                tip="Total P&L (realized + projected unrealized) as a percentage of invested capital — same basis as the P&L tabs above."
                value={
                  projReturn != null
                    ? formatRatioPct(projReturn, { signed: true })
                    : "—"
                }
                valueClass={projReturn != null ? pnlColor(projReturn) : ""}
              />
            </div>

            {hasMissingPrices && (
              <p className="text-muted-foreground text-xs">
                Some holdings have no live price yet and are valued at $0, so
                they don&apos;t move in this scenario.
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            No priceable holdings yet — add holdings to project value and
            P&amp;L.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Projected({
  label,
  tip,
  value,
  valueClass,
}: {
  label: string;
  tip: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <span>{label}</span>
        <InfoTip>{tip}</InfoTip>
      </div>
      <p
        className={cn("mt-0.5 text-xl font-semibold tabular-nums", valueClass)}
      >
        {value}
      </p>
    </div>
  );
}
