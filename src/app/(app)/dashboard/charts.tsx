"use client";

/**
 * Client chart components for the dashboard (S5.3 / S5.4). All data is computed
 * on the server and passed in as props — these only render. Recharts needs a
 * client boundary; we keep each chart small and wrapped in ResponsiveContainer
 * so they reflow on resize.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BreakdownSlice } from "@/lib/insights/networth";
import { formatUSD, formatRatioPct } from "@/lib/format";

// The five chart color tokens from globals.css, in order.
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/** Where money sits — donut of a breakdown (asset class / portfolio). */
export function AllocationPie({ slices }: { slices: BreakdownSlice[] }) {
  if (slices.length === 0) {
    return <ChartEmpty label="No assets to allocate yet." />;
  }
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <ResponsiveContainer width="100%" height={200} className="max-w-[220px]">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="label"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            strokeWidth={0}
          >
            {slices.map((s, i) => (
              <Cell key={s.key} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TooltipBox
                  label={payload[0].payload.label}
                  value={formatUSD(payload[0].payload.value)}
                  sub={formatRatioPct(payload[0].payload.share)}
                />
              ) : null
            }
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="flex-1 space-y-2 text-sm">
        {slices.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              {s.label}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {formatRatioPct(s.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Assets vs liabilities, as two stacked horizontal-ish bars. */
export function AssetLiabilityBars({
  assets,
  liabilities,
}: {
  assets: number;
  liabilities: number;
}) {
  const data = [
    { name: "Assets", value: assets, fill: "var(--chart-1)" },
    { name: "Liabilities", value: liabilities, fill: "var(--chart-3)" },
  ];
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
        <XAxis
          type="number"
          tickFormatter={(v) => formatUSD(v, { compact: true })}
          tick={{ fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={72}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)" }}
          content={({ active, payload }) =>
            active && payload?.length ? (
              <TooltipBox
                label={payload[0].payload.name}
                value={formatUSD(payload[0].payload.value)}
              />
            ) : null
          }
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Net-worth history over time (S5.3). */
export function NetWorthHistory({
  series,
}: {
  series: Array<{ taken_at: string; net_worth: number }>;
}) {
  const data = series.map((s) => ({
    date: new Date(s.taken_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    value: s.net_worth,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
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
        <Tooltip
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox
                label={String(label)}
                value={formatUSD(Number(payload[0].value))}
              />
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="url(#nwFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function TooltipBox({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-popover rounded-md border px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{label}</p>
      <p className="tabular-nums">{value}</p>
      {sub && <p className="text-muted-foreground tabular-nums">{sub}</p>}
    </div>
  );
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">
      {label}
    </div>
  );
}
