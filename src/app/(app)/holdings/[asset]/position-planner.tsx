"use client";

import { useState } from "react";
import { Wrench, Shield } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { InfoTip } from "@/components/info-tip";
import { formatUSD, formatQty, formatPct, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";

type Side = "buy" | "sell";

/**
 * Position planner — two client-side what-if tools that need no persistence:
 *  1) Trade simulator: model adding to or trimming the position and see the new
 *     average cost, break-even, and resulting P&L before you place the order.
 *  2) Stop-loss / take-profit: set exit prices and read the $ at risk, $ reward,
 *     and the risk/reward ratio measured from the current price.
 */
export function PositionPlanner({
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
  const live = livePrice ?? (avgCost > 0 ? avgCost : 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="text-muted-foreground size-4" />
          Position planner
        </CardTitle>
        <CardDescription>
          Model a trade or plan your exits for {symbol} before you act. Nothing
          is saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        <TradeSim amountHeld={amountHeld} avgCost={avgCost} live={live} />
        <Separator />
        <ExitPlanner amountHeld={amountHeld} avgCost={avgCost} live={live} />
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- Trade sim */

function TradeSim({
  amountHeld,
  avgCost,
  live,
}: {
  amountHeld: number;
  avgCost: number;
  live: number;
}) {
  const [side, setSide] = useState<Side>("buy");
  const [qty, setQty] = useState<number>(round4(amountHeld > 0 ? amountHeld * 0.1 : 1));
  const [price, setPrice] = useState<number>(round2(live));

  const q = Number.isFinite(qty) && qty > 0 ? qty : 0;
  const p = Number.isFinite(price) && price > 0 ? price : 0;
  const costBasis = avgCost * amountHeld;

  let newShares: number;
  let newAvg: number;
  let realized: number | null = null;

  if (side === "buy") {
    newShares = amountHeld + q;
    newAvg = newShares > 0 ? (costBasis + q * p) / newShares : 0;
  } else {
    const sellQty = Math.min(q, amountHeld);
    newShares = amountHeld - sellQty;
    newAvg = avgCost; // selling doesn't move the average cost of what remains
    realized = sellQty * (p - avgCost); // booked gain/loss on the sold shares
  }

  const newUnrealized = live > 0 ? newShares * (live - newAvg) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <h4 className="text-sm font-semibold">Trade simulator</h4>
        <InfoTip>
          See how buying more (dollar-cost averaging) or trimming the position
          would change your average cost, break-even, and P&L — before placing
          the order.
        </InfoTip>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Action</Label>
          <div className="bg-muted flex rounded-md p-0.5">
            <SideButton active={side === "buy"} onClick={() => setSide("buy")}>
              Buy
            </SideButton>
            <SideButton active={side === "sell"} onClick={() => setSide("sell")}>
              Sell
            </SideButton>
          </div>
        </div>
        <Field
          id="sim-qty"
          label="Quantity"
          value={qty}
          onChange={setQty}
        />
        <Field
          id="sim-price"
          label="Price"
          prefix="$"
          value={price}
          onChange={setPrice}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Out
          label="New shares"
          tip="Your position size after this trade."
          value={formatQty(newShares)}
        />
        <Out
          label="New avg cost"
          tip="Buying changes your average cost toward the trade price; selling leaves the average of the remaining shares unchanged."
          value={newShares > 0 ? formatUSD(newAvg) : "—"}
        />
        {side === "buy" ? (
          <Out
            label="New break-even"
            tip="The price your position must reach to be flat after the trade — equal to the new average cost."
            value={newShares > 0 ? formatUSD(newAvg) : "—"}
          />
        ) : (
          <Out
            label="Realized P&L"
            tip="Cash gain or loss booked on the shares you sell: quantity × (sell price − average cost)."
            value={realized != null ? formatUSD(realized, { signed: true }) : "—"}
            valueClass={realized != null ? pnlColor(realized) : undefined}
          />
        )}
        <Out
          label="Unrealized P&L"
          tip="Paper P&L of the resulting position valued at the current live price."
          value={newUnrealized != null ? formatUSD(newUnrealized, { signed: true }) : "—"}
          valueClass={newUnrealized != null ? pnlColor(newUnrealized) : undefined}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Exit planner */

function ExitPlanner({
  amountHeld,
  avgCost,
  live,
}: {
  amountHeld: number;
  avgCost: number;
  live: number;
}) {
  const [stop, setStop] = useState<number>(round2(live * 0.9));
  const [target, setTarget] = useState<number>(round2(live * 1.2));

  const sl = Number.isFinite(stop) ? stop : 0;
  const tp = Number.isFinite(target) ? target : 0;

  // Risk and reward measured from the current price across the whole position.
  const riskPerShare = live - sl; // > 0 when stop is below price (normal)
  const rewardPerShare = tp - live;
  const dollarRisk = amountHeld * riskPerShare;
  const dollarReward = amountHeld * rewardPerShare;
  const rr =
    riskPerShare > 0 && rewardPerShare > 0 ? rewardPerShare / riskPerShare : null;

  const toStop = live > 0 ? (sl - live) / live : null;
  const toTarget = live > 0 ? (tp - live) / live : null;
  const slVsCost = avgCost > 0 ? (sl - avgCost) / avgCost : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1.5">
        <Shield className="text-muted-foreground size-4" />
        <h4 className="text-sm font-semibold">Stop-loss / take-profit</h4>
        <InfoTip>
          Plan your exits. Risk and reward are measured from the current price
          across your whole position ({formatQty(amountHeld)} units). A
          risk/reward of 2 or more is a common rule of thumb.
        </InfoTip>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field
          id="plan-sl"
          label="Stop-loss"
          prefix="$"
          value={stop}
          onChange={setStop}
          hint={
            toStop != null
              ? `${formatPct(toStop * 100, { signed: true })} from live`
              : undefined
          }
        />
        <Field
          id="plan-tp"
          label="Take-profit"
          prefix="$"
          value={target}
          onChange={setTarget}
          hint={
            toTarget != null
              ? `${formatPct(toTarget * 100, { signed: true })} from live`
              : undefined
          }
        />
      </div>

      {amountHeld > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Out
            label="At risk"
            tip="What you'd lose if the stop-loss is hit, from the current price: position size × (live − stop)."
            value={formatUSD(-Math.abs(dollarRisk), { signed: true })}
            valueClass={pnlColor(-1)}
          />
          <Out
            label="Reward"
            tip="What you'd gain if the take-profit is hit, from the current price: position size × (target − live)."
            value={formatUSD(Math.abs(dollarReward), { signed: true })}
            valueClass={pnlColor(1)}
          />
          <Out
            label="Risk / reward"
            tip="Potential reward divided by potential risk. Higher is better — 2 means you stand to gain twice what you risk. Only valid with the stop below and target above the live price."
            value={rr != null ? `${rr.toFixed(2)} : 1` : "—"}
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          No current position — add shares to size risk and reward.
        </p>
      )}

      {slVsCost != null && (
        <p className="text-muted-foreground text-xs tabular-nums">
          Stop is {formatPct(slVsCost * 100, { signed: true })} vs your average
          cost {formatUSD(avgCost)}.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- primitives */

function SideButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded px-2 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  prefix,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  prefix?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {prefix && (
          <span className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2 text-sm">
            {prefix}
          </span>
        )}
        <Input
          id={id}
          type="number"
          min={0}
          step="any"
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className={cn("tabular-nums", prefix && "pl-7")}
        />
      </div>
      {hint && (
        <p className="text-muted-foreground text-xs tabular-nums">{hint}</p>
      )}
    </div>
  );
}

function Out({
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
      <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", valueClass)}>
        {value}
      </p>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
