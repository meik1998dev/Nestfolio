"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoTip } from "@/components/info-tip";
import { formatDate, formatRatioPct } from "@/lib/format";
import type { BenchmarkPoint } from "@/lib/performance/types";

export function ComparisonChart({
  series,
  timeWeightedReturn,
  annualizedTimeWeightedReturn,
  benchmarkReturn,
}: {
  series: BenchmarkPoint[];
  timeWeightedReturn: number | null;
  annualizedTimeWeightedReturn: number | null;
  benchmarkReturn: number | null;
}) {
  const hasBenchmark = series.some((point) => point.benchmarkReturn != null);
  const signed = (value: number | null) =>
    value == null ? "Not ready" : formatRatioPct(value, { signed: true });
  const gap =
    timeWeightedReturn != null && benchmarkReturn != null ? timeWeightedReturn - benchmarkReturn : null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Your picks vs the market (S&amp;P 500)</CardTitle>
          <InfoTip>
            This chart answers &quot;were my stock choices good?&quot;, not &quot;did I make more money?&quot;.
            It pretends you put $1 in on day one and never added more, then follows how your picks moved
            against the index. The tile above answers the money question with your real deposits on their
            real dates. Both lines start at 0% on the first date.
          </InfoTip>
        </div>
        <CardDescription className="tabular-nums">
          Your picks {signed(timeWeightedReturn)}
          {annualizedTimeWeightedReturn != null && ` (${formatRatioPct(annualizedTimeWeightedReturn)} per year)`}
          {" · "}S&amp;P 500 {signed(benchmarkReturn)}
          {gap != null && ` · Gap ${signed(gap)}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!hasBenchmark ? (
          <div className="text-muted-foreground flex h-72 items-center justify-center text-center text-sm">
            S&amp;P 500 history is missing for this range. The return of your picks is shown above.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={series} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.35} />
              <XAxis
                dataKey="date"
                tickFormatter={(date) =>
                  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
                minTickGap={32}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip content={<ComparisonTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="portfolioReturn"
                name="Your picks"
                stroke="var(--color-emerald-600)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="benchmarkReturn"
                name="S&P 500"
                stroke="var(--color-violet-500)"
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function ComparisonTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: BenchmarkPoint }> }) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const gap =
    point.benchmarkReturn == null
      ? null
      : point.portfolioReturn - point.benchmarkReturn;
  return (
    <div className="bg-popover space-y-1 rounded-lg border p-3 text-xs shadow-md">
      <p className="font-medium">{formatDate(point.date)}</p>
      <p>Your picks: {formatRatioPct(point.portfolioReturn, { signed: true })}</p>
      <p>S&amp;P 500: {point.benchmarkReturn == null ? "—" : formatRatioPct(point.benchmarkReturn, { signed: true })}</p>
      <p className="font-medium">Gap: {gap == null ? "—" : formatRatioPct(gap, { signed: true })}</p>
    </div>
  );
}
