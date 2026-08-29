"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
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
import { updatePortfolio } from "@/lib/portfolio/portfolios";

const NONE = "none";

/**
 * Edit a portfolio: rename, reparent, set target % (S3.1 / S3.3). The parent
 * select excludes the node itself; the server action additionally rejects
 * cycles (nesting under a descendant).
 */
export function EditPortfolioButton({
  portfolio,
  portfolios,
}: {
  portfolio: Portfolio;
  portfolios: Portfolio[];
}) {
  const [open, setOpen] = useState(false);
  const [parent, setParent] = useState<string>(portfolio.parent_id ?? NONE);

  async function action(formData: FormData) {
    formData.set("id", portfolio.id);
    formData.set("parent_id", parent);
    try {
      await updatePortfolio(formData);
      toast.success("Portfolio updated");
      setOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not update portfolio",
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Edit ${portfolio.name}`}
            className="text-muted-foreground"
          >
            <Pencil />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit portfolio</DialogTitle>
          <DialogDescription>
            Rename, move under another portfolio, or set its target % of the
            parent.
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              name="name"
              defaultValue={portfolio.name}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-parent">Parent</Label>
            <Select value={parent} onValueChange={(v) => setParent(v ?? NONE)}>
              <SelectTrigger id="edit-parent" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>None (top level)</SelectItem>
                {portfolios
                  .filter((p) => p.id !== portfolio.id)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-target">Target % of parent</Label>
            <Input
              id="edit-target"
              name="target_pct"
              type="number"
              step="any"
              min="0"
              max="100"
              defaultValue={portfolio.target_pct ?? ""}
              placeholder="Leave blank for no target"
            />
          </div>
          <TargetsEnabledField defaultChecked={portfolio.targets_enabled} />
          <DialogFooter>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The per-portfolio on/off switch for the target feature. Unchecked posts
 * nothing, which the server action reads as OFF.
 */
export function TargetsEnabledField({
  defaultChecked,
}: {
  defaultChecked: boolean;
}) {
  return (
    <div className="grid gap-1">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="targets_enabled"
          defaultChecked={defaultChecked}
          className="accent-primary size-4"
        />
        Use target allocations inside this portfolio
      </label>
      <p className="text-muted-foreground text-xs">
        Off hides target %, drift, alignment and rebalancing for this
        portfolio&apos;s holdings and its direct sub-portfolios.
      </p>
    </div>
  );
}
