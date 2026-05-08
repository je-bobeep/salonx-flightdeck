"use client";

import * as React from "react";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/**
 * Single-piece tooltip. Wrap any element in `<Tooltip content={...}>` to get a
 * dark hover-bubble. The provider is co-located here so callers don't have to
 * remember to mount one — Radix permits multiple providers, and a per-tooltip
 * provider scopes the open delay correctly.
 */
export function Tooltip({
  children,
  content,
  side = "top",
  align = "center",
  delayMs = 150,
  className,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayMs?: number;
  className?: string;
}) {
  return (
    <RadixTooltip.Provider delayDuration={delayMs}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            className={cn(
              "z-50 max-w-sm rounded-md border border-neutral-700 bg-neutral-900 px-3.5 py-2.5 text-sm leading-relaxed text-neutral-100 shadow-md",
              "animate-in fade-in-0 zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              className
            )}
          >
            {content}
            <RadixTooltip.Arrow className="fill-neutral-900" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
