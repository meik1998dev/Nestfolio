/**
 * Future-wealth projection (S5.5) — pure compound-growth math.
 *
 * Given a starting net worth, a monthly savings rate, and an assumed annual
 * return, project the balance forward year by year. We compound MONTHLY (returns
 * applied to the running balance) and add the monthly contribution each month —
 * the standard future-value-of-an-annuity model, which is more honest than a
 * single annual compounding when there are ongoing deposits.
 *
 * Three scenarios (conservative / expected / optimistic) let the investor see a
 * realistic cone of outcomes. No IO — inputs are injected, output is a series.
 */

export type ScenarioKey = "conservative" | "expected" | "optimistic";

export interface ProjectionInputs {
  /** Net worth today. */
  startingNetWorth: number;
  /** Recurring amount saved/invested each month. */
  monthlySavings: number;
  /** Horizon in years (clamped to 1..50). */
  years: number;
  /** Assumed annual return per scenario, as fractions (0.07 = 7%). */
  returns: Record<ScenarioKey, number>;
}

/** One year's projected end-of-year balance per scenario. */
export interface ProjectionPoint {
  /** Years from now (0 = today, 1 = end of year 1, …). */
  year: number;
  conservative: number;
  expected: number;
  optimistic: number;
}

const SCENARIO_KEYS: ScenarioKey[] = ["conservative", "expected", "optimistic"];

/** Sensible default annual returns when the UI hasn't supplied any. */
export const DEFAULT_RETURNS: Record<ScenarioKey, number> = {
  conservative: 0.04,
  expected: 0.07,
  optimistic: 0.1,
};

/**
 * Project end-of-year balances for every scenario, inclusive of year 0 (today).
 * Monthly compounding: balance = balance × (1 + r/12) + monthlySavings.
 */
export function projectWealth(inputs: ProjectionInputs): ProjectionPoint[] {
  const years = clampInt(inputs.years, 1, 50);
  const monthly = inputs.monthlySavings;
  const start = inputs.startingNetWorth;

  // Running balance per scenario.
  const balances: Record<ScenarioKey, number> = {
    conservative: start,
    expected: start,
    optimistic: start,
  };

  const series: ProjectionPoint[] = [
    { year: 0, conservative: start, expected: start, optimistic: start },
  ];

  for (let y = 1; y <= years; y++) {
    for (const key of SCENARIO_KEYS) {
      const monthlyRate = inputs.returns[key] / 12;
      let b = balances[key];
      for (let m = 0; m < 12; m++) {
        b = b * (1 + monthlyRate) + monthly;
      }
      balances[key] = b;
    }
    series.push({
      year: y,
      conservative: balances.conservative,
      expected: balances.expected,
      optimistic: balances.optimistic,
    });
  }

  return series;
}

function clampInt(v: number, min: number, max: number): number {
  const n = Math.round(Number.isFinite(v) ? v : min);
  return Math.min(max, Math.max(min, n));
}
