import { describe, it, expect } from "vitest";
import { reconcileCash } from "./reconcile";
import type { TradeEventInput } from "./classify";

function ev(
  over: Partial<TradeEventInput> & Pick<TradeEventInput, "type">,
): TradeEventInput {
  return {
    ticker: "NVDA",
    shares: 1,
    ts: "2026-06-01T00:00:00Z",
    tx_hash: "0x",
    ...over,
  };
}

describe("reconcileCash — validated worked example", () => {
  // 299.99 deposited − 395.86 buys + 395.86 sells == 299.99 balance ✓
  const events: TradeEventInput[] = [
    ev({ type: "deposit", ticker: "USDT", shares: 299.99, usdValue: 299.99 }),
    ev({ type: "buy", usdValue: 395.86 }),
    ev({ type: "sell", usdValue: 395.86 }),
  ];

  it("passes to the cent against the real USDT balance", () => {
    const r = reconcileCash(events, 299.99);
    expect(r.pass).toBe(true);
    expect(r.deposited).toBeCloseTo(299.99, 2);
    expect(r.spentOnBuys).toBeCloseTo(395.86, 2);
    expect(r.fromSells).toBeCloseTo(395.86, 2);
    expect(r.expectedBalance).toBeCloseTo(299.99, 2);
    expect(r.difference).toBeLessThanOrEqual(0.01);
  });

  it("fails loudly on tampered data", () => {
    // Drop a sell leg → cash no longer ties out.
    const tampered = events.filter((e) => !(e.type === "sell"));
    const r = reconcileCash(tampered, 299.99);
    expect(r.pass).toBe(false);
    expect(r.expectedBalance).toBeCloseTo(299.99 - 395.86, 2);
    expect(r.difference).toBeGreaterThan(0.01);
  });

  it("delivery/send do not move on-chain cash", () => {
    const r = reconcileCash(
      [
        ev({ type: "deposit", ticker: "USDT", shares: 100, usdValue: 100 }),
        ev({ type: "delivery", shares: 1 }),
        ev({ type: "send", shares: 1 }),
      ],
      100,
    );
    expect(r.pass).toBe(true);
    expect(r.spentOnBuys).toBe(0);
    expect(r.fromSells).toBe(0);
  });
});
