"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Hover-explainable "rising" badge. Shown next to a theme that's accumulating
 *  fresh BD feedback faster than usual. The signal is computed in
 *  `lib/themes/cluster.ts` (search "rising:") — keep this copy in sync if the
 *  threshold changes. */
export function RisingBadge({ className }: { className?: string }) {
  return (
    <Tooltip
      content={
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-semibold text-neutral-100">Rising theme</p>
          <p className="text-xs text-neutral-300">
            Three or more BD-feedback rows in this theme were created in the
            last 14 days — i.e. merchants are bringing this up at an above-average
            rate right now.
          </p>
          <p className="text-xs text-neutral-400">
            Useful as a velocity signal for prioritisation. Disabled when the
            cluster came from the deterministic fallback (no Claude call).
          </p>
        </div>
      }
    >
      <Badge tone="warn" className={cn("cursor-help", className)}>
        rising
      </Badge>
    </Tooltip>
  );
}
