"use client";

import * as React from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

export interface SortableColumn {
  /** Stable identifier — matches the keys in each row's `cells`/`sort` maps. */
  key: string;
  header: string;
  /** Cell + header alignment. Defaults to left. */
  align?: "left" | "right";
  /** Only sortable columns render a clickable header. */
  sortable?: boolean;
  /** Extra classes for the <th> (e.g. width for an actions column). */
  headClassName?: string;
}

export interface SortableRow {
  /** React key for the row. */
  key: string;
  /** Pre-rendered cell node per column key (built in the server component). */
  cells: Record<string, React.ReactNode>;
  /** Primitive sort value per sortable column key. `null` always sinks last. */
  sort?: Record<string, number | string | null>;
}

/**
 * Config-driven sortable table. Pages stay Server Components and pass already
 * rendered cell nodes plus primitive sort values — no render functions cross
 * the RSC boundary. Sort state lives here on the client.
 *
 * Null sort values always sort to the bottom regardless of direction, so
 * unpriced / "—" rows never crowd the top.
 */
export function SortableTable({
  columns,
  rows,
  initialSort,
}: {
  columns: SortableColumn[];
  rows: SortableRow[];
  initialSort?: { key: string; dir: SortDir };
}) {
  const [sort, setSort] = React.useState<{ key: string; dir: SortDir } | null>(
    initialSort ?? null,
  );

  function toggle(key: string) {
    setSort((prev) =>
      prev?.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
  }

  const sortedRows = React.useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;
    // Decorate with original index for a stable sort.
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => {
        const cmp = compare(a.row.sort?.[key], b.row.sort?.[key], factor);
        return cmp !== 0 ? cmp : a.index - b.index;
      })
      .map((d) => d.row);
  }, [rows, sort]);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => {
            const active = sort?.key === col.key;
            const right = col.align === "right";
            return (
              <TableHead
                key={col.key}
                className={cn(
                  right && "text-right",
                  col.sortable && "p-0",
                  col.headClassName,
                )}
                aria-sort={
                  active
                    ? sort!.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {col.sortable ? (
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    className={cn(
                      "hover:text-foreground flex h-10 w-full items-center gap-1 px-2 font-medium transition-colors",
                      right ? "justify-end" : "justify-start",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {right && <SortIcon active={active} dir={sort?.dir} />}
                    {col.header}
                    {!right && <SortIcon active={active} dir={sort?.dir} />}
                  </button>
                ) : (
                  col.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.map((row) => (
          <TableRow key={row.key}>
            {columns.map((col) => (
              <TableCell
                key={col.key}
                className={cn(col.align === "right" && "text-right")}
              >
                {row.cells[col.key]}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SortIcon({ active, dir }: { active: boolean; dir?: SortDir }) {
  if (!active)
    return <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />;
  return dir === "asc" ? (
    <ArrowUp className="size-3.5" aria-hidden />
  ) : (
    <ArrowDown className="size-3.5" aria-hidden />
  );
}

/** Compare two sort values; nulls always sink to the bottom. `factor` flips
 *  direction for non-null comparisons only. */
function compare(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  factor: number,
): number {
  const an = a ?? null;
  const bn = b ?? null;
  if (an === null && bn === null) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  if (typeof an === "number" && typeof bn === "number") {
    return (an - bn) * factor;
  }
  return String(an).localeCompare(String(bn)) * factor;
}
