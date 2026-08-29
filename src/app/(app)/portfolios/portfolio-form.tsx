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
import type { Portfolio } from "@/lib/types";
import { createPortfolio } from "@/lib/portfolio/portfolios";
import { TargetsEnabledField } from "./edit-portfolio";

const NONE = "none";

/** Dialog + form to create a portfolio (name, optional parent, optional target %). */
export function PortfolioForm({ portfolios }: { portfolios: Portfolio[] }) {
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState<string>(NONE);

  async function action(formData: FormData) {
    formData.set("parent_id", parent);
    try {
      await createPortfolio(formData);
      toast.success("Portfolio created");
      setParent(NONE);
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not create portfolio",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button>
            <Plus />
            Add portfolio
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New portfolio</DialogTitle>
          <DialogDescription>
            Group holdings; nest under a parent to any depth. Target % is
            relative to the parent (siblings sum to 100%).
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="portfolio-name">Name</Label>
            <Input
              id="portfolio-name"
              name="name"
              placeholder="e.g. Stocks, Crypto, Gold"
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="portfolio-parent">Parent (optional)</Label>
            <Select value={parent} onValueChange={(v) => setParent(v ?? NONE)}>
              <SelectTrigger id="portfolio-parent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None (top level)</SelectItem>
                {portfolios.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="portfolio-target">
              Target % of parent (optional)
            </Label>
            <Input
              id="portfolio-target"
              name="target_pct"
              type="number"
              step="any"
              min="0"
              max="100"
              placeholder="e.g. 60"
            />
          </div>
          <TargetsEnabledField defaultChecked />
          <DialogFooter>
            <Button type="submit">Create portfolio</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
