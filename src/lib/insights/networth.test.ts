import { describe, it, expect } from "vitest";
import type { Account, Holding } from "@/lib/types";
import {
  computeNetWorth,
  totalAssets,
  toBreakdown,
  buildBreakdowns,
  sumLiabilities,
  momChange,
  assetClassForHolding,
} from "./networth";

function acct(id: string, type: Account["type"], name = id): Account {
  return {
    id,
    user_id: "u",
    name,
    type,
    currency: "USD",
    created_at: "2026-01-01T00:00:00Z",
  };
}

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
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("computeNetWorth", () => {
  it("is cash + holdings − liabilities", () => {
    expect(
      computeNetWorth({ cash: 1000, holdingsValue: 5000, liabilities: 2000 }),
    ).toBe(4000);
  });
  it("can go negative when debts exceed assets", () => {
    expect(
      computeNetWorth({ cash: 0, holdingsValue: 100, liabilities: 500 }),
    ).toBe(-400);
  });
  it("totalAssets excludes liabilities", () => {
    expect(
      totalAssets({ cash: 1000, holdingsValue: 5000, liabilities: 2000 }),
    ).toBe(6000);
  });
  it("reconciles: assets − liabilities == net worth", () => {
    const inputs = {
      cash: 1234.56,
      holdingsValue: 7890.12,
      liabilities: 345.6,
    };
    expect(totalAssets(inputs) - inputs.liabilities).toBeCloseTo(
      computeNetWorth(inputs),
      9,
    );
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
  it("byAssetClass sums to total assets and shares sum to 1", () => {
    const accounts = [
      { account: acct("c1", "cash"), balance: 1000 },
      { account: acct("s1", "stock"), balance: 0 },
    ];
    const holdings = [hold("h1", "BTC", "p1"), hold("h2", "NVDAon", "p1")];
    const holdingValues = new Map([
      ["h1", 4000],
      ["h2", 1000],
    ]);
    const portfolioNames = new Map([["p1", "Growth"]]);
    const { byAssetClass, byPortfolio } = buildBreakdowns({
      accounts,
      holdings,
      holdingValues,
      portfolioNames,
    });

    const classTotal = byAssetClass.reduce((s, x) => s + x.value, 0);
    expect(classTotal).toBe(6000); // 1000 cash + 4000 crypto + 1000 stock
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
      accounts: [],
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

describe("sumLiabilities", () => {
  it("sums balances", () => {
    expect(
      sumLiabilities([
        {
          id: "1",
          user_id: "u",
          name: "Loan",
          balance: 5000,
          type: "loan",
          created_at: "",
        },
        {
          id: "2",
          user_id: "u",
          name: "Card",
          balance: 1200,
          type: "credit",
          created_at: "",
        },
      ]),
    ).toBe(6200);
  });
});

describe("momChange", () => {
  it("returns null when there is no prior snapshot", () => {
    expect(momChange(1000, null)).toBeNull();
  });
  it("computes absolute and pct change", () => {
    const c = momChange(1100, {
      netWorth: 1000,
      takenAt: "2026-05-01T00:00:00Z",
    });
    expect(c?.absolute).toBe(100);
    expect(c?.pct).toBeCloseTo(0.1, 9);
  });
  it("guards division by zero", () => {
    const c = momChange(500, { netWorth: 0, takenAt: "2026-05-01T00:00:00Z" });
    expect(c?.pct).toBe(0);
  });
});
