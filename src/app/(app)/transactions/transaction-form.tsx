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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TransactionType } from "@/lib/types";
import { createTransaction } from "@/lib/ledger/transactions";

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
];

const today = () => new Date().toISOString().slice(0, 10);

/** Dialog + form to log a manual asset trade (buy/sell). */
export function TransactionForm({ assets = [] }: { assets?: string[] }) {
  const [open, setOpen] = useState(false);

  async function action(formData: FormData) {
    try {
      await createTransaction(formData);
      toast.success("Trade logged");
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not log trade");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus />
            Log trade
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log trade</DialogTitle>
          <DialogDescription>
            Record a buy or sell of an asset — the quantity and the price you
            traded at.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tx-type">Type</Label>
              <Select name="type" defaultValue="buy">
                <SelectTrigger id="tx-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tx-asset">Asset</Label>
              <Input
                id="tx-asset"
                name="asset"
                placeholder="e.g. BTC, NVDA, XAU"
                list="tx-asset-options"
                autoComplete="off"
                required
              />
              {assets.length > 0 && (
                <datalist id="tx-asset-options">
                  {assets.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tx-amount">Quantity</Label>
              <Input
                id="tx-amount"
                name="amount"
                type="number"
                step="any"
                min="0"
                placeholder="0.0"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tx-price">Unit price (USD)</Label>
              <Input
                id="tx-price"
                name="price"
                type="number"
                step="any"
                min="0"
                placeholder="optional"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tx-date">Date</Label>
            <Input
              id="tx-date"
              name="date"
              type="date"
              defaultValue={today()}
              required
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="tx-note">Note</Label>
            <Input
              id="tx-note"
              name="note"
              placeholder="Optional — exchange, rationale, etc."
            />
          </div>

          <DialogFooter>
            <Button type="submit">Save trade</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
