import { DAY_MS, sampleDates } from "@/lib/price/history";
import { buildLedger, positionPnl } from "@/lib/pnl/costbasis";
import type { TradeEventInput } from "@/lib/pnl/classify";

export const PERFORMANCE_READINESS = {
  minimumDays: 60,
  fullConfidenceDays: 120,
  yearlyMetricDays: 365,
  annualizedReturnDays: 90,
  moneyWeightedDays: 30,
  /** Risk figures start once the scope is worth at least this much (USD). */
  minimumRiskValue: 500,
} as const;

export type Readiness = "waiting" | "low-confidence" | "ready";

export interface ExternalCashFlow {
  date: string;
  /** Positive means cash entered the measured scope; negative means it left. */
  amount: number;
  tradeId: string;
}

export interface DailyReturnPoint {
  date: string;
  value: number;
  externalCashFlow: number;
  dailyReturn: number;
  growth: number;
}

export interface DrawdownResult {
  value: number;
  peakDate: string | null;
  troughDate: string | null;
  recovered: boolean;
}

export interface MoneyWeightedReturn {
  status: "ready" | "not-ready";
  annual: number | null;
  monthly: number | null;
  /** The annual rate applied to the window length: what the money earned in this period. */
  period: number | null;
  reason: "short-window" | "too-few-flows" | "no-solution" | null;
}

export interface DailyReturnResult {
  series: DailyReturnPoint[];
  /** The part of `series` from the first day the scope was worth enough to measure risk on. */
  riskSeries: DailyReturnPoint[];
  cashFlows: ExternalCashFlow[];
  /** Window opening value as a flow on the start date, plus every later flow. */
  windowCashFlows: ExternalCashFlow[];
  timeWeightedReturn: number | null;
  annualizedTimeWeightedReturn: number | null;
  moneyWeightedReturn: MoneyWeightedReturn;
  maxDrawdown: DrawdownResult;
  annualizedVolatility: number | null;
  historyDays: number;
  readiness: Readiness;
}

export type PriceLookup = (ticker: string, date: string) => number | null;

export interface DailyReturnInput {
  events: TradeEventInput[];
  start: string;
  end: string;
  price: PriceLookup;
}

export function historyDays(start: string, end: string): number {
  return Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS));
}

export function metricReadiness(days: number): Readiness {
  if (days < PERFORMANCE_READINESS.minimumDays) return "waiting";
  if (days < PERFORMANCE_READINESS.fullConfidenceDays) return "low-confidence";
  return "ready";
}

export function extractExternalCashFlows(
  events: TradeEventInput[],
  price: PriceLookup,
): ExternalCashFlow[] {
  return events
    .filter((event) => event.type !== "deposit")
    .map((event) => {
      const date = event.ts.slice(0, 10);
      const value =
        event.usdValue ??
        ((event.type === "delivery" || event.type === "send")
          ? price(event.ticker, date) == null
            ? null
            : event.shares * price(event.ticker, date)!
          : null);
      if (value == null || !Number.isFinite(value)) {
        throw new Error(
          `No cash-flow value for ${event.ticker} on ${date} (${event.tx_hash})`,
        );
      }
      const isIn = event.type === "buy" || event.type === "delivery";
      return {
        date,
        amount: isIn ? value : -value,
        tradeId: event.tx_hash,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildDailyReturnSeries({
  events,
  start,
  end,
  price,
}: DailyReturnInput): DailyReturnPoint[] {
  const ordered = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  const flows = extractExternalCashFlows(ordered, price);
  const flowByDate = new Map<string, number>();
  for (const flow of flows) {
    flowByDate.set(flow.date, (flowByDate.get(flow.date) ?? 0) + flow.amount);
  }

  const series: DailyReturnPoint[] = [];
  let previousValue = 0;
  let growth = 1;
  for (const date of sampleDates(start, end, 1)) {
    const throughDate = ordered.filter((event) => event.ts.slice(0, 10) <= date);
    const positions = buildLedger(throughDate, price);
    let value = 0;
    for (const position of positions) {
      const priced = positionPnl(position, price(position.ticker, date));
      if (position.shares > 0 && priced.marketValue == null) {
        throw new Error(`No valuation price for ${position.ticker} on ${date}`);
      }
      value += priced.marketValue ?? 0;
    }

    const externalCashFlow = flowByDate.get(date) ?? 0;
    let dailyReturn = 0;
    if (series.length === 0) {
      // A selected window starts from its first closing value. There is no
      // reliable before-flow valuation inside that day, so it is the 0% base.
      dailyReturn = 0;
    } else if (previousValue > 0) {
      dailyReturn = (value - externalCashFlow) / previousValue - 1;
    }
    if (!Number.isFinite(dailyReturn)) dailyReturn = 0;
    growth *= 1 + dailyReturn;
    series.push({ date, value, externalCashFlow, dailyReturn, growth });
    previousValue = value;
  }
  return series;
}

export function calculateTimeWeightedReturn(
  series: DailyReturnPoint[],
): number | null {
  if (series.length === 0) return null;
  return series.reduce((growth, point) => growth * (1 + point.dailyReturn), 1) - 1;
}

export function annualizeReturn(totalReturn: number, days: number): number | null {
  if (days < PERFORMANCE_READINESS.annualizedReturnDays || totalReturn <= -1) {
    return null;
  }
  return (1 + totalReturn) ** (365 / days) - 1;
}

export function calculateMoneyWeightedReturn(
  cashFlows: ExternalCashFlow[],
  terminalDate: string,
  terminalValue: number,
  days: number,
): MoneyWeightedReturn {
  if (days < PERFORMANCE_READINESS.moneyWeightedDays) {
    return { status: "not-ready", annual: null, monthly: null, period: null, reason: "short-window" };
  }
  const investorFlows = cashFlows.map((flow) => ({
    date: flow.date,
    amount: -flow.amount,
  }));
  investorFlows.push({ date: terminalDate, amount: terminalValue });
  const combined = combineDatedFlows(investorFlows);
  if (combined.length < 2) {
    return { status: "not-ready", annual: null, monthly: null, period: null, reason: "too-few-flows" };
  }
  const annual = solveAnnualRate(combined);
  if (annual == null) {
    return { status: "not-ready", annual: null, monthly: null, period: null, reason: "no-solution" };
  }
  return {
    status: "ready",
    annual,
    monthly: (1 + annual) ** (1 / 12) - 1,
    period: (1 + annual) ** (days / 365) - 1,
    reason: null,
  };
}

function combineDatedFlows(
  flows: Array<{ date: string; amount: number }>,
): Array<{ date: string; amount: number }> {
  const byDate = new Map<string, number>();
  for (const flow of flows) {
    byDate.set(flow.date, (byDate.get(flow.date) ?? 0) + flow.amount);
  }
  return [...byDate]
    .map(([date, amount]) => ({ date, amount }))
    .filter((flow) => Math.abs(flow.amount) > 1e-9)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function solveAnnualRate(
  flows: Array<{ date: string; amount: number }>,
): number | null {
  if (!flows.some((flow) => flow.amount < 0) || !flows.some((flow) => flow.amount > 0)) {
    return null;
  }
  const start = Date.parse(flows[0].date);
  const npv = (rate: number) =>
    flows.reduce(
      (sum, flow) =>
        sum +
        flow.amount /
          (1 + rate) ** ((Date.parse(flow.date) - start) / DAY_MS / 365),
      0,
    );

  let low = -0.999999;
  let high = 1;
  let lowValue = npv(low);
  let highValue = npv(high);
  while (lowValue * highValue > 0 && high < 1_000_000) {
    high *= 2;
    highValue = npv(high);
  }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) {
    return null;
  }
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const value = npv(mid);
    if (Math.abs(value) < 1e-10) return mid;
    if (lowValue * value <= 0) {
      high = mid;
      highValue = value;
    } else {
      low = mid;
      lowValue = value;
    }
  }
  return (low + high) / 2;
}

/**
 * Risk figures ignore the days before the scope reached a minimum value. A
 * $160 portfolio that moves 10% is noise next to the same scope at $5,000,
 * yet every daily return would count the same in volatility and drawdown.
 */
export function riskWindow(series: DailyReturnPoint[]): DailyReturnPoint[] {
  const first = series.findIndex((point) => point.value >= PERFORMANCE_READINESS.minimumRiskValue);
  return first < 0 ? [] : series.slice(first);
}

export function calculateMaxDrawdown(series: DailyReturnPoint[]): DrawdownResult {
  if (series.length === 0) {
    return { value: 0, peakDate: null, troughDate: null, recovered: false };
  }
  let peak = series[0].growth;
  let peakDate = series[0].date;
  let max = 0;
  let maxPeakDate = peakDate;
  let troughDate = peakDate;
  for (const point of series) {
    if (point.growth > peak) {
      peak = point.growth;
      peakDate = point.date;
    }
    const drawdown = peak > 0 ? point.growth / peak - 1 : 0;
    if (drawdown < max) {
      max = drawdown;
      maxPeakDate = peakDate;
      troughDate = point.date;
    }
  }
  const troughIndex = series.findIndex((point) => point.date === troughDate);
  const peakGrowth = series.find((point) => point.date === maxPeakDate)?.growth ?? 1;
  const recovered = series.slice(Math.max(0, troughIndex + 1)).some(
    (point) => point.growth >= peakGrowth,
  );
  return { value: max, peakDate: maxPeakDate, troughDate, recovered };
}

export function calculateAnnualizedVolatility(
  series: DailyReturnPoint[],
): number | null {
  const returns = series
    .slice(1)
    .filter((point) => isWeekday(point.date))
    .map((point) => point.dailyReturn);
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function tradingDayCount(series: DailyReturnPoint[]): number {
  return series.filter((point) => isWeekday(point.date)).length;
}

export function calculateHistoricalValueAtRisk(
  series: DailyReturnPoint[],
): number | null {
  const returns = series
    .slice(1)
    .filter((point) => isWeekday(point.date))
    .map((point) => point.dailyReturn)
    .sort((a, b) => a - b);
  if (returns.length === 0) return null;
  const index = Math.max(0, Math.ceil(returns.length * 0.05) - 1);
  return Math.min(0, returns[index]);
}

function isWeekday(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

export function calculateDailyReturns(input: DailyReturnInput): DailyReturnResult {
  const series = buildDailyReturnSeries(input);
  const cashFlows = extractExternalCashFlows(input.events, input.price).filter(
    (flow) => flow.date >= input.start && flow.date <= input.end,
  );
  const days = historyDays(input.start, input.end);
  const timeWeightedReturn = calculateTimeWeightedReturn(series);
  const terminalValue = series.at(-1)?.value ?? 0;
  const moneyWeightedFlows: ExternalCashFlow[] = [
    {
      date: input.start,
      amount: series[0]?.value ?? 0,
      tradeId: "window-opening-value",
    },
    // The opening value already includes every trade on the first date.
    ...cashFlows.filter((flow) => flow.date > input.start),
  ];
  const riskSeries = riskWindow(series);
  return {
    series,
    riskSeries,
    cashFlows,
    windowCashFlows: moneyWeightedFlows,
    timeWeightedReturn,
    annualizedTimeWeightedReturn:
      timeWeightedReturn == null ? null : annualizeReturn(timeWeightedReturn, days),
    moneyWeightedReturn: calculateMoneyWeightedReturn(
      moneyWeightedFlows,
      input.end,
      terminalValue,
      days,
    ),
    maxDrawdown: calculateMaxDrawdown(riskSeries),
    annualizedVolatility: calculateAnnualizedVolatility(riskSeries),
    historyDays: days,
    readiness: metricReadiness(days),
  };
}
