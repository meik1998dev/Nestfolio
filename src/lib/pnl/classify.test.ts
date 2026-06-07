import { describe, it, expect } from "vitest";
import {
  classifyTransfers,
  toDecimalAmount,
  type TransferLeg,
} from "./classify";

/** Build a transfer leg with sensible defaults (18-decimal tokens). */
function leg(
  over: Partial<TransferLeg> & Pick<TransferLeg, "direction">,
): TransferLeg {
  return {
    tx_hash: "0xtx",
    ts: "2026-06-01T00:00:00Z",
    token_symbol: "NVDAon",
    raw_amount: "1000000000000000000", // 1.0 @ 18 decimals
    decimals: 18,
    ...over,
  };
}

/** Encode a decimal amount into a base-unit integer string (no float drift). */
function units(amount: number, decimals = 18): string {
  return BigInt(Math.round(amount * 1e6)).toString() + "0".repeat(decimals - 6);
}

describe("toDecimalAmount", () => {
  it("scales by decimals", () => {
    expect(toDecimalAmount("1000000000000000000", 18)).toBe(1);
    expect(toDecimalAmount("500000", 6)).toBe(0.5);
  });
});

describe("classifyTransfers", () => {
  it("2-leg stock IN + stablecoin OUT → BUY (cost = USDT out)", () => {
    const { events } = classifyTransfers([
      leg({
        tx_hash: "0xbuy",
        direction: "in",
        token_symbol: "NVDAon",
        raw_amount: units(0.5),
      }),
      leg({
        tx_hash: "0xbuy",
        direction: "out",
        token_symbol: "USDT",
        raw_amount: units(200, 18),
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "buy",
      ticker: "NVDA",
      shares: 0.5,
      usdValue: 200,
    });
  });

  it("2-leg stablecoin IN + stock OUT → SELL (proceeds = USDT in)", () => {
    const { events } = classifyTransfers([
      leg({
        tx_hash: "0xsell",
        direction: "out",
        token_symbol: "METAon",
        raw_amount: units(0.2),
      }),
      leg({
        tx_hash: "0xsell",
        direction: "in",
        token_symbol: "USDT",
        raw_amount: units(86, 18),
      }),
    ]);
    expect(events[0]).toMatchObject({
      type: "sell",
      ticker: "META",
      shares: 0.2,
      usdValue: 86,
    });
  });

  it("1-leg stock IN only → DELIVERY (no usd value, priced later)", () => {
    const { events } = classifyTransfers([
      leg({
        tx_hash: "0xdel",
        direction: "in",
        token_symbol: "NVDAon",
        raw_amount: units(0.5),
      }),
    ]);
    expect(events[0]).toMatchObject({
      type: "delivery",
      ticker: "NVDA",
      shares: 0.5,
    });
    expect(events[0].usdValue).toBeUndefined();
  });

  it("1-leg stock OUT only → SEND", () => {
    const { events } = classifyTransfers([
      leg({
        tx_hash: "0xsend",
        direction: "out",
        token_symbol: "NVDAon",
        raw_amount: units(0.3),
      }),
    ]);
    expect(events[0]).toMatchObject({
      type: "send",
      ticker: "NVDA",
      shares: 0.3,
    });
    expect(events[0].usdValue).toBeUndefined();
  });

  it("1-leg stablecoin IN, no stock → DEPOSIT", () => {
    const { events } = classifyTransfers([
      leg({
        tx_hash: "0xdep",
        direction: "in",
        token_symbol: "USDT",
        raw_amount: units(299.99, 18),
      }),
    ]);
    expect(events[0].type).toBe("deposit");
    expect(events[0].shares).toBeCloseTo(299.99, 6);
    expect(events[0].usdValue).toBeCloseTo(299.99, 6);
  });

  it("ignores BNB gas legs when classifying", () => {
    const { events } = classifyTransfers([
      leg({
        tx_hash: "0xbuy",
        direction: "in",
        token_symbol: "NVDAon",
        raw_amount: units(0.5),
      }),
      leg({
        tx_hash: "0xbuy",
        direction: "out",
        token_symbol: "USDT",
        raw_amount: units(200, 18),
      }),
      leg({
        tx_hash: "0xbuy",
        direction: "out",
        token_symbol: "BNB",
        raw_amount: units(0.001),
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("buy");
  });

  it("returns events sorted chronologically", () => {
    const { events } = classifyTransfers([
      leg({
        tx_hash: "0xb",
        ts: "2026-06-03T00:00:00Z",
        direction: "in",
        token_symbol: "NVDAon",
        raw_amount: units(0.3),
      }),
      leg({
        tx_hash: "0xa",
        ts: "2026-06-01T00:00:00Z",
        direction: "in",
        token_symbol: "NVDAon",
        raw_amount: units(0.5),
      }),
    ]);
    expect(events.map((e) => e.ts)).toEqual([
      "2026-06-01T00:00:00Z",
      "2026-06-03T00:00:00Z",
    ]);
  });
});
