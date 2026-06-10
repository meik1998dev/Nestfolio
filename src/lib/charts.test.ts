import { describe, it, expect } from "vitest";
import { calendarTicks, toIndex, zeroSplitOffset, MAX_TICKS } from "./charts";

/** Build N consecutive daily ISO dates starting at `start` (inclusive). */
function dailyDates(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe("calendarTicks", () => {
  it("returns [] for an empty series", () => {
    expect(calendarTicks([])).toEqual([]);
  });

  it("returns the single date unchanged", () => {
    expect(calendarTicks(["2025-03-04"])).toEqual(["2025-03-04"]);
  });

  it("weekly: 10 days within ≤45d span → one tick per ISO Monday", () => {
    // 2025-03-03 is a Monday; 2025-03-10 the next Monday.
    const dates = dailyDates("2025-03-03", 10); // through 2025-03-12
    expect(calendarTicks(dates)).toEqual(["2025-03-03", "2025-03-10"]);
  });

  it("weekly: first data date in a partial opening week is kept", () => {
    // Start mid-week (Wed 2025-03-05); first bucket date is that Wednesday.
    const dates = dailyDates("2025-03-05", 10); // through 2025-03-14
    expect(calendarTicks(dates)).toEqual(["2025-03-05", "2025-03-10"]);
  });

  it("monthly: 30 daily dates over a ≤45d span stay weekly (Mondays)", () => {
    const dates = dailyDates("2025-03-03", 30); // 29-day span ≤ 45
    expect(calendarTicks(dates)).toEqual([
      "2025-03-03",
      "2025-03-10",
      "2025-03-17",
      "2025-03-24",
      "2025-03-31",
    ]);
  });

  it("monthly: 13 months of month-starts thin to ≤ MAX_TICKS with FIRST and LAST included", () => {
    // One date per month, the 1st, Jan 2024 → Jan 2025 (13 buckets, span > 45d).
    const dates = [
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
      "2024-04-01",
      "2024-05-01",
      "2024-06-01",
      "2024-07-01",
      "2024-08-01",
      "2024-09-01",
      "2024-10-01",
      "2024-11-01",
      "2024-12-01",
      "2025-01-01",
    ];
    const ticks = calendarTicks(dates);
    expect(ticks.length).toBeLessThanOrEqual(MAX_TICKS + 1);
    expect(ticks[0]).toBe("2024-01-01"); // first kept
    expect(ticks[ticks.length - 1]).toBe("2025-01-01"); // last force-included
    // step = ceil(13/8) = 2 → indices 0,2,4,6,8,10,12 already include the last,
    // so no duplicate is appended.
    expect(ticks).toEqual([
      "2024-01-01",
      "2024-03-01",
      "2024-05-01",
      "2024-07-01",
      "2024-09-01",
      "2024-11-01",
      "2025-01-01",
    ]);
  });

  it("force-includes the last bucket when even thinning would drop it", () => {
    // 12 monthly buckets: step = ceil(12/8) = 2 → indices 0,2,4,6,8,10 (last=11
    // dropped) → the guard appends index 11.
    const dates = [
      "2024-01-01",
      "2024-02-01",
      "2024-03-01",
      "2024-04-01",
      "2024-05-01",
      "2024-06-01",
      "2024-07-01",
      "2024-08-01",
      "2024-09-01",
      "2024-10-01",
      "2024-11-01",
      "2024-12-01",
    ];
    const ticks = calendarTicks(dates);
    expect(ticks[ticks.length - 1]).toBe("2024-12-01");
    // No duplicate of the last element.
    expect(ticks.filter((t) => t === "2024-12-01")).toHaveLength(1);
    expect(ticks).toEqual([
      "2024-01-01",
      "2024-03-01",
      "2024-05-01",
      "2024-07-01",
      "2024-09-01",
      "2024-11-01",
      "2024-12-01",
    ]);
  });

  it("yearly: 3 years of year-starts → one tick per calendar year", () => {
    const dates = ["2022-01-01", "2023-01-01", "2024-01-01"]; // span > 550d
    expect(calendarTicks(dates)).toEqual([
      "2022-01-01",
      "2023-01-01",
      "2024-01-01",
    ]);
  });
});

describe("zeroSplitOffset", () => {
  it("empty → 1 (solid green)", () => {
    expect(zeroSplitOffset([])).toBe(1);
  });

  it("all-null → 1 (solid green)", () => {
    expect(zeroSplitOffset([null, undefined, null])).toBe(1);
  });

  it("all-positive [5] → 1", () => {
    expect(zeroSplitOffset([5])).toBe(1);
  });

  it("all-negative [-5] → 0", () => {
    expect(zeroSplitOffset([-5])).toBe(0);
  });

  it("[3, -2] → 0.6 (zero line 60% down from the top)", () => {
    expect(zeroSplitOffset([3, -2])).toBeCloseTo(0.6, 10);
  });

  it("flat zero [0, 0] → 1 (solid green, no divide-by-zero)", () => {
    expect(zeroSplitOffset([0, 0])).toBe(1);
  });

  it("ignores nulls when computing the split", () => {
    expect(zeroSplitOffset([3, null, -2, undefined])).toBeCloseTo(0.6, 10);
  });
});

describe("toIndex", () => {
  it("null → null", () => {
    expect(toIndex(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(toIndex(undefined)).toBeNull();
  });

  it('numeric string "3" → 3', () => {
    expect(toIndex("3")).toBe(3);
  });

  it("number 4 → 4", () => {
    expect(toIndex(4)).toBe(4);
  });

  it('non-numeric "abc" → null', () => {
    expect(toIndex("abc")).toBeNull();
  });
});
