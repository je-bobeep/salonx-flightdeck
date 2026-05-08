// PM-actionable status taxonomy — collapses Lark's 9+ statuses into three
// buckets that actually drive decisions. The pivot was: don't re-skin Lark.
// Lark statuses remain the wire format; we render the buckets.

export type StatusBucket = "mine" | "eng" | "done";

const MINE = new Set([
  "Pending PM PRD",
  "Pending PRD",
  "Exploring",
  "Logged",
  "In Discussion",
]);

const ENG = new Set([
  "Ready for Development",
  "Ready",
  "In Progress",
  "In Review",
  "In Testing",
  "Ready for Release",
  "Merged to Develop",
]);

const DONE = new Set(["Released", "Done", "Won't Do"]);

export function statusBucket(status: string): StatusBucket | "unknown" {
  if (!status || status === "—") return "unknown";
  if (MINE.has(status)) return "mine";
  if (ENG.has(status)) return "eng";
  if (DONE.has(status)) return "done";
  return "unknown";
}

export const BUCKET_LABEL: Record<StatusBucket, string> = {
  mine: "Mine to move",
  eng: "Eng's to move",
  done: "Shipped",
};

export const BUCKET_TONE: Record<StatusBucket, "warn" | "accent" | "success"> = {
  mine: "warn",
  eng: "accent",
  done: "success",
};

/**
 * Active = mine + eng. The PM cares about active state mix; Done is closed
 * inventory.
 */
export function isActive(status: string): boolean {
  const b = statusBucket(status);
  return b === "mine" || b === "eng";
}
