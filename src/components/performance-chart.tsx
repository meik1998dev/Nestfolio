"use client";

/**
 * Portfolio value + P&L time-series chart — the dashboard / PnL counterpart to
 * the per-asset chart. Data is computed on the server and passed in; this only
 * renders. A "Value | P&L" toggle switches what the single chart shows, and the
 * range buttons are links that re-run the server computation via `?range=`
 * (pass `basePath` so the links target the host page).
 */
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import type { PerfPoint, PerfRange } from "@/lib/insights/performance.types";
import { PERF_RANGES } from "@/lib/insights/performance.types";

type View = "value" | "pnl" | "return";

/** SPY benchmark line color — distinct from the portfolio trend color. */
const SPY_COLOR = "var(--color-violet-500)";

/** Signed percent (e.g. "+12.3%"). */
function fmtPct(v: unknown): string {
  return v == null || !Number.isFinite(Number(v))
    ? "—"
    : `${Number(v) >= 0 ? "+" : ""}${(Number(v) * 100).toFixed(1)}%`;
}

/** Axis tick label. Includes the year (e.g. "Jan '24") on multi-year ranges. */
function axisLabel(iso: string, withYear: boolean): string {
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
function fullDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Most ticks an axis should show before we thin to avoid overlap. */
const MAX_TICKS = 8;

/** UTC midnight ms for an ISO "YYYY-MM-DD" date (timezone-safe bucketing). */
function utcMs(iso: string): number {
  return new Date(iso + "T00:00:00Z").getTime();
}

/**
 * Explicit x-axis ticks at natural calendar boundaries. Given the series' ISO
 * dates (ascending, "YYYY-MM-DD"), returns a subset that exists in the data —
 * the axis is a category axis keyed on `date`, so ticks must be real values:
 *   - span ≤ 45 days  → weekly:  first data date on/after each ISO Monday.
 *   - span ≤ 550 days → monthly: first data date in each calendar month.
 *   - longer          → yearly:  first data date in each calendar year.
 * The bucket list is then capped at MAX_TICKS by taking every Nth (keeping the
 * first). Empty → []; single point → that date.
 */
function calendarTicks(dates: string[]): string[] {
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
  return ticks.filter((_, i) => i % step === 0);
}

/** recharts v3 reports the hovered index as number | string | null |
 *  undefined; null when the pointer is outside the plot area. */
function toIndex(v: unknown): number | null {
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
function zeroSplitOffset(values: (number | null | undefined)[]): number {
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

export function PerformanceChart({
  series,
  range,
  basePath,
}: {
  series: PerfPoint[];
  range: PerfRange;
  /** Host page path the range links point at, e.g. "/dashboard" or "/pnl". */
  basePath: string;
}) {
  const [view, setView] = useState<View>("value");
  const [benchmark, setBenchmark] = useState(true);
  // Index of the hovered point (scrub header); null → show the latest point.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const selectView = (v: View) => {
    setView(v);
    setHoverIdx(null);
  };

  const multiYear =
    series.length > 1 &&
    series[0].date.slice(0, 4) !== series[series.length - 1].date.slice(0, 4);
  const data = series;

  // Benchmark only overlays on Value ($ what-if) and Return (% rebased) views.
  const hasBench = data.some(
    (p) => p.spyValue != null || p.spyReturnPct != null,
  );
  const showBench = benchmark && hasBench && view !== "pnl";

  const lastTotal = data.length ? data[data.length - 1].total : null;
  const lastReturn = data.length ? data[data.length - 1].returnPct : null;
  const trendUp =
    view === "pnl"
      ? (lastTotal ?? 0) >= 0
      : view === "return"
        ? (lastReturn ?? 0) >= 0
        : data.length < 2 ||
          (data[data.length - 1].value ?? 0) >= (data[0].value ?? 0);
  const trendColor = trendUp
    ? "var(--color-emerald-600)"
    : "var(--color-red-600)";

  // Zero-split gradient stops for the P&L (total) and Return % areas: green
  // above the zero line, red below. Offset is the zero line's position from the
  // top of each Area's own bounding box.
  const pnlOffset = useMemo(
    () => zeroSplitOffset(data.map((p) => p.total)),
    [data],
  );
  const returnOffset = useMemo(
    () => zeroSplitOffset(data.map((p) => p.returnPct)),
    [data],
  );

  // Calendar-boundary x ticks — all three views chart `data`, so one list.
  const xTicks = useMemo(() => calendarTicks(data.map((p) => p.date)), [data]);

  // Scrub header: hovered point (or latest when not hovering) + delta vs the
  // first point of the visible range.
  const point =
    hoverIdx != null && hoverIdx < data.length
      ? data[hoverIdx]
      : data.length
        ? data[data.length - 1]
        : null;
  const startPoint = data.length ? data[0] : null;
  const hoverProps = {
    onMouseMove: (s: { activeIndex?: unknown }) =>
      setHoverIdx(toIndex(s.activeIndex)),
    onMouseLeave: () => setHoverIdx(null),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Value | P&L | Return % toggle */}
        <div className="bg-muted inline-flex rounded-lg p-0.5">
          <ToggleButton
            active={view === "value"}
            onClick={() => selectView("value")}
          >
            Value
          </ToggleButton>
          <ToggleButton
            active={view === "pnl"}
            onClick={() => selectView("pnl")}
          >
            P&amp;L
          </ToggleButton>
          <ToggleButton
            active={view === "return"}
            onClick={() => selectView("return")}
          >
            Return %
          </ToggleButton>
        </div>
        <div className="flex items-center gap-2">
          {/* S&P 500 benchmark on/off (not meaningful on the P&L view) */}
          {hasBench && view !== "pnl" && (
            <Button
              size="xs"
              variant={showBench ? "secondary" : "ghost"}
              onClick={() => setBenchmark((b) => !b)}
            >
              <span
                className="mr-1.5 inline-block h-0.5 w-3 align-middle"
                style={{ background: SPY_COLOR }}
              />
              S&amp;P 500
            </Button>
          )}
          {/* Range links — server recomputes the series */}
          <div className="flex items-center gap-1">
            {PERF_RANGES.map((r) => (
              <Button
                key={r}
                size="xs"
                variant={r === range ? "secondary" : "ghost"}
                render={<a href={`${basePath}?range=${r}`}>{r}</a>}
              />
            ))}
          </div>
        </div>
      </div>

      {point && startPoint && (
        <ScrubHeader
          {...scrubParts(view, point, startPoint)}
          pointDate={fullDate(point.date)}
          startDate={fullDate(startPoint.date)}
        />
      )}

      {data.length === 0 ? (
        <div className="text-muted-foreground flex h-[260px] items-center justify-center text-sm">
          No history for this range yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          {view === "value" ? (
            <AreaChart
              data={data}
              margin={{ left: 4, right: 8, top: 8 }}
              {...hoverProps}
            >
              <defs>
                <linearGradient id="perfValueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(d) => axisLabel(d, multiYear)}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                ticks={xTicks}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v) => formatUSD(v, { compact: true })}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={56}
                domain={["auto", "auto"]}
              />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <TooltipBox label={fullDate(payload[0].payload.date)}>
                      <Row
                        name="Value"
                        value={fmtMoney(payload[0].payload.value)}
                      />
                      {showBench && (
                        <Row
                          name="S&P 500 (what-if)"
                          value={fmtMoney(payload[0].payload.spyValue)}
                        />
                      )}
                    </TooltipBox>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={trendColor}
                strokeWidth={2}
                fill="url(#perfValueFill)"
                connectNulls
                dot={false}
                isAnimationActive={false}
              />
              {showBench && (
                <Line
                  type="monotone"
                  dataKey="spyValue"
                  name="S&P 500"
                  stroke={SPY_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  connectNulls
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          ) : view === "return" ? (
            <AreaChart
              data={data}
              margin={{ left: 4, right: 8, top: 8 }}
              {...hoverProps}
            >
              <defs>
                <linearGradient
                  id="perfReturnStroke"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset={returnOffset}
                    stopColor="var(--color-emerald-600)"
                  />
                  <stop
                    offset={returnOffset}
                    stopColor="var(--color-red-600)"
                  />
                </linearGradient>
                <linearGradient id="perfReturnFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-emerald-600)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset={returnOffset}
                    stopColor="var(--color-emerald-600)"
                    stopOpacity={0}
                  />
                  <stop
                    offset={returnOffset}
                    stopColor="var(--color-red-600)"
                    stopOpacity={0}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-red-600)"
                    stopOpacity={0.3}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => axisLabel(d, multiYear)}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                ticks={xTicks}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <TooltipBox label={fullDate(payload[0].payload.date)}>
                      <Row
                        name="Return"
                        value={fmtPct(payload[0].payload.returnPct)}
                      />
                      {showBench && (
                        <Row
                          name="S&P 500"
                          value={fmtPct(payload[0].payload.spyReturnPct)}
                        />
                      )}
                    </TooltipBox>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="returnPct"
                name="Return"
                stroke="url(#perfReturnStroke)"
                strokeWidth={2}
                fill="url(#perfReturnFill)"
                connectNulls
                dot={false}
                isAnimationActive={false}
              />
              {showBench && (
                <Line
                  type="monotone"
                  dataKey="spyReturnPct"
                  name="S&P 500"
                  stroke={SPY_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  connectNulls
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          ) : (
            <AreaChart
              data={data}
              margin={{ left: 4, right: 8, top: 8 }}
              {...hoverProps}
            >
              <defs>
                <linearGradient id="perfPnlStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset={pnlOffset}
                    stopColor="var(--color-emerald-600)"
                  />
                  <stop offset={pnlOffset} stopColor="var(--color-red-600)" />
                </linearGradient>
                <linearGradient id="perfPnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--color-emerald-600)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset={pnlOffset}
                    stopColor="var(--color-emerald-600)"
                    stopOpacity={0}
                  />
                  <stop
                    offset={pnlOffset}
                    stopColor="var(--color-red-600)"
                    stopOpacity={0}
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--color-red-600)"
                    stopOpacity={0.3}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => axisLabel(d, multiYear)}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                ticks={xTicks}
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v) => formatUSD(v, { compact: true })}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <TooltipBox label={fullDate(payload[0].payload.date)}>
                      <Row
                        name="Total"
                        value={fmtSigned(payload[0].payload.total)}
                      />
                      <Row
                        name="Realized"
                        value={fmtSigned(payload[0].payload.realized)}
                      />
                      <Row
                        name="Unrealized"
                        value={fmtSigned(payload[0].payload.unrealized)}
                      />
                    </TooltipBox>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="total"
                name="Total"
                stroke="url(#perfPnlStroke)"
                strokeWidth={2}
                fill="url(#perfPnlFill)"
                connectNulls
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="realized"
                name="Realized"
                stroke="var(--color-amber-500)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="unrealized"
                name="Unrealized"
                stroke="var(--color-blue-500)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                connectNulls
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          )}
        </ResponsiveContainer>
      )}

      {view === "pnl" && data.length > 0 && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
          <Legend color={trendColor} label="Total" />
          <Legend color="var(--color-amber-500)" label="Realized" />
          <Legend color="var(--color-blue-500)" label="Unrealized" dashed />
        </div>
      )}
      {showBench && data.length > 0 && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
          <Legend
            color={trendColor}
            label={view === "return" ? "This portfolio" : "Value"}
          />
          <Legend color={SPY_COLOR} label="S&P 500" dashed />
        </div>
      )}
    </div>
  );
}

/**
 * Scrub-header content for one view: the big number at `point` plus the change
 * since `start` (first point of the visible range). The % part of the delta is
 * "—" when the baseline is 0 or null; for a (possibly negative) P&L baseline
 * the denominator is |start| so the delta sign stays meaningful.
 */
function scrubParts(
  view: View,
  point: PerfPoint,
  start: PerfPoint,
): { primary: string; delta: string | null; deltaUp: boolean } {
  if (view === "return") {
    // Primary is already a % — the delta is just percentage points gained.
    const d =
      point.returnPct != null && start.returnPct != null
        ? point.returnPct - start.returnPct
        : null;
    return {
      primary: fmtPct(point.returnPct),
      delta:
        d == null ? null : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pp`,
      deltaUp: (d ?? 0) >= 0,
    };
  }
  const cur = view === "pnl" ? point.total : point.value;
  const base = view === "pnl" ? start.total : start.value;
  const d = cur != null && base != null ? cur - base : null;
  const pct = d != null && base ? d / Math.abs(base) : null;
  return {
    primary: view === "pnl" ? fmtSigned(cur) : fmtMoney(cur),
    delta: d == null ? null : `${fmtSigned(d)} (${fmtPct(pct)})`,
    deltaUp: (d ?? 0) >= 0,
  };
}

/** Big hovered/latest number + delta since range start. Fixed-ish height and
 *  tabular digits so scrubbing never shifts the layout. */
function ScrubHeader({
  primary,
  delta,
  deltaUp,
  pointDate,
  startDate,
}: {
  primary: string;
  delta: string | null;
  deltaUp: boolean;
  pointDate: string;
  startDate: string;
}) {
  return (
    <div className="min-h-14 space-y-0.5">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight tabular-nums">
          {primary}
        </span>
        <span className="text-muted-foreground text-xs">{pointDate}</span>
      </div>
      <p className="text-sm tabular-nums">
        <span
          className={cn(
            delta == null
              ? "text-muted-foreground"
              : deltaUp
                ? "text-emerald-600 dark:text-emerald-500"
                : "text-red-600 dark:text-red-500",
          )}
        >
          {delta ?? "—"}
        </span>{" "}
        <span className="text-muted-foreground">since {startDate}</span>
      </p>
    </div>
  );
}

/** Plain USD (value) — never signed. */
function fmtMoney(v: unknown): string {
  return v == null || !Number.isFinite(Number(v)) ? "—" : formatUSD(Number(v));
}

/** Signed USD (P&L) — leading +/− so gains and losses read at a glance. */
function fmtSigned(v: unknown): string {
  return v == null || !Number.isFinite(Number(v))
    ? "—"
    : formatUSD(Number(v), { signed: true });
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function TooltipBox({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-popover space-y-1 rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{label}</p>
      {children}
    </div>
  );
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-4 tabular-nums">
      <span className="text-muted-foreground">{name}</span>
      <span>{value}</span>
    </p>
  );
}

function Legend({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-0.5 w-4"
        style={{
          background: dashed
            ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`
            : color,
        }}
      />
      {label}
    </span>
  );
}
