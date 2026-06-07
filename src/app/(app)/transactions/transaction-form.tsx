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
import type { Account, TransactionType } from "@/lib/types";
import { createTransaction } from "@/lib/ledger/transactions";

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: "income", label: "Income" },
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell" },
  { value: "transfer", label: "Transfer" },
  { value: "expense", label: "Expense" },
];

/** Whether each leg is an internal account for a given type. Income has an
 *  external source; expense has an external dest — those legs become optional. */
function legConfig(type: TransactionType) {
  return {
    sourceRequired: type !== "income",
    destRequired: type !== "expense",
    showCategory: type === "expense",
  };
}

const today = () => new Date().toISOString().slice(0, 10);

/** Dialog + form to log a transaction. */
export function TransactionForm({ accounts }: { accounts: Account[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TransactionType>("expense");
  const { sourceRequired, destRequired, showCategory } = legConfig(type);

  async function action(formData: FormData) {
    try {
      await createTransaction(formData);
      toast.success("Transaction logged");
      setOpen(false);
      setType("expense");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not log transaction",
      );
    }
  }

  const accountOptions = accounts.map((a) => (
    <SelectItem key={a.id} value={a.id}>
      {a.name}
    </SelectItem>
  ));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button disabled={accounts.length === 0}>
            <Plus />
            Log transaction
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log transaction</DialogTitle>
          <DialogDescription>
            Move value between accounts. Income enters from outside; expenses
            leave to outside.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="tx-type">Type</Label>
            <Select
              name="type"
              value={type}
              onValueChange={(v) => setType(v as TransactionType)}
            >
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

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tx-source">
                {sourceRequired ? "From" : "From (external)"}
              </Label>
              {sourceRequired ? (
                <Select name="source_account">
                  <SelectTrigger id="tx-source" className="w-full">
                    <SelectValue placeholder="Account" />
                  </SelectTrigger>
                  <SelectContent>{accountOptions}</SelectContent>
                </Select>
              ) : (
                <p className="text-muted-foreground flex h-8 items-center text-sm">
                  Outside world
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tx-dest">
                {destRequired ? "To" : "To (external)"}
              </Label>
              {destRequired ? (
                <Select name="dest_account">
                  <SelectTrigger id="tx-dest" className="w-full">
                    <SelectValue placeholder="Account" />
                  </SelectTrigger>
                  <SelectContent>{accountOptions}</SelectContent>
                </Select>
              ) : (
                <p className="text-muted-foreground flex h-8 items-center text-sm">
                  Outside world
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="tx-amount">Amount (USD)</Label>
              <Input
                id="tx-amount"
                name="amount"
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                required
              />
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
          </div>

          {showCategory && (
            <div className="grid gap-2">
              <Label htmlFor="tx-category">Category</Label>
              <Input
                id="tx-category"
                name="category"
                placeholder="e.g. Rent, Food, Travel"
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="tx-note">Note</Label>
            <Input
              id="tx-note"
              name="note"
              placeholder="Optional — what was this for?"
            />
          </div>

          <DialogFooter>
            <Button type="submit">Save transaction</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
