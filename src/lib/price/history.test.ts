import { describe, expect, it } from "vitest";
import { dropWeekendCloses, hasInteriorGap } from "./history";

describe("hasInteriorGap", () => {
  it("flags a hole longer than the forward-fill limit", () => {
    const map = new Map([["2025-01-06", 1], ["2025-01-13", 1]]);
    expect(hasInteriorGap(map, "2025-01-06", "2025-01-14")).toBe(true);
  });

  it("accepts weekends and short holidays", () => {
    const map = new Map([["2025-01-03", 1], ["2025-01-06", 1], ["2025-01-07", 1]]);
    expect(hasInteriorGap(map, "2025-01-03", "2025-01-07")).toBe(false);
  });
});

describe("dropWeekendCloses", () => {
  it("removes Saturday and Sunday rows for stocks only", () => {
    const stock = new Map([["2025-01-03", 1], ["2025-01-04", 2], ["2025-01-05", 3], ["2025-01-06", 4]]);
    dropWeekendCloses(stock, "MSFT");
    expect([...stock.keys()]).toEqual(["2025-01-03", "2025-01-06"]);
    const crypto = new Map([["2025-01-04", 2]]);
    dropWeekendCloses(crypto, "BTC-USD");
    expect(crypto.size).toBe(1);
  });
});
