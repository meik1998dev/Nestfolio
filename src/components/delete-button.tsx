"use client";

import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * Small icon button that fires a delete Server Action with a hidden `id`.
 * Reused by accounts, holdings, and transactions.
 */
export function DeleteButton({
  id,
  action,
  label = "Delete",
  successMessage = "Deleted",
}: {
  id: string;
  action: (formData: FormData) => Promise<void>;
  label?: string;
  successMessage?: string;
}) {
  async function run(formData: FormData) {
    try {
      await action(formData);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete");
    }
  }

  return (
    <form action={run} className="inline">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        className="text-muted-foreground hover:text-destructive"
      >
        <Trash2 />
      </Button>
    </form>
  );
}
