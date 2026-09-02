import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getPerformanceAnalysis } from "@/lib/performance/analysis.server";
import type { PerformanceRange } from "@/lib/performance/types";
import { formatRatioPct, formatUSD, pnlColor } from "@/lib/format";

/**
 * Three headline numbers from the Performance page plus a link to the full
 * view with the same scope and range. Async server component: render it inside
 * a <Suspense> so a slow price fetch never blanks the page around it.
 */
export async function PerformanceStrip({ scopeId, range }: { scopeId: string; range: PerformanceRange }) {
  let analysis: Awaited<ReturnType<typeof getPerformanceAnalysis>>;
  try {
    analysis = await getPerformanceAnalysis(range, scopeId);
  } catch {
    return null;
  }
  if (analysis.empty) return null;

  const sameMoney = analysis.sameMoney;
  const gap = sameMoney == null ? null : sameMoney.scopeProfit - sameMoney.benchmarkProfit;
  const drawdown = analysis.tradingDays >= 60 ? analysis.maxDrawdown : null;
  const rate = analysis.moneyWeightedPeriod;
  const href = `/performance?scope=${encodeURIComponent(scopeId)}&range=${range}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
      <dl className="grid grid-cols-3 gap-6">
        <Stat label="Rate your money earned" value={rate == null ? "Not ready" : formatRatioPct(rate, { signed: true })} tone={rate} />
        <Stat label="vs S&P 500, same money" value={gap == null ? "Not ready" : formatUSD(gap, { signed: true })} tone={gap} />
        <Stat label="Max drawdown" value={drawdown == null ? "Not ready" : formatRatioPct(Math.abs(drawdown))} />
      </dl>
      <Link href={href} className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline">
        Full analysis
        <ArrowRight className="size-4" />
      </Link>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: number | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${tone == null ? "" : pnlColor(tone)}`}>{value}</dd>
    </div>
  );
}
