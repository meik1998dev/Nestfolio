"use client";

/**
 * Dialog + form to add or edit a liability (S5.2). Reused on the dashboard's
 * liabilities card. Submits to the create/update Server Actions.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Liability } from "@/lib/types";
import { createLiability, updateLiability } from "@/lib/insights/liabilities";

export function LiabilityForm({ liability }: { liability?: Liability }) {
  const editing = Boolean(liability);
  const [open, setOpen] = useState(false);

  async function action(formData: FormData) {
    try {
      if (editing) await updateLiability(formData);
      else await createLiability(formData);
      toast.success(editing ? "Liability updated" : "Liability added");
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save liability",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          editing ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${liability!.name}`}
              className="text-muted-foreground"
            >
              <Pencil />
            </Button>
          ) : (
            <Button variant="outline" size="sm">
              <Plus />
              Add liability
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit liability" : "New liability"}
          </DialogTitle>
          <DialogDescription>
            Debts reduce your net worth — loans, credit cards, mortgages.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          {editing && <input type="hidden" name="id" value={liability!.id} />}
          <div className="grid gap-2">
            <Label htmlFor="liability-name">Name</Label>
            <Input
              id="liability-name"
              name="name"
              placeholder="e.g. Car loan"
              defaultValue={liability?.name ?? ""}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="liability-type">Type</Label>
            <Input
              id="liability-type"
              name="type"
              placeholder="e.g. loan, credit card, mortgage"
              defaultValue={liability?.type ?? ""}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="liability-balance">Outstanding balance (USD)</Label>
            <Input
              id="liability-balance"
              name="balance"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              defaultValue={liability?.balance ?? ""}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit">
              {editing ? "Save changes" : "Add liability"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
