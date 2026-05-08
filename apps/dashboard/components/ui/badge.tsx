import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warn" | "danger" | "accent";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-neutral-100 text-neutral-700",
  success: "bg-green-50 text-green-700 ring-green-600/10",
  warn: "bg-amber-50 text-amber-700 ring-amber-600/10",
  danger: "bg-red-50 text-red-700 ring-red-600/10",
  accent: "bg-blue-50 text-blue-700 ring-blue-600/10",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        toneClasses[tone],
        tone === "neutral" && "ring-neutral-200",
        className
      )}
      {...props}
    />
  );
}
