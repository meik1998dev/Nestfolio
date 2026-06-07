"use client";

import { useTransition } from "react";
import { Camera } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { takeSnapshotForCurrentUser } from "@/lib/insights/snapshot";

/** Triggers a manual net-worth snapshot (used by the history empty state). */
export function SnapshotButton({
  variant = "default",
  label = "Take snapshot now",
}: {
  variant?: "default" | "outline";
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      try {
        const res = await takeSnapshotForCurrentUser();
        toast.success(
          res.status === "created"
            ? "Snapshot saved"
            : "Already snapshotted today",
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Could not take snapshot",
        );
      }
    });
  }

  return (
    <Button variant={variant} onClick={run} disabled={pending}>
      <Camera />
      {pending ? "Saving…" : label}
    </Button>
  );
}
