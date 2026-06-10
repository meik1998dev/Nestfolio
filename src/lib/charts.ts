/**
 * Pure chart helpers shared by the portfolio and per-asset time-series charts.
 * No "use client" — these are framework-agnostic pure functions (no React, no
 * DOM), unit-tested in `charts.test.ts`. The presentational pieces (ScrubHeader,
 * tooltips, legends, trade dots) and the views' differing `fmtPct` conventions
 * stay local to each chart file.
 */

/** Axis tick label. Includes the year (e.g. "Jan '24") on multi-year ranges. */
export function axisLabel(iso: string, withYear: boolean): string {
  const d = new Date(iso + "T00:00:00Z");
  if (withYear) {
    return `${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} '${String(
      d.getUTCFullYear(),
    ).slice(2)}`;
  }
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Full date for tooltips, always with the year (e.g. "Oct 3, 2025"). */
export function fullDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** UTC midnight ms for an ISO "YYYY-MM-DD" date (timezone-safe bucketing). */
export function utcMs(iso: string): number {
  return new Date(iso + "T00:00:00Z").getTime();
}

/** Most ticks an axis should show before we thin to avoid overlap. */
export const MAX_TICKS = 8;

/**
 * Explicit x-axis ticks at natural calendar boundaries. Given the series' ISO
 * dates (ascending, "YYYY-MM-DD"), returns a subset that exists in the data —
 * the axis is a category axis keyed on `date`, so ticks must be real values:
 *   - span ≤ 45 days  → weekly:  first data date on/after each ISO Monday.
 *   - span ≤ 550 days → monthly: first data date in each calendar month.
 *   - longer          → yearly:  first data date in each calendar year.
 * The bucket list is then capped at MAX_TICKS by taking every Nth (keeping the
 * first), and the last bucket (the chart's right edge, "now") is always force-
 * included so the latest date keeps its tick — even when the even thinning would
 * have dropped it. The result may then hold MAX_TICKS + 1 ticks; `minTickGap`
 * guards any crowding between the last two. Empty → []; single point → that date.
 */
export function calendarTicks(dates: string[]): string[] {
  if (dates.length <= 1) return dates.slice();
  const spanDays =
    (utcMs(dates[dates.length - 1]) - utcMs(dates[0])) / 86_400_000;

  let keyOf: (iso: string) => string;
  if (spanDays <= 45) {
    // ISO week key: shift each date back to its Monday (UTC) and stamp it.
    keyOf = (iso) => {
      const d = new Date(iso + "T00:00:00Z");
      const dow = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
      d.setUTCDate(d.getUTCDate() - dow);
      return d.toISOString().slice(0, 10);
    };
  } else if (spanDays <= 550) {
    keyOf = (iso) => iso.slice(0, 7); // YYYY-MM
  } else {
    keyOf = (iso) => iso.slice(0, 4); // YYYY
  }

  // First data date in each bucket (dates are already ascending).
  const ticks: string[] = [];
  let last: string | undefined;
  for (const iso of dates) {
    const k = keyOf(iso);
    if (k !== last) {
      ticks.push(iso);
      last = k;
    }
  }

  if (ticks.length <= MAX_TICKS) return ticks;
  // Thin evenly to ≤ MAX_TICKS, always keeping the first.
  const step = Math.ceil(ticks.length / MAX_TICKS);
  const thinned = ticks.filter((_, i) => i % step === 0);
  // Force-include the last bucket (chart's right edge) when thinning dropped it.
  const lastTick = ticks[ticks.length - 1];
  if (thinned[thinned.length - 1] !== lastTick) thinned.push(lastTick);
  return thinned;
}

/** recharts v3 reports the hovered index as number | string | null |
 *  undefined; null when the pointer is outside the plot area. */
export function toIndex(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Vertical-gradient stop offset (0..1) for zero-split coloring of an Area. The
 * Area's bounding box runs from its rendered top (max, or 0 if all negative) to
 * its rendered bottom (min, or 0 if all positive) — recharts draws the fill from
 * the zero baseline — so the zero line sits at `top / (top - bottom)` from the
 * top. Nulls are skipped; an empty/flat series collapses to a single color
 * (green when ≥ 0, else red) without dividing by zero.
 */
export function zeroSplitOffset(values: (number | null | undefined)[]): number {
  const nums = values.filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  if (nums.length === 0) return 1; // nothing to chart → harmless (green)
  const dataMax = Math.max(...nums);
  const dataMin = Math.min(...nums);
  const top = Math.max(dataMax, 0);
  const bottom = Math.min(dataMin, 0);
  if (top === bottom) return top >= 0 ? 1 : 0; // flat series → solid color
  return Math.min(1, Math.max(0, top / (top - bottom)));
}
