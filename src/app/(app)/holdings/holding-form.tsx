"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
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
import { createHolding } from "@/lib/ledger/holdings";

/** Dialog + form to add a manual holding (asset + amount). */
export function HoldingForm() {
  const [open, setOpen] = useState(false);

  async function action(formData: FormData) {
    try {
      await createHolding(formData);
      toast.success("Holding added");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add holding");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Plus />
            Add holding
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New holding</DialogTitle>
          <DialogDescription>
            A manual asset position — units of BTC, grams of gold, shares.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="holding-asset">Asset</Label>
            <Input
              id="holding-asset"
              name="asset"
              placeholder="e.g. BTC, XAU, AAPL"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="holding-amount">Amount</Label>
            <Input
              id="holding-amount"
              name="amount"
              type="number"
              step="any"
              min="0"
              placeholder="0.0"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit">Add holding</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
