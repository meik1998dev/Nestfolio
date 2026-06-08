"use client";

import { useState } from "react";
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
import { formatUSD, formatPct, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * What-if price calculator — purely client-side. The user types (or drags) a
 * hypothetical price; we recompute the unrealized P&L, total return %, and
 * projected market value against their average cost. No persistence — this is a
 * scratchpad, so nothing here touches the ledger or the DB.
 */
export function WhatIf({
  symbol,
  amountHeld,
  avgCost,
  livePrice,
}: {
  symbol: string;
  amountHeld: number;
  avgCost: number;
  livePrice: number | null;
}) {
  // Anchor the initial scenario on the live price, falling back to avg cost.
  const anchor = livePrice ?? (avgCost > 0 ? avgCost : 1);
  const [price, setPrice] = useState<number>(round2(anchor));

  // Slider spans 0 → 3× the anchor so big moves are reachable by drag.
  const sliderMax = round2(Math.max(anchor * 3, avgCost * 3, 1));

  const costBasis = avgCost * amountHeld;
  const marketValue = price * amountHeld;
  const unrealized = marketValue - costBasis;
  const returnPct = costBasis > 0 ? (unrealized / costBasis) * 100 : null;
  const vsLive = livePrice != null ? ((price - livePrice) / livePrice) * 100 : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="text-muted-foreground size-4" />
          What-if price
        </CardTitle>
        <CardDescription>
          Set a hypothetical price to see the resulting P&amp;L on your{" "}
          {symbol} position. Nothing is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="whatif-price">Hypothetical price</Label>
              <div className="relative">
                <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                  $
                </span>
                <Input
                  id="whatif-price"
                  type="number"
                  min={0}
                  step="any"
                  value={Number.isFinite(price) ? price : ""}
                  onChange={(e) => setPrice(parseFloat(e.target.value))}
                  className="pl-7 tabular-nums"
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Reset to live price"
              onClick={() => setPrice(round2(anchor))}
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>

          <input
            type="range"
            min={0}
            max={sliderMax}
            step={sliderMax / 200}
            value={Math.min(Number.isFinite(price) ? price : 0, sliderMax)}
            onChange={(e) => setPrice(round2(parseFloat(e.target.value)))}
            className="accent-primary h-1.5 w-full cursor-pointer"
            aria-label="Hypothetical price slider"
          />
          {vsLive != null && (
            <p className="text-muted-foreground text-xs tabular-nums">
              {formatPct(vsLive, { signed: true })} vs live{" "}
              {formatUSD(livePrice!)}
            </p>
          )}
        </div>

        {amountHeld > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Projected
              label="Unrealized P&L"
              tip="Paper gain or loss at this price: amount held × (hypothetical price − average cost). Not booked until you sell."
              value={formatUSD(unrealized, { signed: true })}
              valueClass={pnlColor(unrealized)}
            />
            <Projected
              label="Total return"
              tip="The unrealized P&L as a percentage of your cost basis — how much the position would be up or down overall."
              value={returnPct != null ? formatPct(returnPct, { signed: true }) : "—"}
              valueClass={returnPct != null ? pnlColor(returnPct) : ""}
            />
            <Projected
              label="Market value"
              tip="What your position would be worth at this price: amount held × hypothetical price."
              value={formatUSD(marketValue)}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            No current position — add a holding to project P&amp;L.
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
      <p className={cn("mt-0.5 text-xl font-semibold tabular-nums", valueClass)}>
        {value}
      </p>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
