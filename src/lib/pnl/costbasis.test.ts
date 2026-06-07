import { describe, it, expect } from "vitest";
import {
  buildLedger,
  positionPnl,
  rollup,
  type HistPriceLookup,
} from "./costbasis";
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

describe("buildLedger — validated worked example", () => {
  // deliver 0.5@400, deliver 0.3@420, sell 0.2@430, live 416.67
  // → realized +4.50, unrealized +5.50, total +10.00
  const hist: HistPriceLookup = (_t, date) =>
    date === "2026-06-01" ? 400 : date === "2026-06-02" ? 420 : null;

  const events: TradeEventInput[] = [
    ev({
      type: "delivery",
      shares: 0.5,
      ts: "2026-06-01T00:00:00Z",
      tx_hash: "0xd1",
    }),
    ev({
      type: "delivery",
      shares: 0.3,
      ts: "2026-06-02T00:00:00Z",
      tx_hash: "0xd2",
    }),
    ev({
      type: "sell",
      shares: 0.2,
      usdValue: 86,
      ts: "2026-06-03T00:00:00Z",
      tx_hash: "0xs1",
    }),
  ];

  it("reproduces realized +4.50 and remaining cost", () => {
    const [pos] = buildLedger(events, hist);
    // cost 0.5*400 + 0.3*420 = 326, avg 407.5, sell 0.2 → proceeds 86 vs 81.5 = +4.50
    expect(pos.realizedPnl).toBeCloseTo(4.5, 6);
    expect(pos.shares).toBeCloseTo(0.6, 6);
    expect(pos.costBasis).toBeCloseTo(244.5, 6); // 326 - 81.5
  });

  it("reproduces unrealized +5.50 and total +10.00 at live 416.67", () => {
    const [pos] = buildLedger(events, hist);
    const pnl = positionPnl(pos, 416.67);
    expect(pnl.unrealizedPnl).toBeCloseTo(5.5, 1); // 0.6*416.67 - 244.5 = 5.502
    expect(pnl.totalPnl).toBeCloseTo(10.0, 1);
  });
});

describe("buildLedger — event kinds", () => {
  it("BUY uses exact on-chain USD cost", () => {
    const [pos] = buildLedger(
      [ev({ type: "buy", shares: 0.5, usdValue: 200, tx_hash: "0xb" })],
      () => null,
    );
    expect(pos.shares).toBeCloseTo(0.5, 6);
    expect(pos.costBasis).toBeCloseTo(200, 6);
    expect(pos.realizedPnl).toBe(0);
  });

  it("multiple buys then partial sell → correct avg-cost realized", () => {
    const events: TradeEventInput[] = [
      ev({
        type: "buy",
        shares: 1,
        usdValue: 100,
        ts: "2026-06-01T00:00:00Z",
        tx_hash: "0x1",
      }),
      ev({
        type: "buy",
        shares: 1,
        usdValue: 140,
        ts: "2026-06-02T00:00:00Z",
        tx_hash: "0x2",
      }),
      ev({
        type: "sell",
        shares: 1,
        usdValue: 150,
        ts: "2026-06-03T00:00:00Z",
        tx_hash: "0x3",
      }),
    ];
    const [pos] = buildLedger(events, () => null);
    // avg = 240/2 = 120; sell 1@150 → realized +30; remaining cost 120, shares 1
    expect(pos.realizedPnl).toBeCloseTo(30, 6);
    expect(pos.shares).toBeCloseTo(1, 6);
    expect(pos.costBasis).toBeCloseTo(120, 6);
  });

  it("SEND disposes at historical price against the running average", () => {
    const hist: HistPriceLookup = () => 500;
    const events: TradeEventInput[] = [
      ev({
        type: "buy",
        shares: 2,
        usdValue: 800,
        ts: "2026-06-01T00:00:00Z",
        tx_hash: "0xb",
      }),
      ev({
        type: "send",
        shares: 1,
        ts: "2026-06-02T00:00:00Z",
        tx_hash: "0xs",
      }),
    ];
    const [pos] = buildLedger(events, hist);
    // avg 400; send 1@500 → realized +100; remaining 1 share, cost 400
    expect(pos.realizedPnl).toBeCloseTo(100, 6);
    expect(pos.shares).toBeCloseTo(1, 6);
    expect(pos.costBasis).toBeCloseTo(400, 6);
  });

  it("ignores deposits (cash, not a position)", () => {
    const positions = buildLedger(
      [
        ev({
          type: "deposit",
          ticker: "USDT",
          shares: 300,
          usdValue: 300,
          tx_hash: "0xd",
        }),
      ],
      () => null,
    );
    expect(positions).toHaveLength(0);
  });

  it("zeroes a fully-closed position (no float residue)", () => {
    const events: TradeEventInput[] = [
      ev({
        type: "buy",
        shares: 0.3,
        usdValue: 30,
        ts: "2026-06-01T00:00:00Z",
        tx_hash: "0x1",
      }),
      ev({
        type: "sell",
        shares: 0.3,
        usdValue: 40,
        ts: "2026-06-02T00:00:00Z",
        tx_hash: "0x2",
      }),
    ];
    const [pos] = buildLedger(events, () => null);
    expect(pos.shares).toBe(0);
    expect(pos.costBasis).toBe(0);
    expect(pos.realizedPnl).toBeCloseTo(10, 6);
  });

  it("throws if a delivery has no historical price (never $0-cost)", () => {
    expect(() =>
      buildLedger(
        [ev({ type: "delivery", shares: 1, tx_hash: "0xd" })],
        () => null,
      ),
    ).toThrow(/no historical price/);
  });
});

describe("positionPnl + rollup", () => {
  it("missing live price → null PnLs, flagged in rollup", () => {
    const [pos] = buildLedger(
      [
        {
          type: "buy",
          ticker: "NVDA",
          shares: 1,
          usdValue: 100,
          ts: "2026-06-01T00:00:00Z",
          tx_hash: "0x",
        },
      ],
      () => null,
    );
    const pnl = positionPnl(pos, null);
    expect(pnl.unrealizedPnl).toBeNull();
    expect(pnl.totalPnl).toBeNull();
    const r = rollup([pnl]);
    expect(r.hasMissingPrices).toBe(true);
    expect(r.unrealized).toBe(0);
  });

  it("rollup ties out: Σ holding total == grand total", () => {
    const nvda = positionPnl(
      { ticker: "NVDA", shares: 1, costBasis: 100, realizedPnl: 5 },
      130,
    );
    const meta = positionPnl(
      { ticker: "META", shares: 2, costBasis: 200, realizedPnl: -10 },
      90,
    );
    const r = rollup([nvda, meta]);
    expect(r.realized).toBeCloseTo(-5, 6); // 5 + (-10)
    expect(r.unrealized).toBeCloseTo(30 + -20, 6); // (130-100) + (180-200)
    expect(r.total).toBeCloseTo(r.realized + r.unrealized, 6);
    expect(r.total).toBeCloseTo((nvda.totalPnl ?? 0) + (meta.totalPnl ?? 0), 6);
  });
});
