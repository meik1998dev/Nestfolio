"use client";

/**
 * Allocation donut with an optional TARGET ring (per-asset target %). The inner
 * ring is the live/actual allocation; the outer ring is the target policy (plus
 * an "Untargeted" remainder so the ring is anchored to 100%). The legend lists
 * actual %, target %, and drift (over/under) per asset.
 */
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AllocationSlice } from "@/lib/portfolio/detail";
import Link from "next/link";
import { formatRatioPct, formatPct, formatUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AssetLink } from "@/components/asset-link";

/**
 * A 20-color categorical palette — distinct, evenly-spaced hues so adjacent
 * slices and their legend dots are easy to tell apart (the theme's grayscale
 * --chart-* tokens were unreadable past ~5 assets). Each asset keeps the same
 * color on the inner (actual) and outer (target) ring so the two connect.
 */
const PALETTE = [
  "#2563eb", // blue
  "#f97316", // orange
  "#16a34a", // green
  "#dc2626", // red
  "#9333ea", // purple
  "#0891b2", // cyan
  "#ca8a04", // amber
  "#db2777", // pink
  "#65a30d", // lime
  "#4f46e5", // indigo
  "#ea580c", // dark orange
  "#0d9488", // teal
  "#e11d48", // rose
  "#7c3aed", // violet
  "#059669", // emerald
  "#d97706", // yellow-700
  "#0284c7", // sky
  "#be123c", // crimson
  "#a16207", // brown
  "#4338ca", // deep indigo
];

/**
 * How closely actual allocation tracks target, as a 0–100% score.
 *
 *   alignment = 100 − ½ · Σ|driftᵢ|
 *
 * Σ of absolute drifts double-counts (every % over one asset is a % under
 * another), so halving it gives the share of the book in the wrong place;
 * inverting gives the share correctly placed. The untargeted remainder folds in
 * as one synthetic asset (actual = untargeted share, target = 100 − Σtargets),
 * mirroring the pie's "Untargeted" outer slice, so an under-targeted book can't
 * score falsely high. Null when no targets are set.
 */
function alignmentPct(slices: AllocationSlice[]): number | null {
  const targeted = slices.filter((s) => s.targetPct != null);
  if (targeted.length === 0) return null;

  const targetSum = targeted.reduce((sum, s) => sum + (s.targetPct ?? 0), 0);
  const untargetedShare = slices
    .filter((s) => s.targetPct == null)
    .reduce((sum, s) => sum + s.share * 100, 0);

  const absDrift =
    targeted.reduce((sum, s) => sum + Math.abs(s.driftPct ?? 0), 0) +
    Math.abs(untargetedShare - Math.max(0, 100 - targetSum));

  return Math.max(0, 100 - absDrift / 2);
}

export function TargetAllocationPie({
  slices,
  targetsEnabled = true,
}: {
  slices: AllocationSlice[];
  /** False = the portfolio has the target feature off: pure actual-allocation donut. */
  targetsEnabled?: boolean;
}) {
  if (slices.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">
        No assets to allocate yet.
      </div>
    );
  }

  const colorFor = (i: number) => PALETTE[i % PALETTE.length];
  const anyTarget = slices.some((s) => s.targetPct != null);

  // Subtree total (slices cover the whole value) — converts target% → dollars.
  const totalValue = slices.reduce((sum, s) => sum + s.value, 0);
  // Dollars to buy (+) or sell (−) to hit target. Only meaningful past the
  // 1pp drift threshold; smaller drifts are treated as already on-target.
  const tradeToTarget = (s: AllocationSlice): number | null => {
    if (s.targetPct == null || s.driftPct == null) return null;
    if (Math.abs(s.driftPct) < 1) return null;
    return (totalValue * s.targetPct) / 100 - s.value;
  };

  // Outer ring data: each asset's target, plus an "Untargeted" remainder.
  const targetSum = slices.reduce((s, x) => s + (x.targetPct ?? 0), 0);
  const targetData = [
    ...slices.map((s, i) => ({
      key: s.key,
      label: s.label,
      value: s.targetPct ?? 0,
      color: colorFor(i),
    })),
    ...(targetSum < 100
      ? [
          {
            key: "__untargeted__",
            label: "Untargeted",
            value: 100 - targetSum,
            color: "var(--muted)",
          },
        ]
      : []),
  ];

  const alignment = alignmentPct(slices);

  return (
    <div className="flex flex-col gap-4">
      {alignment != null && (
        <div className="flex items-baseline justify-between gap-3 border-b pb-3">
          <span className="text-muted-foreground text-sm">
            Target alignment
          </span>
          <span
            className={cn(
              "text-lg font-semibold tabular-nums",
              alignment >= 90
                ? "text-emerald-600 dark:text-emerald-500"
                : alignment >= 75
                  ? "text-amber-600 dark:text-amber-500"
                  : "text-red-600 dark:text-red-500",
            )}
          >
            {formatPct(alignment)}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <ResponsiveContainer
          width="100%"
          height={220}
          className="max-w-[240px]"
        >
          <PieChart>
            {/* Inner ring = actual allocation */}
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={42}
              outerRadius={64}
              paddingAngle={2}
              strokeWidth={0}
            >
              {slices.map((s, i) => (
                <Cell key={s.key} fill={colorFor(i)} />
              ))}
            </Pie>
            {/* Outer ring = target allocation */}
            {anyTarget && (
              <Pie
                data={targetData}
                dataKey="value"
                nameKey="label"
                innerRadius={70}
                outerRadius={86}
                paddingAngle={1}
                strokeWidth={0}
              >
                {targetData.map((t) => (
                  <Cell key={t.key} fill={t.color} fillOpacity={0.45} />
                ))}
              </Pie>
            )}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload;
                // Inner (actual) slices carry `share`; outer (target) slices don't.
                const isActual = "share" in p && p.share !== undefined;
                return (
                  <div className="bg-popover rounded-md border px-3 py-2 text-xs shadow-md">
                    <p className="font-medium">{p.label}</p>
                    <p className="text-muted-foreground tabular-nums">
                      {isActual
                        ? `Actual ${formatRatioPct(p.share)}`
                        : p.key === "__untargeted__"
                          ? `Untargeted ${formatPct(p.value)}`
                          : `Target ${formatPct(p.value)}`}
                    </p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        <ul className="flex-1 space-y-2 text-sm">
          {slices.map((s, i) => {
            const trade = tradeToTarget(s);
            return (
              <li
                key={s.key}
                className="flex items-center justify-between gap-3"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block size-2.5 rounded-full"
                    style={{ background: colorFor(i) }}
                  />
                  {s.kind === "portfolio" && s.href ? (
                    <Link
                      href={s.href}
                      className="hover:text-primary font-medium hover:underline"
                    >
                      {s.label}
                    </Link>
                  ) : (
                    <AssetLink symbol={s.symbol ?? s.label}>
                      {s.label}
                    </AssetLink>
                  )}
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span>{formatRatioPct(s.share)}</span>
                  {!targetsEnabled ? null : s.targetPct != null ? (
                    <>
                      <span className="text-muted-foreground">
                        / {formatPct(s.targetPct)}
                      </span>
                      {trade != null && (
                        <span
                          className={cn(
                            "text-xs",
                            trade < 0
                              ? "text-red-600 dark:text-red-500"
                              : "text-emerald-600 dark:text-emerald-500",
                          )}
                        >
                          {trade < 0 ? "Sell " : "Buy "}
                          {formatUSD(Math.abs(trade))}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">/ —</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
