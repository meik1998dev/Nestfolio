import { describe, it, expect } from "vitest";
import type { Holding, Portfolio } from "@/lib/types";
import { buildPortfolioTree, rollupValues, type PortfolioNode } from "./tree";
import {
  rebalanceLevel,
  rebalanceTree,
  siblingTargetsValid,
  type RebalanceLevel,
} from "./rebalance";

// --- Fixtures (shared shape with tree.test.ts) ----------------------------

const USER = "user-1";
function pf(
  id: string,
  name: string,
  parentId: string | null = null,
  targetPct: number | null = null,
): Portfolio {
  return {
    id,
    user_id: USER,
    name,
    parent_id: parentId,
    target_pct: targetPct,
    created_at: "2026-01-01T00:00:00Z",
  };
}
let seq = 0;
function hold(portfolioId: string | null): Holding {
  seq += 1;
  return {
    id: `h-${seq}`,
    user_id: USER,
    portfolio_id: portfolioId,
    asset: `A${seq}`,
    amount: 1,
    source: "manual",
    wallet_ref: null,
    target_pct: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function levelFor(levels: RebalanceLevel[], parentId: string | null) {
  const l = levels.find((x) => x.parentId === parentId);
  if (!l) throw new Error(`no level for parent ${parentId}`);
  return l;
}
function entry(level: RebalanceLevel, id: string) {
  const e = level.children.find((c) => c.id === id);
  if (!e) throw new Error(`no entry ${id}`);
  return e;
}

/** Build + roll up a tree from rows and a {id: value} map. */
function tree(
  portfolios: Portfolio[],
  holdingValues: Array<[Holding, number]>,
): PortfolioNode[] {
  const holdings = holdingValues.map(([h]) => h);
  const values = new Map(holdingValues.map(([h, v]) => [h.id, v]));
  return rollupValues(buildPortfolioTree(portfolios, holdings), values);
}

// --- Single level, simple drift ------------------------------------------

describe("rebalanceLevel — relative-to-parent targets", () => {
  it("computes actual %, drift, and exact buy/sell to reach target", () => {
    // Parent worth $1000. Gold 70% target but only holds $600 → buy $100.
    // Crypto 30% target but holds $400 → sell $100. (Targets sum to 100.)
    const gold = hold("gold");
    const crypto = hold("crypto");
    const roots = tree(
      [pf("gold", "Gold", null, 70), pf("crypto", "Crypto", null, 30)],
      [
        [gold, 600],
        [crypto, 400],
      ],
    );
    const level = rebalanceLevel({
      id: null,
      name: "Total",
      totalValue: 1000,
      children: roots,
    });

    const g = entry(level, "gold");
    expect(g.actualPct).toBe(60);
    expect(g.targetPct).toBe(70);
    expect(g.driftPct).toBe(-10); // underweight by 10pp
    expect(g.targetValue).toBe(700);
    expect(g.deltaUSD).toBe(100); // buy $100
    expect(g.action).toBe("buy");

    const c = entry(level, "crypto");
    expect(c.actualPct).toBe(40);
    expect(c.driftPct).toBe(10);
    expect(c.deltaUSD).toBe(-100); // sell $100
    expect(c.action).toBe("sell");

    // Buys and sells net to zero — every buy funded by a sell.
    const net = level.children.reduce((s, e) => s + (e.deltaUSD ?? 0), 0);
    expect(Math.abs(net)).toBeLessThan(1e-9);
    expect(level.targetsValid).toBe(true);
    expect(level.targetSum).toBe(100);
  });

  it("marks an on-target child as hold (delta within epsilon)", () => {
    const a = hold("a");
    const b = hold("b");
    const roots = tree(
      [pf("a", "A", null, 50), pf("b", "B", null, 50)],
      [
        [a, 500],
        [b, 500],
      ],
    );
    const level = rebalanceLevel({
      id: null,
      name: "Total",
      totalValue: 1000,
      children: roots,
    });
    expect(entry(level, "a").action).toBe("hold");
    expect(entry(level, "a").driftPct).toBe(0);
  });

  it("flags sibling targets that don't sum to 100%", () => {
    const a = hold("a");
    const b = hold("b");
    const roots = tree(
      [pf("a", "A", null, 70), pf("b", "B", null, 20)], // sums to 90
      [
        [a, 500],
        [b, 500],
      ],
    );
    const level = rebalanceLevel({
      id: null,
      name: "Total",
      totalValue: 1000,
      children: roots,
    });
    expect(level.targetSum).toBe(90);
    expect(level.targetsValid).toBe(false);
  });

  it("is valid when no targets are set (nothing to enforce)", () => {
    const a = hold("a");
    const roots = tree([pf("a", "A")], [[a, 100]]);
    const level = rebalanceLevel({
      id: null,
      name: "Total",
      totalValue: 100,
      children: roots,
    });
    expect(level.targetsValid).toBe(true);
    expect(entry(level, "a").action).toBe("hold");
    expect(entry(level, "a").deltaUSD).toBeNull();
  });
});

// --- Edge cases -----------------------------------------------------------

describe("rebalanceLevel — edge cases", () => {
  it("single child at 100% with the parent's whole value → hold", () => {
    const a = hold("a");
    const roots = tree([pf("a", "A", null, 100)], [[a, 250]]);
    const level = rebalanceLevel({
      id: null,
      name: "Total",
      totalValue: 250,
      children: roots,
    });
    expect(entry(level, "a").action).toBe("hold");
    expect(entry(level, "a").deltaUSD).toBe(0);
  });

  it("zero-value parent yields null actual % but still a target of 0", () => {
    const a = hold("a");
    const roots = tree([pf("a", "A", null, 100)], [[a, 0]]);
    const level = rebalanceLevel({
      id: null,
      name: "Total",
      totalValue: 0,
      children: roots,
    });
    const e = entry(level, "a");
    expect(e.actualPct).toBeNull();
    expect(e.driftPct).toBeNull();
    expect(e.targetValue).toBe(0);
    expect(e.deltaUSD).toBe(0);
    expect(e.action).toBe("hold");
  });
});

// --- Recursive, all-levels (depth ≥ 3) -----------------------------------

describe("rebalanceTree — every level brought to target within rounding", () => {
  // Total $1000.
  //  Stocks target 60% → $600 (holds $700 across US/EU) → sell $100
  //  Crypto target 40% → $400 (holds $300) → buy $100
  // Inside Stocks ($700): US 80% → $560 (holds $500 → buy $60),
  //                       EU 20% → $140 (holds $200 → sell $60)
  // Inside US ($500): NVDA 60% → $300 (holds $350 → sell $50),
  //                   MSFT 40% → $200 (holds $150 → buy $50)
  function fixture() {
    const portfolios: Portfolio[] = [
      pf("stocks", "Stocks", null, 60),
      pf("crypto", "Crypto", null, 40),
      pf("us", "US", "stocks", 80),
      pf("eu", "EU", "stocks", 20),
      pf("nvda", "NVDA", "us", 60),
      pf("msft", "MSFT", "us", 40),
    ];
    const nvda = hold("nvda");
    const msft = hold("msft");
    const eu = hold("eu");
    const btc = hold("crypto");
    return tree(portfolios, [
      [nvda, 350],
      [msft, 150],
      [eu, 200],
      [btc, 300],
    ]);
  }

  it("produces a level per branch plus a synthetic top-level Total", () => {
    const levels = rebalanceTree(fixture());
    const parents = levels.map((l) => l.parentId);
    expect(parents).toContain(null); // Total
    expect(parents).toContain("stocks");
    expect(parents).toContain("us");
    // Leaves (nvda, msft, eu, crypto) have no children → no level.
    expect(parents).not.toContain("nvda");
  });

  it("top level: sell $100 Stocks, buy $100 Crypto", () => {
    const top = levelFor(rebalanceTree(fixture()), null);
    expect(top.parentValue).toBe(1000);
    expect(entry(top, "stocks").deltaUSD).toBe(-100);
    expect(entry(top, "stocks").action).toBe("sell");
    expect(entry(top, "crypto").deltaUSD).toBe(100);
    expect(entry(top, "crypto").action).toBe("buy");
  });

  it("within Stocks: buy $60 US, sell $60 EU", () => {
    const lvl = levelFor(rebalanceTree(fixture()), "stocks");
    expect(lvl.parentValue).toBe(700);
    expect(entry(lvl, "us").deltaUSD).toBeCloseTo(60, 9);
    expect(entry(lvl, "eu").deltaUSD).toBeCloseTo(-60, 9);
  });

  it("within US: sell $50 NVDA, buy $50 MSFT", () => {
    const lvl = levelFor(rebalanceTree(fixture()), "us");
    expect(lvl.parentValue).toBe(500);
    expect(entry(lvl, "nvda").deltaUSD).toBeCloseTo(-50, 9);
    expect(entry(lvl, "msft").deltaUSD).toBeCloseTo(50, 9);
  });

  it("at every level the post-trade value matches the target within rounding", () => {
    const levels = rebalanceTree(fixture());
    for (const level of levels) {
      for (const e of level.children) {
        if (e.targetValue == null) continue;
        const post = e.currentValue + (e.deltaUSD ?? 0);
        expect(post).toBeCloseTo(e.targetValue, 6);
      }
      // Within a fully-targeted level, trades net to zero.
      if (level.targetedChildren === level.children.length) {
        const net = level.children.reduce((s, e) => s + (e.deltaUSD ?? 0), 0);
        expect(Math.abs(net)).toBeLessThan(1e-6);
      }
    }
  });
});

describe("siblingTargetsValid", () => {
  it("accepts an empty / all-null set (no policy yet)", () => {
    expect(siblingTargetsValid([])).toBe(true);
    expect(siblingTargetsValid([null, null])).toBe(true);
  });
  it("accepts a set summing to 100, ignoring unset (null) siblings", () => {
    expect(siblingTargetsValid([70, 30])).toBe(true);
    // Nulls are treated as "unset" and excluded; the set ones still sum to 100.
    expect(siblingTargetsValid([60, 40, null])).toBe(true);
  });
  it("rejects a set that doesn't sum to 100", () => {
    expect(siblingTargetsValid([70, 20])).toBe(false);
    expect(siblingTargetsValid([50, 60])).toBe(false);
  });
});
