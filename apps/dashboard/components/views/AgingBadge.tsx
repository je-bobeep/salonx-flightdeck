import type { AgingSignal } from "@flightdeck/lark/aging";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Worst-tier severity from a list. Drives row tint and chip color. */
export function worstSeverity(
  signals: AgingSignal[]
): "danger" | "warn" | null {
  if (!signals || signals.length === 0) return null;
  if (signals.some((s) => s.severity === "danger")) return "danger";
  return "warn";
}

/** Class string for tinting a row by its worst aging severity. */
export function rowTintClass(signals: AgingSignal[]): string {
  const sev = worstSeverity(signals);
  if (sev === "danger") return "bg-red-50/60 hover:bg-red-50";
  if (sev === "warn") return "bg-amber-50/40 hover:bg-amber-50";
  return "hover:bg-neutral-50";
}

export function AgingBadges({ signals }: { signals: AgingSignal[] }) {
  if (!signals || signals.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {signals.map((s, i) => (
        <Badge
          key={i}
          tone={s.severity === "danger" ? "danger" : "warn"}
          title={s.rule}
          className={cn(
            s.severity === "danger" &&
              "ring-red-300 ring-1 font-semibold"
          )}
        >
          <AlertTriangle className="mr-0.5 h-3 w-3" />
          {labelFor(s)}
        </Badge>
      ))}
    </span>
  );
}

function labelFor(s: AgingSignal): string {
  switch (s.kind) {
    case "bd-stale-logged":
      return s.daysOver > 0 ? `${s.daysOver}d stale` : "stale";
    case "dev-status-stale":
      return `${s.daysOver}d stuck`;
    case "dev-no-milestone":
      return "no milestone";
    case "dev-no-eta":
      return "no ETA";
    default:
      return "aging";
  }
}
