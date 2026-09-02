import { describe, expect, it } from "vitest";
import type { DailyReturnPoint } from "./metrics";
import { buildBenchmarkSeries, compareSameMoney } from "./benchmark";

describe("buildBenchmarkSeries", () => {
  it("rebases both lines to 0% on the first date", () => {
    const series: DailyReturnPoint[] = [
      { date: "2025-01-01", value: 110, externalCashFlow: 100, dailyReturn: 0.1, growth: 1.1 },
      { date: "2025-01-02", value: 121, externalCashFlow: 0, dailyReturn: 0.1, growth: 1.21 },
    ];
    const benchmark = buildBenchmarkSeries(series, (date) =>
      date === "2025-01-01" ? 500 : 525,
    );
    expect(benchmark[0]).toMatchObject({ portfolioReturn: 0, benchmarkReturn: 0 });
    expect(benchmark[1].portfolioReturn).toBeCloseTo(0.1, 10);
    expect(benchmark[1].benchmarkReturn).toBeCloseTo(0.05, 10);
  });

  it("keeps a null benchmark line when history is missing", () => {
    const series: DailyReturnPoint[] = [
      { date: "2025-01-01", value: 100, externalCashFlow: 100, dailyReturn: 0, growth: 1 },
    ];
    expect(buildBenchmarkSeries(series, () => null)[0].benchmarkReturn).toBeNull();
  });
});

describe("compareSameMoney", () => {
  it("puts each flow into the benchmark on its own date", () => {
    const price = (date: string) => ({ "2025-01-01": 100, "2025-02-01": 110, "2025-03-01": 121 })[date] ?? null;
    const result = compareSameMoney(
      [
        { date: "2025-01-01", amount: 1_000, tradeId: "a" },
        { date: "2025-02-01", amount: 1_100, tradeId: "b" },
      ],
      2_300,
      "2025-03-01",
      price,
    )!;
    // 10 units + 10 units = 20 units × 121 = 2,420 → profit 320 on 2,100 in.
    expect(result.moneyIn).toBe(2_100);
    expect(result.benchmarkProfit).toBeCloseTo(320, 6);
    expect(result.scopeProfit).toBeCloseTo(200, 6);
    expect(result.scopeReturn).toBeCloseTo(200 / 2_100, 10);
  });

  it("sells the benchmark when money leaves", () => {
    const price = () => 100;
    const result = compareSameMoney(
      [
        { date: "2025-01-01", amount: 1_000, tradeId: "a" },
        { date: "2025-02-01", amount: -400, tradeId: "b" },
      ],
      700,
      "2025-03-01",
      price,
    )!;
    expect(result.benchmarkProfit).toBeCloseTo(0, 6);
    expect(result.scopeProfit).toBeCloseTo(100, 6);
  });

  it("returns null without a benchmark price", () => {
    expect(compareSameMoney([{ date: "2025-01-01", amount: 1, tradeId: "a" }], 1, "2025-01-02", () => null)).toBeNull();
  });
});
