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
import { formatRatioPct, formatPct } from "@/lib/format";
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

export function TargetAllocationPie({ slices }: { slices: AllocationSlice[] }) {
  if (slices.length === 0) {
    return (
      <div className="text-muted-foreground flex h-[200px] items-center justify-center text-sm">
        No assets to allocate yet.
      </div>
    );
  }

  const colorFor = (i: number) => PALETTE[i % PALETTE.length];
  const anyTarget = slices.some((s) => s.targetPct != null);

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

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <ResponsiveContainer width="100%" height={220} className="max-w-[240px]">
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
        {slices.map((s, i) => (
          <li key={s.key} className="flex items-center justify-between gap-3">
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
                <AssetLink symbol={s.symbol ?? s.label}>{s.label}</AssetLink>
              )}
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              <span>{formatRatioPct(s.share)}</span>
              {s.targetPct != null ? (
                <>
                  <span className="text-muted-foreground">
                    / {formatPct(s.targetPct)}
                  </span>
                  {s.driftPct != null && Math.abs(s.driftPct) >= 0.05 && (
                    <span
                      className={cn(
                        "text-xs",
                        s.driftPct < 0
                          ? "text-red-600 dark:text-red-500"
                          : "text-emerald-600 dark:text-emerald-500",
                      )}
                    >
                      {formatPct(s.driftPct, { signed: true })}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">/ —</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
