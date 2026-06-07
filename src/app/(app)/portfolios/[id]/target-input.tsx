"use client";

/**
 * Inline editor for a holding's target allocation %. Saves on blur / Enter (only
 * when the value actually changed); an empty value clears the target. Optimistic
 * toast feedback; the server action revalidates the page to refresh the pie.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { setHoldingTarget } from "@/lib/ledger/holdings";

export function TargetInput({
  holdingId,
  target,
}: {
  holdingId: string;
  target: number | null;
}) {
  const initial = target != null ? String(target) : "";
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);

  async function save() {
    if (value === saved) return;
    const fd = new FormData();
    fd.set("id", holdingId);
    fd.set("target_pct", value);
    try {
      await setHoldingTarget(fd);
      setSaved(value);
      toast.success(value === "" ? "Target cleared" : "Target saved");
    } catch (err) {
      setValue(saved); // revert on error
      toast.error(err instanceof Error ? err.message : "Could not save target");
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        type="number"
        step="any"
        min="0"
        max="100"
        inputMode="decimal"
        placeholder="—"
        aria-label="Target %"
        className="h-8 w-16 text-right tabular-nums"
      />
      <span className="text-muted-foreground text-xs">%</span>
    </div>
  );
}
