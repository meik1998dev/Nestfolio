import { describe, it, expect } from "vitest";
import type { Holding, Portfolio } from "@/lib/types";
import { buildPortfolioTree, rollupValues } from "./tree";
import {
  planContribution,
  buildContribTree,
  type ContribInputNode,
} from "./contribution";

// --- Fixtures -------------------------------------------------------------

/** Build a planner node with an optional value and children. */
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
    // Parent value is the sum of its children; leaves carry `value`.
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
  // Crypto overweight (60%), Stocks underweight (40%).
  const roots = [node("crypto", 50, 600), node("stocks", 50, 400)];

  it("routes a small contribution to the underweight bucket only", () => {
    // newTotal = 1100; targets 550 each. need: crypto 0, stocks 150.
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
    // C = 400 exactly closes both gaps → both land at 700 (50/50).
    const plan = planContribution(roots, 400);
    expect(entry(plan, "crypto").add).toBeCloseTo(100, 6);
    expect(entry(plan, "stocks").add).toBeCloseTo(300, 6);
    expect(entry(plan, "crypto").afterPct).toBeCloseTo(50, 6);
    expect(entry(plan, "stocks").afterPct).toBeCloseTo(50, 6);
  });

  it("spreads a balanced-already pot purely by target weight", () => {
    const balanced = [node("a", 50, 500), node("b", 50, 500)];
    const plan = planContribution(balanced, 200);
    expect(entry(plan, "a").add).toBeCloseTo(100, 6);
    expect(entry(plan, "b").add).toBeCloseTo(100, 6);
  });

  it("reports how far short of target the contribution falls", () => {
    const plan = planContribution(roots, 100);
    expect(plan.shortfall).toBeCloseTo(50, 6);
    expect(plan.fullyFunds).toBe(false);
  });

  it("marks the plan fully funded when the cash covers every gap", () => {
    const plan = planContribution(roots, 400);
    expect(plan.shortfall).toBeCloseTo(0, 6);
    expect(plan.fullyFunds).toBe(true);
  });
});

// --- Pass-through grouping nodes (the real-world shape) -------------------

describe("planContribution — pass-through grouping", () => {
  // A single untargeted root "Total" whose CHILDREN carry the targets — the
  // exact structure that produced the all-$0 bug.
  const total = node(
    "total",
    null,
    0,
    [
      node("crypto", 50, 600, [], 1, "total"),
      node("stocks", 50, 400, [], 1, "total"),
    ],
    0,
  );
  const roots = [total];

  it("flows cash through the untargeted root into the targeted children", () => {
    const plan = planContribution(roots, 200);
    // Top: only child "total" is untargeted → it receives the whole 200.
    expect(entry(plan, "total").add).toBeCloseTo(200, 6);
    expect(plan.totalAllocated).toBeCloseTo(200, 6);
    // Inside Total (newTotal 1200, targets 600 each): crypto 0, stocks 200.
    expect(entry(plan, "crypto").add).toBeCloseTo(0, 6);
    expect(entry(plan, "stocks").add).toBeCloseTo(200, 6);
  });

  it("does not flag fully-funded when an underweight gap remains", () => {
    // Inside Total: newTotal 1100, stocks gap 150; C is only 100 → short by 50.
    const plan = planContribution(roots, 100);
    expect(plan.fullyFunds).toBe(false);
    expect(plan.shortfall).toBeCloseTo(50, 6);
  });

  it("excludes an inert sibling (no target, no targeted descendant)", () => {
    // Add a Cash bucket with value but no target alongside targeted siblings.
    const withCash = node(
      "total",
      null,
      0,
      [
        node("cash", null, 50, [], 1, "total"),
        node("crypto", 50, 600, [], 1, "total"),
        node("stocks", 50, 400, [], 1, "total"),
      ],
      0,
    );
    const plan = planContribution([withCash], 200);
    expect(entry(plan, "cash").add).toBe(0);
    expect(entry(plan, "stocks").add).toBeGreaterThan(0);
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
  });

  it("computes drift from current share vs target", () => {
    const plan = planContribution(roots, 0);
    expect(entry(plan, "a").driftPct).toBeCloseTo(0, 6);
  });
});

// --- Nested tree ----------------------------------------------------------

describe("planContribution — nested tree", () => {
  const crypto = node("crypto", 50, 700, [], 0);
  const us = node("us", 50, 200, [], 1, "stocks");
  const eu = node("eu", 50, 100, [], 1, "stocks");
  const stocks = node("stocks", 50, 0, [us, eu], 0);
  const roots = [crypto, stocks];

  it("recurses the contribution down through sub-portfolios", () => {
    const plan = planContribution(roots, 200);
    expect(entry(plan, "crypto").add).toBeCloseTo(0, 6);
    expect(entry(plan, "stocks").add).toBeCloseTo(200, 6);
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
  const roots = [node("a", 34, 0), node("b", 33, 0), node("c", 33, 0)];

  it("rounds each add to whole dollars and still sums to the contribution", () => {
    const plan = planContribution(roots, 100, { round: 1 });
    for (const e of plan.entries) expect(Number.isInteger(e.add)).toBe(true);
    expect(plan.totalAllocated).toBeCloseTo(100, ALMOST);
  });

  it("leaves cents when rounding is off", () => {
    const plan = planContribution(roots, 100);
    expect(plan.totalAllocated).toBeCloseTo(100, 6);
  });
});

// --- buildContribTree (holdings folded in as leaves) ----------------------

describe("buildContribTree", () => {
  const USER = "u1";
  const pf = (
    id: string,
    parentId: string | null,
    targetPct: number | null,
  ): Portfolio => ({
    id,
    user_id: USER,
    name: id,
    parent_id: parentId,
    target_pct: targetPct,
    targets_enabled: true,
    created_at: "2026-01-01T00:00:00Z",
  });
  const hold = (
    id: string,
    portfolioId: string,
    asset: string,
    targetPct: number | null,
  ): Holding => ({
    id,
    user_id: USER,
    portfolio_id: portfolioId,
    asset,
    amount: 1,
    source: "manual",
    wallet_ref: null,
    target_pct: targetPct,
    created_at: "2026-01-01T00:00:00Z",
  });

  it("folds holdings in as leaves so cash reaches individual assets", () => {
    // Stocks sleeve with two untargeted holdings (NVDA 600, AAPL 400).
    const portfolios = [pf("stocks", null, null)];
    const holdings = [
      hold("h-nvda", "stocks", "NVDA", null),
      hold("h-aapl", "stocks", "AAPL", null),
    ];
    const values = new Map([
      ["h-nvda", 600],
      ["h-aapl", 400],
    ]);
    const tree = rollupValues(buildPortfolioTree(portfolios, holdings), values);
    const contribTree = buildContribTree(tree, values);

    const plan = planContribution(contribTree, 100);
    // Stocks is untargeted → pass-through gets the full 100, then its holdings
    // (no targets) split pro-rata by value: NVDA 60, AAPL 40.
    expect(entry(plan, "stocks").add).toBeCloseTo(100, 6);
    expect(entry(plan, "h-nvda").add).toBeCloseTo(60, 6);
    expect(entry(plan, "h-aapl").add).toBeCloseTo(40, 6);
  });

  it("respects per-holding targets when set", () => {
    // NVDA target 25%, AAPL 75%; currently 600/400 (60/40) → AAPL underweight.
    const portfolios = [pf("stocks", null, null)];
    const holdings = [
      hold("h-nvda", "stocks", "NVDA", 25),
      hold("h-aapl", "stocks", "AAPL", 75),
    ];
    const values = new Map([
      ["h-nvda", 600],
      ["h-aapl", 400],
    ]);
    const tree = rollupValues(buildPortfolioTree(portfolios, holdings), values);
    const plan = planContribution(buildContribTree(tree, values), 200);
    // newTotal 1200: NVDA target 300 (over → 0), AAPL target 900 (need 500).
    // C 200 < 500 → all 200 to AAPL.
    expect(entry(plan, "h-aapl").add).toBeCloseTo(200, 6);
    expect(entry(plan, "h-nvda").add).toBeCloseTo(0, 6);
  });
});

// --- Per-portfolio target switch ------------------------------------------

describe("buildContribTree — targets_enabled switch", () => {
  it("drops the targets inside a switched-off portfolio only", () => {
    const base = {
      user_id: "u1",
      target_pct: null as number | null,
      targets_enabled: true,
      created_at: "2026-01-01T00:00:00Z",
    };
    const portfolios: Portfolio[] = [
      { ...base, id: "root", name: "root", parent_id: null },
      {
        ...base,
        id: "off",
        name: "off",
        parent_id: "root",
        target_pct: 40,
        targets_enabled: false,
      },
      { ...base, id: "child", name: "child", parent_id: "off", target_pct: 70 },
    ];
    const holdings: Holding[] = [
      {
        id: "h1",
        user_id: "u1",
        portfolio_id: "off",
        asset: "NVDA",
        amount: 1,
        source: "manual",
        wallet_ref: null,
        target_pct: 30,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    const values = new Map([["h1", 100]]);
    const tree = buildContribTree(
      rollupValues(buildPortfolioTree(portfolios, holdings), values),
      values,
    );
    const off = tree[0].children.find((c) => c.id === "off")!;
    // Its own target (owned by root, which is on) survives…
    expect(off.targetPct).toBe(40);
    // …but everything inside it reads as untargeted.
    expect(off.children.find((c) => c.id === "child")!.targetPct).toBeNull();
    expect(off.children.find((c) => c.id === "h1")!.targetPct).toBeNull();
  });
});
