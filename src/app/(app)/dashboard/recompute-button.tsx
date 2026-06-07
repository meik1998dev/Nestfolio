"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RecomputeResponse {
  eventsWritten?: number;
  tickersUpserted?: number;
  error?: string;
}

/**
 * "Recompute" — rebuilds the cost-basis ledger from stored transfers, then
 * revalidates the page so refreshed realized/unrealized numbers render.
 */
export function RecomputeButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  async function recompute() {
    setLoading(true);
    try {
      const res = await fetch("/api/pnl/recompute", { method: "POST" });
      const json = (await res.json()) as RecomputeResponse;
      if (!res.ok) {
        toast.error(json.error ?? "Recompute failed");
      } else {
        toast.success(
          `Recomputed — ${json.tickersUpserted ?? 0} positions, ${json.eventsWritten ?? 0} events`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recompute failed");
    } finally {
      setLoading(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <Button onClick={recompute} disabled={loading}>
      <RefreshCw className={loading ? "animate-spin" : undefined} />
      {loading ? "Recomputing…" : "Recompute"}
    </Button>
  );
}
