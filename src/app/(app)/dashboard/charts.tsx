"use client";

/**
 * Client chart components for the dashboard (S5.3 / S5.4). All data is computed
 * on the server and passed in as props — these only render. Recharts needs a
 * client boundary; we keep each chart small and wrapped in ResponsiveContainer
 * so they reflow on resize.
 */
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { useRouter } from "next/navigation";
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
export function AllocationPie({
  slices,
  href,
}: {
  slices: BreakdownSlice[];
  /** When set, slices + legend rows link here (e.g. a portfolio page). */
  href?: string;
}) {
  const router = useRouter();
  if (slices.length === 0) {
    return <ChartEmpty label="No assets to allocate yet." />;
  }
  const go = href ? () => router.push(href) : undefined;
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
            onClick={go}
            className={href ? "cursor-pointer" : undefined}
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
          <li
            key={s.key}
            onClick={go}
            className={`flex items-center justify-between gap-3${
              href ? " hover:text-foreground cursor-pointer" : ""
            }`}
          >
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
