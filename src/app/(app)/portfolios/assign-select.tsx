"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Portfolio } from "@/lib/types";
import { assignHolding } from "@/lib/portfolio/assign";

const NONE = "none";

/**
 * Inline select to assign a holding to a portfolio (S3.2). Fires the
 * assignHolding action on change — works for manual and wallet-sourced
 * holdings. Reassigning re-runs the rollup via revalidatePath.
 */
export function AssignSelect({
  holdingId,
  portfolios,
  currentPortfolioId,
}: {
  holdingId: string;
  portfolios: Portfolio[];
  currentPortfolioId: string | null;
}) {
  const [pending, startTransition] = useTransition();

  function onChange(value: string | null) {
    const portfolioId = !value || value === NONE ? null : value;
    startTransition(async () => {
      try {
        await assignHolding(holdingId, portfolioId);
        toast.success("Holding assigned");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not assign holding",
        );
      }
    });
  }

  return (
    <Select
      value={currentPortfolioId ?? NONE}
      onValueChange={onChange}
      disabled={pending}
    >
      <SelectTrigger className="w-full" aria-label="Assign to portfolio">
        <SelectValue placeholder="Unassigned" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Unassigned</SelectItem>
        {portfolios.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
