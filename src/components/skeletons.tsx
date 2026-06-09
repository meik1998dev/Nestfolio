import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Composable skeleton primitives for `<Suspense>` fallbacks.
 *
 * Every `(app)` page renders its real `PageHeader` (and any static chrome)
 * instantly, then wraps the data-driven body in a `<Suspense>` whose fallback
 * is composed from these blocks. They mirror the house style established by
 * `app/(app)/dashboard/loading.tsx`: `<Card>` shells with pulsing `<Skeleton>`
 * lines, on a `space-y-6` page rhythm.
 *
 * All components here are pure presentational Server Components — no data, no
 * client hooks, no "use client". Do NOT put a `PageHeader` inside these; the
 * page owns that.
 */

/**
 * Generic `<Card>` shell with an optional header (title line + description
 * lines) and a body skeleton. Mirrors any plain content Card on the pages
 * (e.g. the wallet address card, a position summary, an info panel).
 */
export function CardSkeleton({
  /** Render a title-line skeleton in the header. */
  title = true,
  /** Number of description lines under the title (0 to omit). */
  descriptionLines = 1,
  /** Height of the body skeleton block (Tailwind h-* class). */
  bodyHeight = "h-24",
  /** Hide the body block entirely (header-only card, e.g. a hero). */
  body = true,
  className,
}: {
  title?: boolean;
  descriptionLines?: number;
  bodyHeight?: string;
  body?: boolean;
  className?: string;
} = {}) {
  return (
    <Card className={className}>
      {(title || descriptionLines > 0) && (
        <CardHeader className="space-y-2">
          {title && <Skeleton className="h-5 w-40" />}
          {Array.from({ length: descriptionLines }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-56" />
          ))}
        </CardHeader>
      )}
      {body && (
        <CardContent className={title || descriptionLines > 0 ? undefined : "pt-6"}>
          <Skeleton className={cn("w-full", bodyHeight)} />
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Responsive grid of small stat cards (label line + value line each). Mirrors
 * the dashboard's `grid-cols-2 lg:grid-cols-4` stat strip and the static-PnL
 * fallback grid on the asset detail page.
 */
export function StatCardsSkeleton({
  /** How many stat cards to render. */
  count = 4,
  /** Columns at the `lg` breakpoint (cards are always 2-wide on mobile). */
  columns = 4,
  className,
}: {
  count?: number;
  columns?: 2 | 3 | 4;
  className?: string;
} = {}) {
  const lgCols =
    columns === 2
      ? "lg:grid-cols-2"
      : columns === 3
        ? "lg:grid-cols-3"
        : "lg:grid-cols-4";
  return (
    <div className={cn("grid grid-cols-2 gap-4", lgCols, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardContent className="space-y-2 pt-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-28" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Table placeholder: a header row plus `rows` body rows of `columns` cells.
 * Card-wrapped by default (with an optional title/description header) to mirror
 * the holdings / transactions / wallet-balances / portfolio tables; pass
 * `card={false}` to drop it into an existing Card body.
 */
export function TableSkeleton({
  /** Number of body rows. */
  rows = 6,
  /** Number of columns per row. */
  columns = 5,
  /** Wrap in a `<Card>` (with header). When false, renders the bare table grid. */
  card = true,
  /** Render a title-line skeleton in the card header (ignored when card=false). */
  title = true,
  /** Description lines under the title (ignored when card=false). */
  descriptionLines = 1,
  className,
}: {
  rows?: number;
  columns?: number;
  card?: boolean;
  title?: boolean;
  descriptionLines?: number;
  className?: string;
} = {}) {
  const gridTemplate = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  const grid = (
    <div className={cn("w-full", !card && className)}>
      {/* Header row */}
      <div
        className="grid items-center gap-4 border-b pb-3"
        style={gridTemplate}
      >
        {Array.from({ length: columns }).map((_, c) => (
          <Skeleton key={c} className="h-4 w-16" />
        ))}
      </div>
      {/* Body rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid items-center gap-4 border-b py-3 last:border-0"
          style={gridTemplate}
        >
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className="h-4 w-full max-w-24" />
          ))}
        </div>
      ))}
    </div>
  );

  if (!card) return grid;

  return (
    <Card className={className}>
      {(title || descriptionLines > 0) && (
        <CardHeader className="space-y-2">
          {title && <Skeleton className="h-5 w-40" />}
          {Array.from({ length: descriptionLines }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-56" />
          ))}
        </CardHeader>
      )}
      <CardContent>{grid}</CardContent>
    </Card>
  );
}

/**
 * Card with a title line and a tall chart-area block. Mirrors the dashboard
 * chart cards and the "Performance" / "Allocation" cards on the detail pages.
 */
export function ChartCardSkeleton({
  /** Height of the chart area (Tailwind h-* class). */
  height = "h-64",
  /** Render a description line under the title. */
  description = true,
  className,
}: {
  height?: string;
  description?: boolean;
  className?: string;
} = {}) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-2">
        <Skeleton className="h-5 w-40" />
        {description && <Skeleton className="h-4 w-56" />}
      </CardHeader>
      <CardContent>
        <Skeleton className={cn("w-full", height)} />
      </CardContent>
    </Card>
  );
}

/**
 * Card mirroring the big "Portfolio value" hero: a small label line above a
 * large value line. Used by the portfolio detail page (and the portfolios list
 * "Total allocated value" card).
 */
export function HeroValueSkeleton({
  className,
}: {
  className?: string;
} = {}) {
  return (
    <Card className={className}>
      <CardHeader className="space-y-3 pb-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-64" />
      </CardHeader>
    </Card>
  );
}
