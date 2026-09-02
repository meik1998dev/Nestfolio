"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { PerformanceRange, PerformanceScopeOption } from "@/lib/performance/types";

const RANGES: PerformanceRange[] = ["1M", "3M", "6M", "1Y", "Max"];

export function PerformanceControls({
  options,
  scopeId,
  range,
}: {
  options: PerformanceScopeOption[];
  scopeId: string;
  range: PerformanceRange;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const hrefFor = (nextRange: PerformanceRange) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("scope", scopeId);
    params.set("range", nextRange);
    return `${pathname}?${params.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Scope</span>
        <select
          aria-label="Performance scope"
          value={scopeId}
          onChange={(event) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set("scope", event.target.value);
            params.set("range", range);
            router.push(`${pathname}?${params.toString()}`);
          }}
          className="border-input bg-background h-8 rounded-lg border px-2 text-sm"
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {`${"— ".repeat(option.depth)}${option.name}`}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-1" aria-label="Performance range">
        {RANGES.map((item) => (
          <Button
            key={item}
            size="xs"
            variant={item === range ? "secondary" : "ghost"}
            nativeButton={false}
            render={<Link href={hrefFor(item)}>{item}</Link>}
          />
        ))}
      </div>
    </div>
  );
}
