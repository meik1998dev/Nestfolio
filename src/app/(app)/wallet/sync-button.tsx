"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A sync outcome from POST /api/sync. */
interface SyncResponse {
  status?: string;
  transfersAdded?: number;
  holdingsUpserted?: number;
  error?: string;
}

/**
 * "Sync now" — calls POST /api/sync, shows a spinner + toast, and revalidates
 * the page so the freshly synced balances/status render.
 */
export function SyncButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [, startTransition] = useTransition();

  async function sync() {
    setLoading(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = (await res.json()) as SyncResponse;

      if (!res.ok) {
        toast.error(json.error ?? "Sync failed");
      } else if (json.status === "synced") {
        toast.success(
          `Synced — ${json.holdingsUpserted ?? 0} balances, ${json.transfersAdded ?? 0} transfers, P&L updated`,
        );
      } else {
        toast.warning(
          `Sync degraded — showing last-known data${json.error ? `: ${json.error}` : ""}`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
      startTransition(() => router.refresh());
    }
  }

  return (
    <Button onClick={sync} disabled={disabled || loading}>
      <RefreshCw className={loading ? "animate-spin" : undefined} />
      {loading ? "Syncing…" : "Sync now"}
    </Button>
  );
}
