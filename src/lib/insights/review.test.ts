import { describe, it, expect } from "vitest";
import type { Transaction } from "@/lib/types";
import { computeMonthlyReview } from "./review";

function tx(type: Transaction["type"], amount: number): Transaction {
  return {
    id: Math.random().toString(),
    user_id: "u",
    date: "2026-05-15",
    type,
    source_account: null,
    dest_account: null,
    amount,
    category: null,
    note: null,
    created_at: "2026-05-15T00:00:00Z",
  };
}

describe("computeMonthlyReview", () => {
  it("computes a worked month: change, income/spend split, gains, winner/loser", () => {
    const review = computeMonthlyReview({
      startSnapshot: { net_worth: 10000, taken_at: "2026-05-01T00:00:00Z" },
      endSnapshot: { net_worth: 12000, taken_at: "2026-06-01T00:00:00Z" },
      transactions: [tx("income", 1500), tx("expense", 500), tx("buy", 800)],
      holdings: [
        { ticker: "NVDA", totalPnl: 900 },
        { ticker: "TSLA", totalPnl: -200 },
        { ticker: "AAPL", totalPnl: 100 },
      ],
    });

    expect(review.insufficient).toBe(false);
    expect(review.netWorthChange).toBe(2000);
    expect(review.incomeAdded).toBe(1500);
    expect(review.spent).toBe(500);
    // net contributions = 1500 − 500 = 1000; gains = 2000 − 1000 = 1000
    expect(review.investmentGains).toBe(1000);
    expect(review.winner?.ticker).toBe("NVDA");
    expect(review.loser?.ticker).toBe("TSLA");
  });

  it("flags insufficient when a snapshot is missing but still tallies income", () => {
    const review = computeMonthlyReview({
      startSnapshot: null,
      endSnapshot: { net_worth: 12000, taken_at: "2026-06-01T00:00:00Z" },
      transactions: [tx("income", 1500)],
      holdings: [],
    });
    expect(review.insufficient).toBe(true);
    expect(review.netWorthChange).toBe(0);
    expect(review.incomeAdded).toBe(1500);
    expect(review.winner).toBeNull();
  });

  it("ignores unpriced holdings when picking winner/loser", () => {
    const review = computeMonthlyReview({
      startSnapshot: { net_worth: 0, taken_at: "2026-05-01T00:00:00Z" },
      endSnapshot: { net_worth: 0, taken_at: "2026-06-01T00:00:00Z" },
      transactions: [],
      holdings: [
        { ticker: "X", totalPnl: null },
        { ticker: "Y", totalPnl: 50 },
      ],
    });
    expect(review.winner?.ticker).toBe("Y");
    expect(review.loser?.ticker).toBe("Y");
  });
});
