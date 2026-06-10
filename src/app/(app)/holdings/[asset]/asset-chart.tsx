"use client";

/**
 * Asset price + P&L time-series chart (Google-Finance style). Data is computed on
 * the server and passed in; this only renders. A "Price | P&L" toggle switches
 * what the single chart shows, and range buttons are links that re-run the server
 * computation via `?range=` (keeps the client dumb and the history server-side).
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
import { formatUSD, formatQty } from "@/lib/format";
import type {
  AssetRange,
  AssetSeriesPoint,
  AssetTrade,
} from "@/lib/asset/types";
import { ASSET_RANGES } from "@/lib/asset/types";

type View = "price" | "pnl";

/** All trades that fall on one charted date, split by side. */
interface DayTrades {
  buy?: AssetTrade;
  sell?: AssetTrade;
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

export function AssetChart({
  linkSymbol,
  series,
  range,
  hasPrice,
  pnlKnown,
  rangeChanges,
  trades = [],
}: {
  /** Original-cased URL symbol used for range links (preserves casing so
   *  tokenized stocks like "NVDAon" keep resolving). */
  linkSymbol: string;
  series: AssetSeriesPoint[];
  range: AssetRange;
  hasPrice: boolean;
  pnlKnown: boolean;
  rangeChanges: Record<AssetRange, number | null>;
  /** The user's own buy/sell trades on this asset, for Price-view markers. */
  trades?: AssetTrade[];
}) {
  const [view, setView] = useState<View>("price");
  // Index of the hovered point (scrub header); null → show the latest point.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const selectView = (v: View) => {
    setView(v);
    setHoverIdx(null); // index maps into the active series — reset on switch
  };

  // Only show per-range % when at least one range is priceable.
  const hasPct = ASSET_RANGES.some((r) => rangeChanges[r] != null);

  // Span more than one calendar year → put the year on axis ticks.
  const multiYear =
    series.length > 1 &&
    series[0].date.slice(0, 4) !== series[series.length - 1].date.slice(0, 4);
  const data = series;

  // P&L view: drop the flat run before the first activity (no holdings and no
  // realized/total P&L yet) so the chart starts where the investment does.
  const firstActivity = data.findIndex(
    (p) =>
      (p.held ?? 0) !== 0 || (p.realized ?? 0) !== 0 || (p.total ?? 0) !== 0,
  );
  const pnlData = firstActivity > 0 ? data.slice(firstActivity) : data;

  const total = data.length ? data[data.length - 1].total : null;
  const trendUp =
    view === "pnl"
      ? (total ?? 0) >= 0
      : data.length < 2 ||
        (data[data.length - 1].price ?? 0) >= (data[0].price ?? 0);
  const trendColor = trendUp
    ? "var(--color-emerald-600)"
    : "var(--color-red-600)";

  // Zero-split gradient stop for the P&L (total) area: green above the zero
  // line, red below. Computed over `pnlData` (the charted, sliced series).
  const pnlOffset = useMemo(
    () => zeroSplitOffset(pnlData.map((p) => p.total)),
    [pnlData],
  );

  // Fast date → trades lookup so the Price-view dot render-prop and tooltip can
  // resolve a point's trades in O(1) instead of scanning the trades array per
  // point. Keyed on the ISO day; buy/sell collapse into one bucket per date.
  const tradesByDate = useMemo(() => {
    const map = new Map<string, DayTrades>();
    for (const t of trades) {
      const day = map.get(t.date) ?? {};
      day[t.side] = t;
      map.set(t.date, day);
    }
    return map;
  }, [trades]);

  // Calendar-boundary x ticks per view. Price charts `data`; P&L charts the
  // sliced `pnlData`. `pnlData` has unstable identity (a fresh slice each
  // render), so the P&L memo keys on the stable [data, firstActivity] instead.
  const priceTicks = useMemo(
    () => calendarTicks(data.map((p) => p.date)),
    [data],
  );
  const pnlTicks = useMemo(
    () => calendarTicks(pnlData.map((p) => p.date)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, firstActivity],
  );

  // Scrub header: hovered point (or latest when not hovering) + delta vs the
  // first point of the visible series. The P&L view charts `pnlData`, so both
  // the index lookup and the delta baseline use that sliced series.
  const chartData = view === "pnl" ? pnlData : data;
  const chartVisible =
    data.length > 0 && !(view === "pnl" && !pnlKnown) && chartData.length > 0;
  const point = chartVisible
    ? chartData[
        hoverIdx != null && hoverIdx < chartData.length
          ? hoverIdx
          : chartData.length - 1
      ]
    : null;
  const startPoint = chartVisible ? chartData[0] : null;
  const hoverProps = {
    onMouseMove: (s: { activeIndex?: unknown }) =>
      setHoverIdx(toIndex(s.activeIndex)),
    onMouseLeave: () => setHoverIdx(null),
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Price | P&L toggle */}
        <div className="bg-muted inline-flex rounded-lg p-0.5">
          <ToggleButton
            active={view === "price"}
            onClick={() => selectView("price")}
          >
            Price
          </ToggleButton>
          <ToggleButton
            active={view === "pnl"}
            onClick={() => selectView("pnl")}
          >
            P&amp;L
          </ToggleButton>
        </div>
        {/* Range links — server recomputes the series. Each shows the P&L
            return % over that window (TradingView-style). The % row is hidden
            entirely for unpriceable assets, where every range is unknown. */}
        <div className="flex items-center gap-1">
          {ASSET_RANGES.map((r) => {
            const pct = rangeChanges[r];
            return (
              <Button
                key={r}
                size="xs"
                variant={r === range ? "secondary" : "ghost"}
                className={cn(hasPct && "h-auto flex-col gap-0 py-1")}
                render={
                  <a
                    href={`/holdings/${encodeURIComponent(linkSymbol)}?range=${r}`}
                  >
                    <span>{r}</span>
                    {hasPct && (
                      <span
                        className={cn(
                          "text-[10px] leading-tight font-normal tabular-nums",
                          pct == null
                            ? "text-muted-foreground"
                            : pct >= 0
                              ? "text-emerald-600 dark:text-emerald-500"
                              : "text-red-600 dark:text-red-500",
                        )}
                      >
                        {fmtPct(pct)}
                      </span>
                    )}
                  </a>
                }
              />
            );
          })}
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
          No price history for this range.
        </div>
      ) : view === "pnl" && !pnlKnown ? (
        <div className="text-muted-foreground flex h-[260px] flex-col items-center justify-center gap-1 text-center text-sm">
          <p className="font-medium">No P&amp;L to chart</p>
          <p className="max-w-xs">
            This asset has no recorded trades, so there&apos;s no cost basis to
            compute profit/loss. Switch to Price, or log a buy on the
            Transactions page.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          {view === "price" ? (
            <AreaChart
              data={data}
              margin={{ left: 4, right: 8, top: 8 }}
              {...hoverProps}
            >
              <defs>
                <linearGradient id="assetPriceFill" x1="0" y1="0" x2="0" y2="1">
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
                ticks={priceTicks}
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
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const day = tradesByDate.get(payload[0].payload.date);
                  return (
                    <TooltipBox label={fullDate(payload[0].payload.date)}>
                      <Row name="Price" value={fmtMoney(payload[0].value)} />
                      <Row
                        name="Held"
                        value={fmtQty(payload[0].payload.held)}
                      />
                      {day?.buy && (
                        <Row
                          name="Bought"
                          value={tradeQty(day.buy)}
                          valueClass="text-emerald-600 dark:text-emerald-500"
                        />
                      )}
                      {day?.sell && (
                        <Row
                          name="Sold"
                          value={tradeQty(day.sell)}
                          valueClass="text-red-600 dark:text-red-500"
                        />
                      )}
                    </TooltipBox>
                  );
                }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={trendColor}
                strokeWidth={2}
                fill="url(#assetPriceFill)"
                connectNulls
                dot={(props) => (
                  <TradeDot
                    key={props.index}
                    cx={props.cx}
                    cy={props.cy}
                    day={tradesByDate.get(props.payload?.date)}
                  />
                )}
                isAnimationActive={false}
              />
            </AreaChart>
          ) : (
            <AreaChart
              data={pnlData}
              margin={{ left: 4, right: 8, top: 8 }}
              {...hoverProps}
            >
              <defs>
                <linearGradient id="assetPnlStroke" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset={pnlOffset}
                    stopColor="var(--color-emerald-600)"
                  />
                  <stop offset={pnlOffset} stopColor="var(--color-red-600)" />
                </linearGradient>
                <linearGradient id="assetPnlFill" x1="0" y1="0" x2="0" y2="1">
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
                ticks={pnlTicks}
                minTickGap={24}
              />
              <YAxis
                yAxisId="usd"
                tickFormatter={(v) => formatUSD(v, { compact: true })}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={56}
              />
              <YAxis
                yAxisId="qty"
                orientation="right"
                tickFormatter={(v) => formatQty(v, 2)}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              <ReferenceLine yAxisId="usd" y={0} stroke="var(--border)" />
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
                      <Row
                        name="Held"
                        value={fmtQty(payload[0].payload.held)}
                      />
                    </TooltipBox>
                  ) : null
                }
              />
              <Area
                yAxisId="usd"
                type="monotone"
                dataKey="total"
                name="Total"
                stroke="url(#assetPnlStroke)"
                strokeWidth={2}
                fill="url(#assetPnlFill)"
                connectNulls
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="qty"
                type="stepAfter"
                dataKey="held"
                name="Held"
                stroke="var(--color-violet-500)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="usd"
                type="monotone"
                dataKey="realized"
                name="Realized"
                stroke="var(--color-amber-500)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="usd"
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

      {view === "pnl" && pnlKnown && (
        <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
          <Legend color={trendColor} label="Total" />
          <Legend color="var(--color-amber-500)" label="Realized" />
          <Legend color="var(--color-blue-500)" label="Unrealized" dashed />
          <Legend color="var(--color-violet-500)" label="Held (right axis)" />
        </div>
      )}
      {view === "price" && !hasPrice && (
        <p className="text-muted-foreground text-xs">
          No live price for this asset — chart shows stored history only.
        </p>
      )}
    </div>
  );
}

/** Signed percent for range buttons (e.g. "+5.2%"); "—" when unknown. */
function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

/**
 * Scrub-header content for one view: the big number at `point` plus the change
 * since `start` (first point of the visible series). The % part of the delta is
 * "—" when the baseline is 0 or null; for a (possibly negative) P&L baseline
 * the denominator is |start| so the delta sign stays meaningful.
 */
function scrubParts(
  view: View,
  point: AssetSeriesPoint,
  start: AssetSeriesPoint,
): { primary: string; delta: string | null; deltaUp: boolean } {
  const cur = view === "pnl" ? point.total : point.price;
  const base = view === "pnl" ? start.total : start.price;
  const d = cur != null && base != null ? cur - base : null;
  const pct = d != null && base ? (d / Math.abs(base)) * 100 : null;
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

/** Asset quantity held. */
function fmtQty(v: unknown): string {
  return v == null || !Number.isFinite(Number(v)) ? "—" : formatQty(Number(v));
}

/** Plain USD (prices) — never signed. */
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

function Row({
  name,
  value,
  valueClass,
}: {
  name: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <p className="flex items-center justify-between gap-4 tabular-nums">
      <span className="text-muted-foreground">{name}</span>
      <span className={valueClass}>{value}</span>
    </p>
  );
}

/** Tooltip value for a trade: the quantity when known, else a bare side label. */
function tradeQty(t: AssetTrade): string {
  return t.qty != null ? formatQty(t.qty) : t.side === "buy" ? "Buy" : "Sell";
}

/**
 * A trade marker on the Price line: an emerald (buy) / red (sell) dot with a
 * background-colored ring so it reads against the line. Renders nothing on dates
 * with no trade (the dot render-prop runs for every point). When a date has both
 * a buy and a sell, the buy wins the dot — both still show in the tooltip.
 */
function TradeDot({
  cx,
  cy,
  day,
}: {
  cx?: number;
  cy?: number;
  day: DayTrades | undefined;
}) {
  const trade = day?.buy ?? day?.sell;
  if (!trade || cx == null || cy == null) return null;
  const color =
    trade.side === "buy" ? "var(--color-emerald-600)" : "var(--color-red-600)";
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={color}
      stroke="var(--color-background)"
      strokeWidth={1.5}
    />
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
