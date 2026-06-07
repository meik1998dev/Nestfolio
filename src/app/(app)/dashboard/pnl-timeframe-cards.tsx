"use client";

/**
 * Timeframe selector + the three PnL headline cards (Realized / Unrealized /
 * Total). All timeframes are computed on the server and passed in; the tab bar
 * just toggles which set of numbers is shown — instant, no navigation. "All" is
 * cumulative since inception; the rest are PnL generated during that window.
 */
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatUSD, pnlColor } from "@/lib/format";
import {
  PNL_TIMEFRAMES,
  TIMEFRAME_LABELS,
  type PnlTimeframe,
  type TimeframePnl,
} from "@/lib/pnl/timeframe.types";

export function PnlTimeframeCards({ data }: { data: TimeframePnl[] }) {
  const [selected, setSelected] = useState<PnlTimeframe>("all");
  const byTf = new Map(data.map((d) => [d.timeframe, d]));
  const current = byTf.get(selected) ?? byTf.get("all") ?? null;
  if (!current) return null;

  const period = selected !== "all";

  return (
    <div className="mb-6 space-y-4">
      <div className="bg-muted inline-flex flex-wrap rounded-lg p-0.5">
        {PNL_TIMEFRAMES.filter((t) => byTf.has(t)).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setSelected(t)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              t === selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {TIMEFRAME_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          label="Realized PnL"
          value={current.realized}
          hint={
            period
              ? "Locked-in gains from disposals in this period."
              : "Locked-in gains from disposals."
          }
        />
        <MetricCard
          label="Unrealized PnL"
          value={current.unrealized}
          hint={
            current.partial
              ? "Paper gains at live prices — some prices unavailable."
              : period
                ? "Change in paper gains on open positions."
                : "Paper gains on open positions at live prices."
          }
        />
        <MetricCard
          label="Total PnL"
          value={current.total}
          hint="Realized + unrealized."
          emphasize
        />
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: number;
  hint: string;
  emphasize?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle
          className={`tabular-nums ${emphasize ? "text-3xl" : "text-2xl"} ${pnlColor(value)}`}
        >
          {formatUSD(value, { signed: true })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}
