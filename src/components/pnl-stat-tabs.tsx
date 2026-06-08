"use client";

/**
 * Timeframe selector + four headline stat cards (Return % / Total / Realized /
 * Unrealized P&L). Every timeframe is computed on the server and passed in; the
 * tab bar just toggles which set of numbers is shown — instant, no navigation.
 * "All" is cumulative since inception; the rest are P&L generated during that
 * window. Shared by the portfolio detail and holding detail pages.
 *
 * Return % = the selected window's total P&L over invested capital (current cost
 * basis). For "All" that's the true cumulative return; for a window it reads as
 * "how much this period moved the needle on my deployed capital."
 */
import { useState } from "react";
import {
  Percent,
  TrendingUp,
  TrendingDown,
  Wallet,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatUSD, formatRatioPct, pnlColor } from "@/lib/format";
import {
  PNL_TIMEFRAMES,
  TIMEFRAME_LABELS,
  type PnlTimeframe,
  type TimeframePnl,
} from "@/lib/pnl/timeframe.types";

export function PnlStatTabs({
  data,
  investedCapital,
}: {
  data: TimeframePnl[];
  /** Net cost basis — the denominator for Return %. */
  investedCapital: number;
}) {
  const [selected, setSelected] = useState<PnlTimeframe>("all");
  const byTf = new Map(data.map((d) => [d.timeframe, d]));
  const current = byTf.get(selected) ?? byTf.get("all") ?? null;
  if (!current) return null;

  const period = selected !== "all";
  const returnPct =
    investedCapital > 1e-6 ? current.total / investedCapital : null;

  return (
    <div className="space-y-4">
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Percent className="size-4" />}
          label={period ? "Return (period)" : "Return"}
          value={returnPct != null ? formatRatioPct(returnPct, { signed: true }) : "—"}
          valueClass={returnPct != null ? pnlColor(returnPct) : ""}
        />
        <StatCard
          icon={
            current.total >= 0 ? (
              <TrendingUp className="size-4" />
            ) : (
              <TrendingDown className="size-4" />
            )
          }
          label="Total P&L"
          value={formatUSD(current.total, { signed: true })}
          valueClass={pnlColor(current.total)}
        />
        <StatCard
          icon={<Wallet className="size-4" />}
          label="Realized P&L"
          value={formatUSD(current.realized, { signed: true })}
          valueClass={pnlColor(current.realized)}
        />
        <StatCard
          icon={<Sparkles className="size-4" />}
          label="Unrealized P&L"
          value={formatUSD(current.unrealized, { signed: true })}
          valueClass={pnlColor(current.unrealized)}
          hint={current.partial ? "Some live prices unavailable." : undefined}
        />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  valueClass,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          {icon}
          {label}
        </div>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums", valueClass)}>
          {value}
        </p>
        {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
      </CardContent>
    </Card>
  );
}
