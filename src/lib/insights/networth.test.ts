import { describe, it, expect } from "vitest";
import type { Holding } from "@/lib/types";
import {
  computeNetWorth,
  toBreakdown,
  buildBreakdowns,
  assetClassForHolding,
} from "./networth";

function hold(
  id: string,
  asset: string,
  portfolio_id: string | null = null,
): Holding {
  return {
    id,
    user_id: "u",
    portfolio_id,
    asset,
    amount: 1,
    source: "manual",
    wallet_ref: null,
    target_pct: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("computeNetWorth", () => {
  it("equals the holdings value", () => {
    expect(computeNetWorth({ holdingsValue: 5000 })).toBe(5000);
  });
  it("is zero with no holdings", () => {
    expect(computeNetWorth({ holdingsValue: 0 })).toBe(0);
  });
});

describe("toBreakdown", () => {
  it("shares sum to 1 and slices sort largest-first", () => {
    const b = toBreakdown([
      { key: "a", label: "A", value: 30 },
      { key: "b", label: "B", value: 70 },
    ]);
    expect(b[0].key).toBe("b");
    expect(b.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
  });
  it("drops zero/negative rows and never produces NaN on empty total", () => {
    const b = toBreakdown([
      { key: "a", label: "A", value: 0 },
      { key: "b", label: "B", value: -5 },
    ]);
    expect(b).toHaveLength(0);
  });
});

describe("buildBreakdowns", () => {
  it("byAssetClass sums to total holdings value and shares sum to 1", () => {
    const holdings = [hold("h1", "BTC", "p1"), hold("h2", "NVDAon", "p1")];
    const holdingValues = new Map([
      ["h1", 4000],
      ["h2", 1000],
    ]);
    const portfolioNames = new Map([["p1", "Growth"]]);
    const { byAssetClass, byPortfolio } = buildBreakdowns({
      holdings,
      holdingValues,
      portfolioNames,
    });

    const classTotal = byAssetClass.reduce((s, x) => s + x.value, 0);
    expect(classTotal).toBe(5000); // 4000 crypto + 1000 stock
    expect(byAssetClass.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);

    // BTC → crypto, NVDAon → stock
    const crypto = byAssetClass.find((x) => x.key === "crypto");
    expect(crypto?.value).toBe(4000);

    // Both holdings in p1 → one portfolio slice labelled "Growth".
    expect(byPortfolio).toHaveLength(1);
    expect(byPortfolio[0].label).toBe("Growth");
    expect(byPortfolio[0].value).toBe(5000);
  });

  it("buckets unassigned holdings under 'Unassigned'", () => {
    const { byPortfolio } = buildBreakdowns({
      holdings: [hold("h1", "BTC", null)],
      holdingValues: new Map([["h1", 100]]),
      portfolioNames: new Map(),
    });
    expect(byPortfolio[0].label).toBe("Unassigned");
  });
});

describe("assetClassForHolding", () => {
  it("classifies known symbols", () => {
    expect(assetClassForHolding("btc")).toBe("crypto");
    expect(assetClassForHolding("XAU")).toBe("gold");
    expect(assetClassForHolding("USDC")).toBe("cash");
    expect(assetClassForHolding("AAPL")).toBe("stock");
    // PAXG is gold-backed — must bucket as gold, not stock.
    expect(assetClassForHolding("PAXG")).toBe("gold");
    expect(assetClassForHolding("paxg")).toBe("gold");
    // Tokenized stocks keep classifying as stock.
    expect(assetClassForHolding("NVDAon")).toBe("stock");
  });
});
