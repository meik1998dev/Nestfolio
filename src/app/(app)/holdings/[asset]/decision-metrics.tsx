import {
  Gauge,
  Target,
  ArrowDownToLine,
  Activity,
  CalendarClock,
  PieChart,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { formatUSD, formatPct, pnlColor } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AssetMetrics } from "@/lib/asset/detail";

/**
 * Decision metrics — a dashboard of context an investor needs before acting:
 * where price sits vs break-even and its 52-week range, how the position has
 * compounded, how volatile the asset is, and how concentrated the bet is. Every
 * tile carries an InfoTip so the numbers are self-explanatory. Pure presentation
 * — all figures derive from props (server-computed metrics + live position).
 */
export function DecisionMetrics({
  amountHeld,
  avgCost,
  livePrice,
  marketValue,
  costBasis,
  pnlKnown,
  metrics,
  netWorth,
}: {
  amountHeld: number;
  avgCost: number;
  livePrice: number | null;
  marketValue: number | null;
  costBasis: number;
  pnlKnown: boolean;
  metrics: AssetMetrics;
  netWorth: number;
}) {
  const hasPos = amountHeld > 0;
  const hasCost = pnlKnown && avgCost > 0;

  // Break-even = average cost; how far live price sits from it.
  const breakEvenDist =
    hasCost && livePrice != null ? (livePrice - avgCost) / avgCost : null;

  // Distance from the trailing-52-week high (drawdown) and low.
  const fromHigh =
    livePrice != null && metrics.high52
      ? (livePrice - metrics.high52) / metrics.high52
      : null;
  const fromLow =
    livePrice != null && metrics.low52
      ? (livePrice - metrics.low52) / metrics.low52
      : null;

  // Holding period + annualized return (CAGR) on the position.
  const holdingDays = metrics.firstTradeDate
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(metrics.firstTradeDate).getTime()) / 86_400_000,
        ),
      )
    : null;
  const years = holdingDays != null ? holdingDays / 365 : null;
  const cagr =
    hasCost && marketValue != null && costBasis > 0 && years != null && years >= 0.08
      ? (marketValue / costBasis) ** (1 / Math.max(years, 0.08)) - 1
      : null;

  // Concentration: this position as a share of total net worth.
  const concentration =
    marketValue != null && netWorth > 0 ? marketValue / netWorth : null;
  const concHot = concentration != null && concentration > 0.2;

  const vol = metrics.volatility;
  const volLabel =
    vol == null
      ? null
      : vol < 0.25
        ? "Low"
        : vol < 0.5
          ? "Moderate"
          : vol < 0.8
            ? "High"
            : "Very high";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="text-muted-foreground size-4" />
          Decision metrics
        </CardTitle>
        <CardDescription>
          Context for your next move — where price sits, how the position has
          compounded, and how risky the bet is.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
        <Tile
          icon={<Target className="size-4" />}
          label="Break-even"
          tip="The price at which your unrealized P&L is exactly $0 — your average cost. Above it the position is in profit; below it, at a loss."
          value={hasCost ? formatUSD(avgCost) : "—"}
          sub={
            breakEvenDist != null
              ? `Live ${formatPct(breakEvenDist * 100, { signed: true })} vs break-even`
              : undefined
          }
          subClass={breakEvenDist != null ? pnlColor(breakEvenDist) : undefined}
        />

        <Tile
          icon={<TrendingUp className="size-4" />}
          label="52-week range"
          tip="The lowest and highest daily price over the past year. Shows whether today's price is cheap or expensive relative to its recent history."
          value={
            metrics.low52 != null && metrics.high52 != null
              ? `${formatUSD(metrics.low52)} – ${formatUSD(metrics.high52)}`
              : "—"
          }
          sub={
            fromLow != null
              ? `${formatPct(fromLow * 100, { signed: true })} above the 52w low`
              : undefined
          }
        />

        <Tile
          icon={<ArrowDownToLine className="size-4" />}
          label="Drawdown"
          tip="How far the current price has fallen from its 52-week high. A deep drawdown can signal either a discount or a deteriorating asset — pair it with the other metrics."
          value={fromHigh != null ? formatPct(fromHigh * 100, { signed: true }) : "—"}
          valueClass={fromHigh != null ? pnlColor(fromHigh) : undefined}
          sub={
            metrics.high52 != null
              ? `52w high ${formatUSD(metrics.high52)}`
              : undefined
          }
        />

        <Tile
          icon={<Activity className="size-4" />}
          label="Volatility"
          tip="Annualized standard deviation of daily returns (×√252). Roughly how much the price swings in a year. Low <25%, Moderate <50%, High <80%, else Very high. Higher = riskier."
          value={vol != null ? formatPct(vol * 100) : "—"}
          sub={volLabel ?? undefined}
        />

        <Tile
          icon={<TrendingUp className="size-4" />}
          label="Annualized return"
          tip="CAGR — the compounded yearly return on this position since your first trade: (current value ÷ cost basis) ^ (1 ÷ years) − 1. Lets you compare against benchmarks like the S&P 500 (~10%/yr)."
          value={cagr != null ? formatPct(cagr * 100, { signed: true }) : "—"}
          valueClass={cagr != null ? pnlColor(cagr) : undefined}
          sub={cagr != null ? "since first trade" : "needs ~1 month held"}
        />

        <Tile
          icon={<CalendarClock className="size-4" />}
          label="Holding period"
          tip="How long you've held this asset, from your first recorded trade to today. Longer holds usually mean lower tax and less noise from short-term swings."
          value={holdingDays != null ? formatDuration(holdingDays) : "—"}
          sub={
            metrics.firstTradeDate
              ? `since ${metrics.firstTradeDate.slice(0, 10)}`
              : undefined
          }
        />

        <Tile
          icon={concHot ? <TriangleAlert className="size-4" /> : <PieChart className="size-4" />}
          label="Concentration"
          tip="This position's share of your total net worth. A single asset above ~20% is a concentration risk — a big move here meaningfully swings your whole portfolio."
          value={concentration != null ? formatPct(concentration * 100) : "—"}
          valueClass={concHot ? "text-amber-600 dark:text-amber-500" : undefined}
          sub={
            concentration != null
              ? concHot
                ? "above 20% — high"
                : "of net worth"
              : undefined
          }
        />

        {!hasPos && (
          <p className="text-muted-foreground col-span-full text-sm">
            No current position — some metrics need open shares to compute.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({
  icon,
  label,
  tip,
  value,
  valueClass,
  sub,
  subClass,
}: {
  icon: React.ReactNode;
  label: string;
  tip: string;
  value: string;
  valueClass?: string;
  sub?: string;
  subClass?: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <span className="text-muted-foreground/70">{icon}</span>
        <span>{label}</span>
        <InfoTip>{tip}</InfoTip>
      </div>
      <p className={cn("mt-1 text-lg font-semibold tabular-nums", valueClass)}>
        {value}
      </p>
      {sub && (
        <p className={cn("text-muted-foreground mt-0.5 text-xs tabular-nums", subClass)}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** "412d" → "1y 1mo"; compact human duration from a day count. */
function formatDuration(days: number): string {
  if (days < 31) return `${days}d`;
  const y = Math.floor(days / 365);
  const mo = Math.floor((days % 365) / 30);
  if (y === 0) return `${mo}mo`;
  return mo === 0 ? `${y}y` : `${y}y ${mo}mo`;
}
