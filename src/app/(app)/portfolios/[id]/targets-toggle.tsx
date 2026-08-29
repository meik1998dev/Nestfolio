"use client";

/**
 * Quick on/off switch for this portfolio's target feature. Saves immediately;
 * the server action revalidates the page so the ring, the alignment score, the
 * Target column and the rebalance rows appear or disappear in one go.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Target, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setPortfolioTargetsEnabled } from "@/lib/portfolio/portfolios";

export function TargetsToggle({
  portfolioId,
  enabled,
}: {
  portfolioId: string;
  enabled: boolean;
}) {
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !on;
    setOn(next); // optimistic; reverted below if the write fails
    const fd = new FormData();
    fd.set("id", portfolioId);
    if (next) fd.set("targets_enabled", "on");
    startTransition(async () => {
      try {
        await setPortfolioTargetsEnabled(fd);
        toast.success(next ? "Targets enabled" : "Targets disabled");
      } catch (err) {
        setOn(!next);
        toast.error(
          err instanceof Error ? err.message : "Could not save the setting",
        );
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={pending}
      aria-pressed={on}
      title="Turn target allocations on or off for this portfolio"
    >
      {on ? <Target /> : <Ban />}
      {on ? "Targets on" : "Targets off"}
    </Button>
  );
}
