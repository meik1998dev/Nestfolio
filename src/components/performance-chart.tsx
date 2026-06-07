"use client";

/**
 * Portfolio value + P&L time-series chart — the dashboard / PnL counterpart to
 * the per-asset chart. Data is computed on the server and passed in; this only
 * renders. A "Value | P&L" toggle switches what the single chart shows, and the
 * range buttons are links that re-run the server computation via `?range=`
 * (pass `basePath` so the links target the host page).
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
import { formatUSD } from "@/lib/format";
import type { PerfPoint, PerfRange } from "@/lib/insights/performance.types";
import { PERF_RANGES } from "@/lib/insights/performance.types";

type View = "value" | "pnl";

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

  const multiYear =
    series.length > 1 &&
    series[0].date.slice(0, 4) !== series[series.length - 1].date.slice(0, 4);
  const data = series.map((p) => ({ ...p, label: axisLabel(p.date, multiYear) }));

  const lastTotal = data.length ? data[data.length - 1].total : null;
  const trendUp =
    view === "pnl"
      ? (lastTotal ?? 0) >= 0
      : data.length < 2 ||
        (data[data.length - 1].value ?? 0) >= (data[0].value ?? 0);
  const trendColor = trendUp
    ? "var(--color-emerald-600)"
    : "var(--color-red-600)";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Value | P&L toggle */}
        <div className="bg-muted inline-flex rounded-lg p-0.5">
          <ToggleButton active={view === "value"} onClick={() => setView("value")}>
            Value
          </ToggleButton>
          <ToggleButton active={view === "pnl"} onClick={() => setView("pnl")}>
            P&amp;L
          </ToggleButton>
        </div>
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

      {data.length === 0 ? (
        <div className="text-muted-foreground flex h-[260px] items-center justify-center text-sm">
          No history for this range yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          {view === "value" ? (
            <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="perfValueFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
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
                      <Row name="Value" value={fmtMoney(payload[0].value)} />
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
              />
            </AreaChart>
          ) : (
            <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="perfPnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis
                dataKey="label"
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
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <TooltipBox label={fullDate(payload[0].payload.date)}>
                      <Row name="Total" value={fmtSigned(payload[0].payload.total)} />
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
                stroke={trendColor}
                strokeWidth={2}
                fill="url(#perfPnlFill)"
                connectNulls
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="realized"
                name="Realized"
                stroke="var(--color-amber-500)"
                strokeWidth={1.5}
                dot={false}
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
