import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "danger" | "warn" | "accent" | "success";

const toneClasses: Record<Tone, string> = {
  neutral: "text-neutral-900",
  danger: "text-red-700",
  warn: "text-amber-700",
  accent: "text-blue-700",
  success: "text-green-700",
};

/**
 * Big-number anchor for the top of a view. Single answer to "what's the
 * question this view answers?". Use sparingly — one per page.
 */
export function HeadlineNumber({
  value,
  unit,
  label,
  helper,
  tone = "neutral",
  cta,
}: {
  value: string | number;
  unit?: string;
  label: string;
  helper?: string;
  tone?: Tone;
  cta?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-card">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className={cn("text-3xl font-semibold tabular-nums", toneClasses[tone])}>
            {value}
          </span>
          {unit ? (
            <span className="text-base text-neutral-500">{unit}</span>
          ) : null}
        </div>
        <div className="text-sm font-medium text-neutral-900">{label}</div>
        {helper ? (
          <div className="text-xs text-neutral-500">{helper}</div>
        ) : null}
      </div>
      {cta ? <div className="flex shrink-0 items-end">{cta}</div> : null}
    </div>
  );
}
