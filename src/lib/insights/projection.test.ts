import { describe, it, expect } from "vitest";
import { projectWealth, DEFAULT_RETURNS } from "./projection";

describe("projectWealth", () => {
  it("year 0 equals the starting net worth for all scenarios", () => {
    const s = projectWealth({
      startingNetWorth: 10000,
      monthlySavings: 0,
      years: 5,
      returns: DEFAULT_RETURNS,
    });
    expect(s[0]).toEqual({
      year: 0,
      conservative: 10000,
      expected: 10000,
      optimistic: 10000,
    });
  });

  it("matches closed-form monthly compounding with no contributions", () => {
    const r = 0.12;
    const s = projectWealth({
      startingNetWorth: 1000,
      monthlySavings: 0,
      years: 1,
      returns: { conservative: r, expected: r, optimistic: r },
    });
    // 1000 × (1 + 0.12/12)^12
    const expected = 1000 * Math.pow(1 + r / 12, 12);
    expect(s[1].expected).toBeCloseTo(expected, 6);
  });

  it("matches future-value-of-annuity with contributions, zero return", () => {
    const s = projectWealth({
      startingNetWorth: 0,
      monthlySavings: 100,
      years: 2,
      returns: { conservative: 0, expected: 0, optimistic: 0 },
    });
    // No growth: just 24 deposits of 100.
    expect(s[2].expected).toBeCloseTo(2400, 6);
  });

  it("orders scenarios optimistic ≥ expected ≥ conservative when returns differ", () => {
    const s = projectWealth({
      startingNetWorth: 5000,
      monthlySavings: 500,
      years: 10,
      returns: DEFAULT_RETURNS,
    });
    const last = s[s.length - 1];
    expect(last.optimistic).toBeGreaterThan(last.expected);
    expect(last.expected).toBeGreaterThan(last.conservative);
  });

  it("clamps the horizon and returns years+1 points", () => {
    const s = projectWealth({
      startingNetWorth: 100,
      monthlySavings: 0,
      years: 7,
      returns: DEFAULT_RETURNS,
    });
    expect(s).toHaveLength(8); // year 0 + 7 years
    expect(s[s.length - 1].year).toBe(7);
  });
});
