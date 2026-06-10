import { describe, it, expect } from "vitest";
import type { Holding } from "@/lib/types";
import {
  tickerForAsset,
  computeHoldingValues,
  hasPrice,
  isDisplaySpam,
  excludeDisplaySpam,
} from "./valuation";

function hold(asset: string, amount: number, id = asset): Holding {
  return {
    id,
    user_id: "u",
    portfolio_id: null,
    asset,
    amount,
    source: "manual",
    wallet_ref: null,
    target_pct: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

describe("tickerForAsset", () => {
  it("strips a trailing 'on' from tokenized stocks", () => {
    expect(tickerForAsset("NVDAon")).toBe("NVDA");
    expect(tickerForAsset("MSFTon")).toBe("MSFT");
  });
  it("uppercases and passes through plain symbols", () => {
    expect(tickerForAsset("btc")).toBe("BTC");
    expect(tickerForAsset("XAU")).toBe("XAU");
  });
  it("does not strip when it would leave too short a symbol", () => {
    expect(tickerForAsset("ON")).toBe("ON");
  });
});

describe("computeHoldingValues", () => {
  const prices = new Map([
    ["NVDA", 100],
    ["BTC", 50_000],
  ]);

  it("values amount × price using the derived ticker", () => {
    const values = computeHoldingValues([hold("NVDAon", 3)], prices);
    expect(values.get("NVDAon")).toBe(300);
  });

  it("falls back to the raw symbol when the derived one isn't priced", () => {
    const values = computeHoldingValues([hold("BTC", 0.5)], prices);
    expect(values.get("BTC")).toBe(25_000);
  });

  it("values unknown / unpriced assets at 0 without throwing", () => {
    const values = computeHoldingValues([hold("DOGE", 1000)], prices);
    expect(values.get("DOGE")).toBe(0);
  });

  it("returns 0s for an empty price table (F4 not populated yet)", () => {
    const values = computeHoldingValues([hold("NVDAon", 3)], new Map());
    expect(values.get("NVDAon")).toBe(0);
  });
});

describe("hasPrice", () => {
  const prices = new Map([["NVDA", 100]]);
  it("is true when the derived ticker is priced", () => {
    expect(hasPrice(hold("NVDAon", 1), prices)).toBe(true);
  });
  it("is false when neither derived nor raw symbol is priced", () => {
    expect(hasPrice(hold("DOGE", 1), prices)).toBe(false);
  });
});

describe("isDisplaySpam", () => {
  it("flags unresolvable airdrop tokens as spam", () => {
    expect(isDisplaySpam("世界杯")).toBe(true);
    expect(isDisplaySpam("币安人生%202.0")).toBe(true);
    expect(isDisplaySpam("Apple")).toBe(true); // not AAPLon → unresolvable
  });
  it("never flags an asset the user has actually traded", () => {
    // Every real position resolves: gold, crypto, stablecoins, tokenized stocks.
    for (const a of ["PAXG", "XAU", "BTC", "BNB", "USDT", "NVDAon", "AAPLon"]) {
      expect(isDisplaySpam(a)).toBe(false);
    }
  });
});

describe("excludeDisplaySpam", () => {
  it("drops only spam, preserving real holdings (and their P&L)", () => {
    const kept = excludeDisplaySpam([
      hold("PAXG", 5),
      hold("世界杯", 2000),
      hold("NVDAon", 1),
      hold("宝贝狗", 2000),
    ]);
    expect(kept.map((h) => h.asset)).toEqual(["PAXG", "NVDAon"]);
  });
});
