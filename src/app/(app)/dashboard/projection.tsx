"use client";

/**
 * Future-projection mini-section (S5.5). The investor tweaks monthly savings,
 * horizon, and the expected annual return; conservative/optimistic are derived
 * as a band around it. Math is the pure `projectWealth` — recomputed client-side
 * on every input change for instant feedback.
 */
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { projectWealth } from "@/lib/insights/projection";
import { formatUSD } from "@/lib/format";

export function ProjectionPanel({
  startingNetWorth,
}: {
  startingNetWorth: number;
}) {
  const [monthly, setMonthly] = useState(1000);
  const [years, setYears] = useState(10);
  const [expectedPct, setExpectedPct] = useState(7);

  const series = useMemo(() => {
    const expected = expectedPct / 100;
    return projectWealth({
      startingNetWorth: Math.max(0, startingNetWorth),
      monthlySavings: Math.max(0, monthly),
      years,
      returns: {
        // A symmetric band around the user's expected return.
        conservative: Math.max(0, expected - 0.03),
        expected,
        optimistic: expected + 0.03,
      },
    });
  }, [startingNetWorth, monthly, years, expectedPct]);

  const last = series[series.length - 1];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Field
          id="proj-monthly"
          label="Monthly savings"
          value={monthly}
          onChange={setMonthly}
          step={100}
          prefix="$"
        />
        <Field
          id="proj-years"
          label="Years"
          value={years}
          onChange={(v) => setYears(Math.min(50, Math.max(1, v)))}
          step={1}
        />
        <Field
          id="proj-return"
          label="Annual return"
          value={expectedPct}
          onChange={setExpectedPct}
          step={1}
          suffix="%"
        />
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={series} margin={{ left: 4, right: 8, top: 8 }}>
          <defs>
            <linearGradient id="projBand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="year"
            tickFormatter={(y) => `Y${y}`}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => formatUSD(v, { compact: true })}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="bg-popover rounded-md border px-3 py-2 text-xs shadow-md">
                  <p className="font-medium">Year {payload[0].payload.year}</p>
                  <p className="tabular-nums">
                    Expected: {formatUSD(payload[0].payload.expected)}
                  </p>
                  <p className="text-muted-foreground tabular-nums">
                    {formatUSD(payload[0].payload.conservative)} –{" "}
                    {formatUSD(payload[0].payload.optimistic)}
                  </p>
                </div>
              ) : null
            }
          />
          <Area
            type="monotone"
            dataKey="optimistic"
            stroke="none"
            fill="url(#projBand)"
          />
          <Area
            type="monotone"
            dataKey="conservative"
            stroke="none"
            fill="var(--background)"
          />
          <Line
            type="monotone"
            dataKey="expected"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-3 gap-3 text-center text-sm">
        <Outcome label="Conservative" value={last.conservative} />
        <Outcome label="Expected" value={last.expected} emphasis />
        <Outcome label="Optimistic" value={last.optimistic} />
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  step,
  prefix,
  suffix,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <div className="relative">
        {prefix && (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
            {prefix}
          </span>
        )}
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          min={0}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`tabular-nums ${prefix ? "pl-6" : ""} ${suffix ? "pr-7" : ""}`}
        />
        {suffix && (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function Outcome({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: number;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={`tabular-nums ${emphasis ? "text-lg font-semibold" : "text-sm font-medium"}`}
      >
        {formatUSD(value, { compact: true })}
      </p>
    </div>
  );
}
