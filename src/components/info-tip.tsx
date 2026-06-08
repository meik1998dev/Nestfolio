"use client";

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Small "?" info icon that reveals an explanation on hover/focus. Used to make
 * every finance metric self-documenting — the root layout already mounts the
 * TooltipProvider, so this only needs the Root/Trigger/Content.
 */
export function InfoTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="text-muted-foreground/70 hover:text-foreground inline-flex align-middle transition-colors"
        aria-label="More info"
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem] leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
