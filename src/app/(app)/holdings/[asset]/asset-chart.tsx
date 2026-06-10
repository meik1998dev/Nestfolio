"use client";

/**
 * Asset price + P&L time-series chart (Google-Finance style). Data is computed on
 * the server and passed in; this only renders. A "Price | P&L" toggle switches
 * what the single chart shows, and range buttons are links that re-run the server
 * computation via `?range=` (keeps the client dumb and the history server-side).
 */
import { useState } from "react";
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
import type { AssetRange, AssetSeriesPoint } from "@/lib/asset/types";
import { ASSET_RANGES } from "@/lib/asset/types";

type View = "price" | "pnl";

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

/** recharts v3 reports the hovered index as number | string | undefined. */
function toIndex(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function AssetChart({
  linkSymbol,
  series,
  range,
  hasPrice,
  pnlKnown,
  rangeChanges,
}: {
  /** Original-cased URL symbol used for range links (preserves casing so
   *  tokenized stocks like "NVDAon" keep resolving). */
  linkSymbol: string;
  series: AssetSeriesPoint[];
  range: AssetRange;
  hasPrice: boolean;
  pnlKnown: boolean;
  rangeChanges: Record<AssetRange, number | null>;
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
                      <Row name="Price" value={fmtMoney(payload[0].value)} />
                      <Row
                        name="Held"
                        value={fmtQty(payload[0].payload.held)}
                      />
                    </TooltipBox>
                  ) : null
                }
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={trendColor}
                strokeWidth={2}
                fill="url(#assetPriceFill)"
                connectNulls
                dot={false}
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
                <linearGradient id="assetPnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => axisLabel(d, multiYear)}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
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
                stroke={trendColor}
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
