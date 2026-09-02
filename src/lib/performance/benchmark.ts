import type { DailyReturnPoint, ExternalCashFlow } from "./metrics";
import type { BenchmarkPoint, SameMoneyComparison } from "./types";

/**
 * "Same money, same dates": every dollar that entered the scope buys the
 * benchmark on that date, every dollar that left sells it. Compares the profit
 * of that shadow with the scope's own profit on the identical flows, so late
 * deposits do not make the index look unbeatable.
 */
export function compareSameMoney(
  flows: ExternalCashFlow[],
  scopeEndValue: number,
  endDate: string,
  benchmarkPrice: (date: string) => number | null,
): SameMoneyComparison | null {
  const endPrice = benchmarkPrice(endDate);
  if (endPrice == null || endPrice <= 0) return null;
  let units = 0;
  let moneyIn = 0;
  let moneyOut = 0;
  for (const flow of flows) {
    const price = benchmarkPrice(flow.date);
    if (price == null || price <= 0) return null;
    units += flow.amount / price;
    if (flow.amount > 0) moneyIn += flow.amount;
    else moneyOut -= flow.amount;
  }
  if (moneyIn <= 0) return null;
  const benchmarkProfit = units * endPrice + moneyOut - moneyIn;
  const scopeProfit = scopeEndValue + moneyOut - moneyIn;
  return {
    moneyIn,
    scopeProfit,
    scopeReturn: scopeProfit / moneyIn,
    benchmarkProfit,
    benchmarkReturn: benchmarkProfit / moneyIn,
  };
}

export function buildBenchmarkSeries(
  series: DailyReturnPoint[],
  benchmarkPrice: (date: string) => number | null,
): BenchmarkPoint[] {
  const portfolioAnchor = series[0]?.growth ?? null;
  const benchmarkAnchor =
    series
      .map((point) => benchmarkPrice(point.date))
      .find((value) => value != null && value > 0) ?? null;
  return series.map((point) => {
    const benchmark = benchmarkPrice(point.date);
    return {
      date: point.date,
      portfolioReturn:
        portfolioAnchor != null && portfolioAnchor > 0
          ? point.growth / portfolioAnchor - 1
          : 0,
      benchmarkReturn:
        benchmarkAnchor != null && benchmark != null
          ? benchmark / benchmarkAnchor - 1
          : null,
    };
  });
}
