"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addWallet } from "@/lib/wallet/wallets";

/**
 * Save / update the tracked public BNB address. Read-only sync — we explicitly
 * tell the user no keys or signatures are needed.
 */
export function WalletForm({ currentAddress }: { currentAddress?: string }) {
  const [pending, setPending] = useState(false);

  async function action(formData: FormData) {
    setPending(true);
    try {
      await addWallet(formData);
      toast.success("Address saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save address",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-2">
        <Label htmlFor="wallet-address">Public BNB address</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="wallet-address"
            name="address"
            placeholder="0x…"
            defaultValue={currentAddress}
            spellCheck={false}
            autoComplete="off"
            className="font-mono"
            required
          />
          <Button type="submit" disabled={pending}>
            <WalletIcon />
            {currentAddress ? "Update address" : "Save address"}
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Read-only. We store only the public address — no keys, no signatures.
      </p>
    </form>
  );
}
