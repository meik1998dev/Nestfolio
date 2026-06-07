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
import type { AccountType } from "@/lib/types";
import { createAccount } from "@/lib/ledger/accounts";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  cash: "Cash",
  crypto_wallet: "Crypto wallet",
  gold: "Gold",
  stock: "Stock / brokerage",
  expense: "Expense",
  external: "External (outside world)",
};

const TYPE_OPTIONS = Object.entries(ACCOUNT_TYPE_LABELS) as [
  AccountType,
  string,
][];

/** Dialog + form to create an account. Submits to the createAccount action. */
export function AccountForm() {
  const [open, setOpen] = useState(false);

  async function action(formData: FormData) {
    try {
      await createAccount(formData);
      toast.success("Account created");
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create account",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus />
            Add account
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New account</DialogTitle>
          <DialogDescription>
            A container of value — cash, a brokerage, a wallet, or the outside
            world.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="account-name">Name</Label>
            <Input
              id="account-name"
              name="name"
              placeholder="e.g. Checking"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-type">Type</Label>
            <Select name="type" defaultValue="cash">
              <SelectTrigger id="account-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="account-currency">Currency</Label>
            <Input
              id="account-currency"
              name="currency"
              defaultValue="USD"
              maxLength={3}
            />
          </div>
          <DialogFooter>
            <Button type="submit">Create account</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
