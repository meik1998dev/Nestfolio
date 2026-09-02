import { Suspense } from "react";
import type { Metadata } from "next";
import { Activity } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PerformanceMetricTile } from "@/components/performance-metric-tile";
import { Card, CardContent } from "@/components/ui/card";
import { StatCardsSkeleton } from "@/components/skeletons";
import {
  getPerformanceAnalysis,
  getPerformanceScopes,
  parsePerformanceRange,
} from "@/lib/performance/analysis.server";
import { PERFORMANCE_READINESS } from "@/lib/performance/metrics";
import { verdictBandText, verdictFor } from "@/lib/performance/verdicts";
import { formatDate, formatRatioPct, formatUSD } from "@/lib/format";
import { PerformanceControls } from "./controls";
import { ComparisonChart } from "./comparison-chart";

export const metadata: Metadata = {
  title: "Performance",
  description: "Returns, market comparison, and risk for every portfolio.",
};

type SearchParams = Promise<{ scope?: string; range?: string }>;

export default function PerformancePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeader
        title="Performance"
        description="See what your picks earned, how they compare, and how much risk they took."
      />
      <Suspense fallback={<StatCardsSkeleton />}>
        <PerformanceBody searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function PerformanceBody({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const range = parsePerformanceRange(params.range);
  const { options } = await getPerformanceScopes();
  const requestedScope = params.scope ?? "all";
  const analysis = await getPerformanceAnalysis(range, requestedScope);

  return (
    <div className="space-y-6">
      <PerformanceControls options={options} scopeId={analysis.scopeId} range={range} />
      {analysis.empty ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <Activity className="text-muted-foreground size-8" />
            <p className="font-medium">No trades in {analysis.scopeName}</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Add a buy, sell, delivery, or send for this scope. Performance starts on the first trade date.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Summary analysis={analysis} />
          <ReturnTiles analysis={analysis} />
          <ComparisonChart
            series={analysis.benchmarkSeries}
            timeWeightedReturn={analysis.timeWeightedReturn}
            annualizedTimeWeightedReturn={
              analysis.historyDays >= PERFORMANCE_READINESS.yearlyMetricDays
                ? analysis.annualizedTimeWeightedReturn
                : null
            }
            benchmarkReturn={analysis.benchmarkReturn}
          />
          <RiskTiles analysis={analysis} />
        </>
      )}
    </div>
  );
}

function Summary({ analysis }: { analysis: Awaited<ReturnType<typeof getPerformanceAnalysis>> }) {
  const sameMoney = analysis.sameMoney;
  const dollarGap = sameMoney == null ? null : sameMoney.scopeProfit - sameMoney.benchmarkProfit;
  const marketText =
    dollarGap == null
      ? "market comparison is not ready"
      : dollarGap >= 0
        ? `with the same money you beat the S&P 500 by ${formatUSD(dollarGap)}`
        : `with the same money you trailed the S&P 500 by ${formatUSD(Math.abs(dollarGap))}`;
  const drawdown = analysis.maxDrawdown == null ? "worst dip is not ready" : `worst dip was ${formatRatioPct(Math.abs(analysis.maxDrawdown))}`;
  const riskText =
    analysis.tradingDays >= 60 && analysis.annualizedVolatility != null
      ? `risk level is ${verdictFor("volatility", analysis.annualizedVolatility).toLowerCase()}`
      : "risk level is not ready";
  return (
    <p className="text-muted-foreground text-sm">
      {marketText}; {riskText}; {drawdown}.
    </p>
  );
}

function ReturnTiles({ analysis }: { analysis: Awaited<ReturnType<typeof getPerformanceAnalysis>> }) {
  const sameMoney = analysis.sameMoney;
  // Same divisor as the dashboard's Return % chart: money still invested.
  const scopePct = sameMoney != null && analysis.invested > 0 ? sameMoney.scopeProfit / analysis.invested : null;
  const benchmarkPct = sameMoney != null && analysis.invested > 0 ? sameMoney.benchmarkProfit / analysis.invested : null;
  const pctGap = scopePct != null && benchmarkPct != null ? scopePct - benchmarkPct : null;
  const readiness = analysis.readiness;
  const period = analysis.moneyWeightedPeriod;
  const returnOnCost = analysis.returnOnCost;
  const showAnnual =
    analysis.moneyWeightedAnnual != null && analysis.historyDays >= PERFORMANCE_READINESS.yearlyMetricDays;
  const upOrDown = (value: number) => (value >= 0 ? "up" : "down");
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Returns</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <PerformanceMetricTile
          title="Profit on invested money"
          value={formatMetric(returnOnCost)}
          verdict={verdictFor("return", returnOnCost)}
          readiness={readiness}
          info={`Profit (sold and unsold) divided by the money you put in. The simple "did I make money?" number. Same as Return on the portfolio page. ${verdictBandText("return")}`}
          explanation={
            returnOnCost == null
              ? "No open Invested amount is available."
              : `Since your first trade: you put in ${formatUSD(analysis.invested)} and are ${upOrDown(analysis.totalPnl)} ${formatUSD(Math.abs(analysis.totalPnl))}.`
          }
        />
        <PerformanceMetricTile
          title="Rate your money earned"
          value={formatMetric(period)}
          verdict={verdictFor("return", period)}
          readiness={period == null ? "waiting" : readiness}
          info={`Like bank interest on the money you had invested, for the days it was invested. Money you added late counts for fewer days. Shown for this period; a per-year rate appears after one year of history. ${verdictBandText("return")}`}
          explanation={
            period == null
              ? "Needs at least 30 days and two dated cash flows."
              : returnOnCost == null
                ? `Your money grew at ${formatRatioPct(period, { signed: true })} over ${analysis.historyDays} days.`
                : `Over ${analysis.historyDays} days. ${period >= returnOnCost ? "Higher" : "Lower"} than the profit number because money you added later had ${period >= returnOnCost ? "less" : "more"} time to work.`
          }
          detail={showAnnual ? `${formatRatioPct(analysis.moneyWeightedAnnual!)} per year` : undefined}
        />
        <PerformanceMetricTile
          title="Same money in the S&P 500"
          value={sameMoney == null ? "Not ready" : formatUSD(sameMoney.scopeProfit - sameMoney.benchmarkProfit, { signed: true })}
          verdict={verdictFor("market-gap", pctGap)}
          readiness={sameMoney == null ? "waiting" : readiness}
          info={`This answers "did I make more money?". Pretend every buy bought the S&P 500 instead, on the same day with the same dollars, and every sell sold it. Then compare profit today. The chart below answers a different question: "were my picks good?". ${verdictBandText("market-gap")}`}
          explanation={
            sameMoney == null || scopePct == null || benchmarkPct == null
              ? "Market history is not available for this range."
              : `In this period the S&P 500 would be ${upOrDown(sameMoney.benchmarkProfit)} ${formatUSD(Math.abs(sameMoney.benchmarkProfit))} (${formatRatioPct(benchmarkPct, { signed: true })}). Your picks are ${upOrDown(sameMoney.scopeProfit)} ${formatUSD(Math.abs(sameMoney.scopeProfit))} (${formatRatioPct(scopePct, { signed: true })}).`
          }
          detail={pctGap == null ? undefined : `${formatRatioPct(scopePct!, { signed: true })} vs ${formatRatioPct(benchmarkPct!, { signed: true })}`}
        />
      </div>
    </section>
  );
}

function RiskTiles({ analysis }: { analysis: Awaited<ReturnType<typeof getPerformanceAnalysis>> }) {
  const shown = analysis.tradingDays >= 60;
  const readiness = analysis.tradingDays < 60 ? "waiting" : analysis.tradingDays < 120 ? "low-confidence" : "ready";
  const confidenceDetail =
    analysis.tradingDays < 60
      ? `Needs 60 trading days · ${analysis.tradingDays} of 60 days`
      : analysis.tradingDays < 120
        ? `Low confidence · ${analysis.tradingDays} of 120 days`
        : undefined;
  const volatility = shown ? analysis.annualizedVolatility : null;
  const drawdown = shown ? analysis.maxDrawdown : null;
  const valueAtRisk = shown ? analysis.valueAtRisk95 : null;
  const valueAtRiskPct = shown ? analysis.valueAtRisk95Pct : null;
  const volatilityLabel = verdictFor("volatility", volatility);
  const typicalDailyMove = volatility == null ? null : volatility / Math.sqrt(252);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Risk</h2>
      <div className="grid gap-4 md:grid-cols-3">
        <PerformanceMetricTile
          title="How much it swings"
          value={volatility == null ? "Not ready" : formatRatioPct(volatility)}
          verdict={volatilityLabel}
          readiness={readiness}
          info={`Annualized volatility: how widely daily returns moved, scaled to one year. Days before the scope was worth ${formatUSD(PERFORMANCE_READINESS.minimumRiskValue)} are skipped. ${verdictBandText("volatility")}`}
          explanation={typicalDailyMove == null ? "Waiting for enough trading days." : `Your value usually moves about ±${formatRatioPct(typicalDailyMove)} on a normal day.`}
          detail={confidenceDetail}
        />
        <PerformanceMetricTile
          title="Max drawdown"
          value={drawdown == null ? "Not ready" : formatRatioPct(Math.abs(drawdown))}
          verdict={verdictFor("drawdown", drawdown)}
          readiness={readiness}
          info={`Largest peak-to-trough fall in the Time-weighted growth line. ${verdictBandText("drawdown")}`}
          explanation={
            drawdown == null || analysis.drawdownPeakDate == null || analysis.drawdownTroughDate == null
              ? "Waiting for enough trading days."
              : `From ${formatDate(analysis.drawdownPeakDate)} to ${formatDate(analysis.drawdownTroughDate)} · ${analysis.drawdownRecovered ? "recovered" : "still in drawdown"}.`
          }
          detail={confidenceDetail}
        />
        <PerformanceMetricTile
          title="1-day value at risk (95%)"
          value={valueAtRisk == null ? "Not ready" : formatUSD(valueAtRisk)}
          verdict={verdictFor("var", valueAtRiskPct)}
          readiness={readiness}
          info={`Historical 5th-percentile daily return, applied to today's scope value. ${verdictBandText("var")}`}
          explanation={valueAtRisk == null ? "Waiting for enough trading days." : `On a bad day you could lose about ${formatUSD(valueAtRisk)}.`}
          detail={valueAtRiskPct == null ? confidenceDetail : `${formatRatioPct(Math.abs(valueAtRiskPct))} of current value${confidenceDetail ? ` · ${confidenceDetail}` : ""}`}
        />
      </div>
    </section>
  );
}

function formatMetric(value: number | null): string {
  return value == null ? "Not ready" : formatRatioPct(value, { signed: true });
}
