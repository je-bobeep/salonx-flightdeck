// Display formatters used across views.

import { format, parseISO, isValid } from "date-fns";

/**
 * Format a Lark-side date string. Lark returns dates either as ISO strings
 * ("2026-04-08") or epoch ms numbers stringified ("1759987200000"). Returns a
 * short human label like "Apr 8" for the current year, "Apr 8 '25" otherwise.
 * Returns "—" for empty / unparseable input.
 */
export function formatLarkDate(value: string | undefined | null): string {
  if (!value) return "—";
  const s = String(value).trim();
  if (s === "") return "—";

  // numeric epoch ms?
  const num = Number(s);
  let date: Date | null = null;
  if (Number.isFinite(num) && num > 0) {
    date = new Date(num);
  } else {
    const parsed = parseISO(s);
    if (isValid(parsed)) date = parsed;
  }
  if (!date || !isValid(date)) return "—";

  const sameYear = date.getFullYear() === new Date().getFullYear();
  return sameYear ? format(date, "MMM d") : format(date, "MMM d ''yy");
}

/** Same shape but accepts numeric ms or null/undefined. */
export function formatDateMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const date = new Date(ms);
  if (!isValid(date)) return "—";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return sameYear ? format(date, "MMM d") : format(date, "MMM d ''yy");
}
