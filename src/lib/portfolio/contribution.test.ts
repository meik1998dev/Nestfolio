import { describe, it, expect } from "vitest";
import {
  planContribution,
  slimContribTree,
  type ContribInputNode,
} from "./contribution";

// --- Fixtures -------------------------------------------------------------

/** Build a node with an optional value and children. */
function node(
  id: string,
  targetPct: number | null,
  value: number,
  children: ContribInputNode[] = [],
  depth = 0,
  parentId: string | null = null,
): ContribInputNode {
  return {
    id,
    name: id,
    depth,
    parentId,
    targetPct,
    // A parent's value is its own rolled-up total; for leaves it's `value`,
    // for parents we trust the caller to pass the sum of children.
    totalValue: children.length
      ? children.reduce((s, c) => s + c.totalValue, 0)
      : value,
    children,
  };
}

function entry(plan: ReturnType<typeof planContribution>, id: string) {
  const e = plan.entries.find((x) => x.id === id);
  if (!e) throw new Error(`no entry ${id}`);
  return e;
}

const ALMOST = 1e-6;

// --- Single level ---------------------------------------------------------

describe("planContribution — single level", () => {
  // Crypto 50% / Stocks 50%. Current: Crypto 600, Stocks 400 (total 1000).
  // Crypto is overweight (60%), Stocks underweight (40%).
  const roots = [node("crypto", 50, 600), node("stocks", 50, 400)];

  it("routes a small contribution to the underweight bucket only", () => {
    // newTotal = 1100; targets: 550 each. need: crypto 0, stocks 150.
    // C = 100 < totalNeed 150 → proportional to need → all 100 to stocks.
    const plan = planContribution(roots, 100);
    expect(entry(plan, "crypto").add).toBeCloseTo(0, 6);
    expect(entry(plan, "stocks").add).toBeCloseTo(100, 6);
    expect(plan.totalAllocated).toBeCloseTo(100, 6);
  });

  it("never suggests selling the overweight bucket", () => {
    const plan = planContribution(roots, 5000);
    expect(entry(plan, "crypto").add).toBeGreaterThanOrEqual(0);
    expect(entry(plan, "stocks").add).toBeGreaterThanOrEqual(0);
  });

  it("fills the gap then spreads the leftover by target weight", () => {
    // newTotal = 1400; targets 700 each. need: crypto 100, stocks 300 → 400.
    // C = 400 exactly closes both gaps; leftover 0. Result: both at 700 (50/50).
    const plan = planContribution(roots, 400);
    expect(entry(plan, "crypto").add).toBeCloseTo(100, 6);
    expect(entry(plan, "stocks").add).toBeCloseTo(300, 6);
    expect(entry(plan, "crypto").afterPct).toBeCloseTo(50, 6);
    expect(entry(plan, "stocks").afterPct).toBeCloseTo(50, 6);
  });

  it("spreads a balanced-already pot purely by target weight", () => {
    // Already 50/50 at target; extra cash keeps the ratio.
    const balanced = [node("a", 50, 500), node("b", 50, 500)];
    const plan = planContribution(balanced, 200);
    expect(entry(plan, "a").add).toBeCloseTo(100, 6);
    expect(entry(plan, "b").add).toBeCloseTo(100, 6);
  });

  it("reports how far short of target the contribution falls", () => {
    // C = 100, top-level need (at newTotal 1100) = 150 → short by 50.
    const plan = planContribution(roots, 100);
    expect(plan.topLevelShortfall).toBeCloseTo(50, 6);
    expect(plan.fullyFunds).toBe(false);
  });

  it("marks the plan fully funded when the cash covers every gap", () => {
    const plan = planContribution(roots, 400);
    expect(plan.topLevelShortfall).toBeCloseTo(0, 6);
    expect(plan.fullyFunds).toBe(true);
  });
});

// --- Edge cases -----------------------------------------------------------

describe("planContribution — edges", () => {
  const roots = [node("a", 60, 600), node("b", 40, 400)];

  it("returns an all-zero plan for a non-positive contribution", () => {
    for (const c of [0, -100, NaN, Infinity]) {
      const plan = planContribution(roots, c as number);
      expect(plan.totalAllocated).toBe(0);
      expect(plan.entries.every((e) => e.add === 0)).toBe(true);
    }
  });

  it("flags when no node carries a target", () => {
    const untargeted = [node("a", null, 600), node("b", null, 400)];
    const plan = planContribution(untargeted, 500);
    expect(plan.noTargets).toBe(true);
    // Nothing to push toward → no dollars allocated.
    expect(plan.totalAllocated).toBe(0);
  });

  it("excludes untargeted siblings from the split", () => {
    // a targeted (100%), b untargeted. All cash goes to a.
    const mixed = [node("a", 100, 100), node("b", null, 900)];
    const plan = planContribution(mixed, 200);
    expect(entry(plan, "a").add).toBeCloseTo(200, 6);
    expect(entry(plan, "b").add).toBe(0);
    expect(entry(plan, "b").untargeted).toBe(true);
  });

  it("computes drift from current share vs target", () => {
    const plan = planContribution(roots, 0);
    // a is 60% and target 60% → 0 drift; b 40%/40% → 0.
    expect(entry(plan, "a").driftPct).toBeCloseTo(0, 6);
  });
});

// --- Nested tree ----------------------------------------------------------

describe("planContribution — nested tree", () => {
  // Total 1000. Crypto 50% (currently 700 → overweight), Stocks 50% (300).
  // Inside Stocks: US 50% (200), EU 50% (100).
  const crypto = node("crypto", 50, 700, [], 0);
  const us = node("us", 50, 200, [], 1, "stocks");
  const eu = node("eu", 50, 100, [], 1, "stocks");
  const stocks = node("stocks", 50, 0, [us, eu], 0);
  const roots = [crypto, stocks];

  it("recurses the contribution down through sub-portfolios", () => {
    const plan = planContribution(roots, 200);
    // Top: newTotal 1200, targets 600 each. need crypto 0, stocks 300.
    // C 200 < 300 → all 200 to stocks. Crypto gets 0.
    expect(entry(plan, "crypto").add).toBeCloseTo(0, 6);
    expect(entry(plan, "stocks").add).toBeCloseTo(200, 6);
    // Stocks' 200 then splits across US/EU (newTotal 500, targets 250 each).
    // need US 50, EU 150 → 200 closes both. US +50, EU +150.
    expect(entry(plan, "us").add).toBeCloseTo(50, 6);
    expect(entry(plan, "eu").add).toBeCloseTo(150, 6);
  });

  it("keeps parents before their children in the flattened output", () => {
    const plan = planContribution(roots, 200);
    const ids = plan.entries.map((e) => e.id);
    expect(ids.indexOf("stocks")).toBeLessThan(ids.indexOf("us"));
    expect(ids.indexOf("stocks")).toBeLessThan(ids.indexOf("eu"));
  });
});

// --- Rounding -------------------------------------------------------------

describe("planContribution — rounding", () => {
  // A split that produces awkward thirds.
  const roots = [node("a", 34, 0), node("b", 33, 0), node("c", 33, 0)];

  it("rounds each add to whole dollars and still sums to the contribution", () => {
    const plan = planContribution(roots, 100, { round: 1 });
    for (const e of plan.entries) {
      expect(Number.isInteger(e.add)).toBe(true);
    }
    expect(plan.totalAllocated).toBeCloseTo(100, ALMOST);
  });

  it("leaves cents when rounding is off", () => {
    const plan = planContribution(roots, 100);
    expect(plan.totalAllocated).toBeCloseTo(100, 6);
  });
});

// --- slimContribTree ------------------------------------------------------

describe("slimContribTree", () => {
  it("strips a node forest to the serializable shape", () => {
    const roots = [node("a", 50, 0, [node("b", 100, 5, [], 1, "a")])];
    const slim = slimContribTree(roots);
    expect(slim[0]).toEqual({
      id: "a",
      name: "a",
      depth: 0,
      parentId: null,
      targetPct: 50,
      totalValue: 5,
      children: [
        {
          id: "b",
          name: "b",
          depth: 1,
          parentId: "a",
          targetPct: 100,
          totalValue: 5,
          children: [],
        },
      ],
    });
  });
});
