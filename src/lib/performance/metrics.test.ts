import { describe, expect, it } from "vitest";
import type { TradeEventInput } from "@/lib/pnl/classify";
import {
  annualizeReturn,
  buildDailyReturnSeries,
  calculateAnnualizedVolatility,
  calculateHistoricalValueAtRisk,
  calculateDailyReturns,
  calculateMaxDrawdown,
  calculateMoneyWeightedReturn,
  calculateTimeWeightedReturn,
  extractExternalCashFlows,
  metricReadiness,
  riskWindow,
  type DailyReturnPoint,
} from "./metrics";

const prices = (values: Record<string, number>) => (_ticker: string, date: string) =>
  values[date] ?? null;

function trade(overrides: Partial<TradeEventInput>): TradeEventInput {
  return {
    type: "buy",
    ticker: "TEST",
    shares: 1,
    usdValue: 100,
    ts: "2025-01-01",
    tx_hash: "trade-1",
    ...overrides,
  };
}

describe("external cash flows", () => {
  it("uses costs in and proceeds out, while ignoring deposits", () => {
    const lookup = prices({ "2025-01-02": 120, "2025-01-04": 130 });
    expect(
      extractExternalCashFlows(
        [
          trade({ type: "buy", usdValue: 100, tx_hash: "buy" }),
          trade({ type: "delivery", usdValue: undefined, ts: "2025-01-02", tx_hash: "delivery" }),
          trade({ type: "sell", usdValue: 125, ts: "2025-01-03", tx_hash: "sell" }),
          trade({ type: "send", usdValue: undefined, ts: "2025-01-04", tx_hash: "send" }),
          trade({ type: "deposit", ticker: "USDT", usdValue: 500, ts: "2025-01-05", tx_hash: "deposit" }),
        ],
        lookup,
      ).map(({ date, amount }) => ({ date, amount })),
    ).toEqual([
      { date: "2025-01-01", amount: 100 },
      { date: "2025-01-02", amount: 120 },
      { date: "2025-01-03", amount: -125 },
      { date: "2025-01-04", amount: -130 },
    ]);
  });
});

describe("daily time-weighted returns", () => {
  it("removes a new buy from that day's gain", () => {
    const series = buildDailyReturnSeries({
      events: [
        trade({ shares: 1, usdValue: 100 }),
        trade({ shares: 1, usdValue: 100, ts: "2025-01-02", tx_hash: "trade-2" }),
      ],
      start: "2025-01-01",
      end: "2025-01-02",
      price: prices({ "2025-01-01": 100, "2025-01-02": 100 }),
    });
    expect(series[0].dailyReturn).toBeCloseTo(0, 10);
    expect(series[1].dailyReturn).toBeCloseTo(0, 10);
  });

  it("matches a hand-checked two-period return: +10%, then -10% = -1%", () => {
    const series: DailyReturnPoint[] = [
      { date: "2025-01-01", value: 100, externalCashFlow: 100, dailyReturn: 0, growth: 1 },
      { date: "2025-01-02", value: 110, externalCashFlow: 0, dailyReturn: 0.1, growth: 1.1 },
      { date: "2025-01-03", value: 99, externalCashFlow: 0, dailyReturn: -0.1, growth: 0.99 },
    ];
    expect(calculateTimeWeightedReturn(series)).toBeCloseTo(-0.01, 10);
  });

  it("does not divide an existing portfolio by a small first-day buy", () => {
    const result = calculateDailyReturns({
      events: [
        trade({ shares: 1, usdValue: 100, ts: "2024-12-01", tx_hash: "old-buy" }),
        trade({ shares: 0.01, usdValue: 1, ts: "2025-01-01", tx_hash: "small-buy" }),
      ],
      start: "2025-01-01",
      end: "2025-04-01",
      price: () => 100,
    });
    expect(result.series[0].value).toBeCloseTo(101, 10);
    expect(result.series[0].dailyReturn).toBe(0);
    expect(result.timeWeightedReturn).toBeCloseTo(0, 10);
    expect(result.moneyWeightedReturn.annual).toBeCloseTo(0, 10);
  });
});

describe("money-weighted return", () => {
  it("matches a spreadsheet case: $1,000 becomes $1,100 in one year", () => {
    const result = calculateMoneyWeightedReturn(
      [{ date: "2024-01-01", amount: 1_000, tradeId: "buy" }],
      "2025-01-01",
      1_100,
      366,
    );
    expect(result.status).toBe("ready");
    expect(result.annual).toBeCloseTo(0.0997136, 6);
    expect(result.monthly).toBeCloseTo((1.0997136) ** (1 / 12) - 1, 6);
    // 366 days of the annual rate lands back on the plain 10% the money made.
    expect(result.period).toBeCloseTo(0.1, 6);
  });

  it("waits until the window is 30 days", () => {
    expect(calculateMoneyWeightedReturn([], "2025-01-10", 0, 9).reason).toBe("short-window");
  });
});

describe("risk metrics and readiness", () => {
  const series: DailyReturnPoint[] = [
    { date: "2025-01-01", value: 100, externalCashFlow: 0, dailyReturn: 0, growth: 1 },
    { date: "2025-01-02", value: 120, externalCashFlow: 0, dailyReturn: 0.2, growth: 1.2 },
    { date: "2025-01-03", value: 90, externalCashFlow: 0, dailyReturn: -0.25, growth: 0.9 },
    { date: "2025-01-06", value: 125, externalCashFlow: 0, dailyReturn: 125 / 90 - 1, growth: 1.25 },
  ];

  it("finds max drawdown dates and recovery", () => {
    expect(calculateMaxDrawdown(series)).toEqual({
      value: -0.25,
      peakDate: "2025-01-02",
      troughDate: "2025-01-03",
      recovered: true,
    });
  });

  it("annualizes sample daily volatility using 252 trading days", () => {
    const expectedReturns = [0.2, -0.25, 125 / 90 - 1];
    const mean = expectedReturns.reduce((sum, value) => sum + value, 0) / 3;
    const sampleVariance = expectedReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 2;
    expect(calculateAnnualizedVolatility(series)).toBeCloseTo(Math.sqrt(sampleVariance) * Math.sqrt(252), 10);
  });

  it("uses the historical 5th percentile for 1-day value at risk", () => {
    const points: DailyReturnPoint[] = [
      { date: "2025-01-01", value: 100, externalCashFlow: 0, dailyReturn: 0, growth: 1 },
      ...Array.from({ length: 20 }, (_, index) => {
        const date = new Date("2025-01-02T00:00:00Z");
        date.setUTCDate(date.getUTCDate() + index + Math.floor(index / 5) * 2);
        const dailyReturn = index === 0 ? -0.08 : index === 1 ? -0.03 : 0.01;
        return {
          date: date.toISOString().slice(0, 10),
          value: 100,
          externalCashFlow: 0,
          dailyReturn,
          growth: 1,
        };
      }),
    ];
    expect(calculateHistoricalValueAtRisk(points)).toBeCloseTo(-0.08, 10);
  });

  it("keeps all readiness limits in the shared table", () => {
    expect(metricReadiness(59)).toBe("waiting");
    expect(metricReadiness(60)).toBe("low-confidence");
    expect(metricReadiness(120)).toBe("ready");
    expect(annualizeReturn(0.1, 89)).toBeNull();
    expect(annualizeReturn(0.1, 365)).toBeCloseTo(0.1, 10);
  });
});

describe("risk window", () => {
  const point = (date: string, value: number): DailyReturnPoint => ({
    date,
    value,
    externalCashFlow: 0,
    dailyReturn: 0,
    growth: 1,
  });

  it("starts on the first day the scope is worth the minimum", () => {
    const series = [point("2025-01-01", 160), point("2025-01-02", 499), point("2025-01-03", 500), point("2025-01-04", 450)];
    expect(riskWindow(series).map((p) => p.date)).toEqual(["2025-01-03", "2025-01-04"]);
  });

  it("is empty while the scope stays small", () => {
    expect(riskWindow([point("2025-01-01", 100)])).toEqual([]);
  });
});

describe("full daily engine", () => {
  it("returns one daily point and all headline metrics", () => {
    const result = calculateDailyReturns({
      events: [trade({})],
      start: "2025-01-01",
      end: "2025-05-01",
      price: () => 110,
    });
    expect(result.series).toHaveLength(121);
    expect(result.timeWeightedReturn).toBeCloseTo(0, 10);
    expect(result.annualizedTimeWeightedReturn).not.toBeNull();
    expect(result.moneyWeightedReturn.status).toBe("ready");
    expect(result.readiness).toBe("ready");
  });
});
