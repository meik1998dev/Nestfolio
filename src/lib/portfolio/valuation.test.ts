import { describe, it, expect } from "vitest";
import type { Holding } from "@/lib/types";
import { tickerForAsset, computeHoldingValues, hasPrice } from "./valuation";

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
