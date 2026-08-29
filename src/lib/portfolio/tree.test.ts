import { describe, it, expect } from "vitest";
import type { Holding, Portfolio } from "@/lib/types";
import {
  buildPortfolioTree,
  rollupValues,
  flattenTree,
  totalAssignedValue,
  type PortfolioNode,
} from "./tree";

// --- Fixtures -------------------------------------------------------------

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
    targets_enabled: true,
    created_at: "2026-01-01T00:00:00Z",
  };
}

let seq = 0;
function hold(asset: string, portfolioId: string | null): Holding {
  seq += 1;
  return {
    id: `h-${seq}`,
    user_id: USER,
    portfolio_id: portfolioId,
    asset,
    amount: 1,
    source: "manual",
    wallet_ref: null,
    target_pct: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function find(roots: PortfolioNode[], id: string): PortfolioNode {
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    stack.push(...n.children);
  }
  throw new Error(`node ${id} not found`);
}

// --- A depth-3 worked example --------------------------------------------
//
// Total
//  ├─ Stocks
//  │   ├─ US
//  │   │   ├─ NVDA  ($300)
//  │   │   └─ MSFT  ($200)
//  │   └─ EU
//  │       └─ ASML  ($100)
//  └─ Crypto
//      ├─ BTC  ($400)
//      └─ ETH  ($100)
//
// Holdings live on the LEAF portfolios. Rollups:
//  US = 500, EU = 100, Stocks = 600, Crypto = 500, roots total = 1100.

function depth3Fixture() {
  const portfolios: Portfolio[] = [
    pf("stocks", "Stocks", null, 60),
    pf("crypto", "Crypto", null, 40),
    pf("us", "US", "stocks", 80),
    pf("eu", "EU", "stocks", 20),
    pf("btc", "BTC", "crypto", 80),
    pf("eth", "ETH", "crypto", 20),
    pf("nvda", "NVDA", "us", 60),
    pf("msft", "MSFT", "us", 40),
    pf("asml", "ASML", "eu", 100),
  ];
  const holdings: Holding[] = [
    hold("NVDAon", "nvda"),
    hold("MSFTon", "msft"),
    hold("ASMLon", "asml"),
    hold("BTC", "btc"),
    hold("ETH", "eth"),
  ];
  const values = new Map<string, number>();
  values.set(holdings[0].id, 300); // NVDA
  values.set(holdings[1].id, 200); // MSFT
  values.set(holdings[2].id, 100); // ASML
  values.set(holdings[3].id, 400); // BTC
  values.set(holdings[4].id, 100); // ETH
  return { portfolios, holdings, values };
}

describe("buildPortfolioTree", () => {
  it("builds a depth-3 tree with correct parent/child structure and depth", () => {
    const { portfolios, holdings } = depth3Fixture();
    const roots = buildPortfolioTree(portfolios, holdings);

    expect(roots.map((r) => r.id).sort()).toEqual(["crypto", "stocks"]);
    expect(find(roots, "stocks").depth).toBe(0);
    expect(find(roots, "us").depth).toBe(1);
    expect(find(roots, "nvda").depth).toBe(2);
    expect(
      find(roots, "us")
        .children.map((c) => c.id)
        .sort(),
    ).toEqual(["msft", "nvda"]);
  });

  it("attaches holdings to their owning node only (not descendants)", () => {
    const { portfolios, holdings } = depth3Fixture();
    const roots = buildPortfolioTree(portfolios, holdings);
    expect(find(roots, "nvda").holdings).toHaveLength(1);
    expect(find(roots, "stocks").holdings).toHaveLength(0); // value comes from children
  });

  it("treats holdings with no/unknown portfolio as unassigned (not attached)", () => {
    const portfolios = [pf("a", "A")];
    const holdings = [hold("X", null), hold("Y", "missing")];
    const roots = buildPortfolioTree(portfolios, holdings);
    expect(find(roots, "a").holdings).toHaveLength(0);
  });
});

describe("rollupValues — depth ≥ 3", () => {
  it("rolls up own holdings + children recursively at every node", () => {
    const { portfolios, holdings, values } = depth3Fixture();
    const roots = rollupValues(
      buildPortfolioTree(portfolios, holdings),
      values,
    );

    expect(find(roots, "us").totalValue).toBe(500);
    expect(find(roots, "eu").totalValue).toBe(100);
    expect(find(roots, "stocks").totalValue).toBe(600);
    expect(find(roots, "crypto").totalValue).toBe(500);
    expect(totalAssignedValue(roots)).toBe(1100);

    // Leaf ownValue equals its single holding's value.
    expect(find(roots, "nvda").ownValue).toBe(300);
    // Branch ownValue is 0 (no direct holdings) but totalValue rolls up.
    expect(find(roots, "stocks").ownValue).toBe(0);
  });

  it("counts holdings attached directly to a branch alongside its children", () => {
    // Stocks holds $50 of a cash sleeve directly, plus its children.
    const { portfolios, holdings, values } = depth3Fixture();
    const cash = hold("USDC", "stocks");
    holdings.push(cash);
    values.set(cash.id, 50);
    const roots = rollupValues(
      buildPortfolioTree(portfolios, holdings),
      values,
    );
    expect(find(roots, "stocks").ownValue).toBe(50);
    expect(find(roots, "stocks").totalValue).toBe(650); // 600 + 50
  });

  it("values missing prices as 0 without crashing", () => {
    const portfolios = [pf("a", "A")];
    const holdings = [hold("X", "a")];
    const roots = rollupValues(
      buildPortfolioTree(portfolios, holdings),
      new Map(), // no prices at all
    );
    expect(find(roots, "a").totalValue).toBe(0);
  });

  it("handles a single-node tree with one holding", () => {
    const portfolios = [pf("a", "A")];
    const h = hold("BTC", "a");
    const roots = rollupValues(
      buildPortfolioTree(portfolios, [h]),
      new Map([[h.id, 1234.56]]),
    );
    expect(find(roots, "a").totalValue).toBe(1234.56);
  });
});

describe("cycle guard", () => {
  it("detaches a self-parented node into a root (no infinite tree)", () => {
    const portfolios = [pf("a", "A", "a")]; // a is its own parent
    const roots = buildPortfolioTree(portfolios, []);
    expect(roots.map((r) => r.id)).toEqual(["a"]);
    expect(find(roots, "a").children).toHaveLength(0);
  });

  it("breaks a two-node cycle so the build terminates", () => {
    // a → b → a. Both reference each other; neither may nest under the other.
    const portfolios = [pf("a", "A", "b"), pf("b", "B", "a")];
    const roots = buildPortfolioTree(portfolios, []);
    // Build must terminate and surface both nodes (as roots, cycle broken).
    const ids = flattenTree(roots)
      .map((n) => n.id)
      .sort();
    expect(ids).toEqual(["a", "b"]);
  });
});

describe("flattenTree", () => {
  it("returns nodes depth-first, parents before children", () => {
    const { portfolios, holdings } = depth3Fixture();
    const roots = buildPortfolioTree(portfolios, holdings);
    const order = flattenTree(roots).map((n) => n.id);
    // crypto sorts before stocks; each parent precedes its descendants.
    expect(order.indexOf("crypto")).toBeLessThan(order.indexOf("btc"));
    expect(order.indexOf("stocks")).toBeLessThan(order.indexOf("us"));
    expect(order.indexOf("us")).toBeLessThan(order.indexOf("nvda"));
  });
});
