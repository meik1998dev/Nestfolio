import type { Readiness } from "./metrics";

export type PerformanceRange = "1M" | "3M" | "6M" | "1Y" | "Max";

export interface PerformanceScopeOption {
  id: string;
  name: string;
  depth: number;
}

export interface BenchmarkPoint {
  date: string;
  portfolioReturn: number;
  benchmarkReturn: number | null;
}

/** Result of putting the scope's exact cash flows into the benchmark instead. */
export interface SameMoneyComparison {
  /** Total dollars that entered the scope in the window. */
  moneyIn: number;
  /** Scope profit on those flows: end value + money out − money in. */
  scopeProfit: number;
  scopeReturn: number;
  /** Benchmark profit on the identical flows. */
  benchmarkProfit: number;
  benchmarkReturn: number;
}

export interface PerformanceAnalysis {
  scopeId: string;
  scopeName: string;
  range: PerformanceRange;
  empty: boolean;
  firstTradeDate: string | null;
  historyDays: number;
  tradingDays: number;
  readiness: Readiness;
  timeWeightedReturn: number | null;
  annualizedTimeWeightedReturn: number | null;
  moneyWeightedAnnual: number | null;
  /** Money-weighted return for the window itself, not stretched to a year. */
  moneyWeightedPeriod: number | null;
  returnOnCost: number | null;
  /** Money currently invested (open cost basis) in this scope. */
  invested: number;
  /** Realized plus unrealized P&L in this scope. */
  totalPnl: number;
  benchmarkReturn: number | null;
  benchmarkSeries: BenchmarkPoint[];
  sameMoney: SameMoneyComparison | null;
  annualizedVolatility: number | null;
  maxDrawdown: number | null;
  drawdownPeakDate: string | null;
  drawdownTroughDate: string | null;
  drawdownRecovered: boolean;
  valueAtRisk95: number | null;
  valueAtRisk95Pct: number | null;
  currentValue: number;
}
