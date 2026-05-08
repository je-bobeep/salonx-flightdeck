import { BD_FIELDS, FD_FIELDS, readDateMs, readLinkIds, readString } from "./schemas";
import type { BdFeedbackRecord, FeatureDevRecord } from "./schemas";
import type { RawRecord } from "./bitable";

export type AgingSignal = {
  kind:
    | "bd-stale-logged" // BD Feedback unaddressed >14d
    | "dev-status-stale" // Dev ticket status unchanged >7d in active sprint
    | "dev-no-milestone" // Dev ticket in current sprint without a Milestone
    | "dev-no-eta" // Dev ticket in current sprint without an ETA / deploy date
    | "dev-internal-target-passed" // Internal target date is in the past, ticket still open
    | "dev-internal-target-imminent"; // Internal target ≤3 days out, ticket still open
  severity: "warn" | "danger";
  daysOver: number;
  rule: string; // human-readable rule for tooltip
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Cutoff after which only `Date Created` (Lark auto-stamp) is trusted for
 * BD-row ageing. Manual `Date recorded` entries became unreliable after this
 * date — see comment in apps/dashboard/lib/data-derive.ts.
 */
const DATE_CREATED_AUTHORITATIVE_FROM_MS = Date.UTC(2026, 0, 15); // 2026-01-15

/**
 * BD Feedback aging — flagged when a row has been Logged for >14 days with no
 * Development Task link and no apparent status change since.
 *
 * `lastModifiedTime` on the raw record is our proxy for "unchanged"; it reflects
 * any field edit, but for BD rows in Logged state with no linked Dev work,
 * lack of recent edits is a reasonable signal.
 */
export function bdAgingSignals(
  record: BdFeedbackRecord & { lastModifiedTime?: number },
  now: number = Date.now()
): AgingSignal[] {
  const out: AgingSignal[] = [];
  const dateCreatedMs = readDateMs(record.fields[BD_FIELDS.dateCreated]);
  const dateRecordedMs = readDateMs(record.fields[BD_FIELDS.dateRecorded]);
  // For rows auto-stamped on or after the cutoff, only trust Date Created.
  // Older rows fall back to the previously-reliable Date recorded.
  const ageSourceMs =
    dateCreatedMs !== null && dateCreatedMs >= DATE_CREATED_AUTHORITATIVE_FROM_MS
      ? dateCreatedMs
      : (dateRecordedMs ?? dateCreatedMs);
  const hasLink = readLinkIds(record.fields[BD_FIELDS.developmentTask]).length > 0;
  const hasDayOfDeploying =
    readDateMs(record.fields[BD_FIELDS.dayOfDeploying]) !== null;

  // Aging fires for any unaddressed row (no link AND no deploy date) that's
  // sat untouched for >14 days, regardless of Status.
  if (!hasLink && !hasDayOfDeploying && ageSourceMs !== null) {
    const ageDays = Math.floor((now - ageSourceMs) / DAY_MS);
    if (ageDays > 14) {
      out.push({
        kind: "bd-stale-logged",
        severity: ageDays > 30 ? "danger" : "warn",
        daysOver: ageDays - 14,
        rule: "No linked Dev ticket and no deploy date for over 14 days",
      });
    }
  }
  return out;
}

const ACTIVE_DEV_STATUSES = new Set([
  "Ready for Development",
  "Ready",
  "In Progress",
  "In Review",
]);

/**
 * Feature Dev aging — flagged when a ticket is in an active sprint and one of
 * the three "stuck" signals fires.
 *
 * `currentSprintLabel` is whatever the current sprint string is in the Sprint
 * field (e.g. "S12"). Caller derives this — we don't try to compute it here.
 *
 * The ETA field (literal name "ETA") was confirmed via the Phase B roundtrip;
 * the dev-no-eta signal is on by default. Override `etaFieldName` if the
 * source table changes.
 */
export function devAgingSignals(
  record: FeatureDevRecord & { lastModifiedTime?: number },
  ctx: {
    currentSprintLabel?: string;
    etaFieldName?: string;
    now?: number;
    /** Flightdeck-local internal merge target (ISO YYYY-MM-DD). Empty/undefined
     *  means unset. When unset, dev-no-eta falls back to checking the external
     *  ETA field as before. When set, dev-internal-target-* signals fire. */
    internalTargetDate?: string;
  } = {}
): AgingSignal[] {
  const out: AgingSignal[] = [];
  const now = ctx.now ?? Date.now();
  const status = readString(record.fields[FD_FIELDS.status]);
  const sprint = readString(record.fields[FD_FIELDS.sprint]);
  const milestone = readString(record.fields[FD_FIELDS.milestone]);
  const lastModified = record.lastModifiedTime;

  const inCurrentSprint =
    sprint.length > 0 &&
    (!ctx.currentSprintLabel || sprint === ctx.currentSprintLabel);

  // (2) Status unchanged >7 days in active sprint.
  if (
    ACTIVE_DEV_STATUSES.has(status) &&
    inCurrentSprint &&
    lastModified
  ) {
    const ageDays = Math.floor((now - lastModified) / DAY_MS);
    if (ageDays > 7) {
      out.push({
        kind: "dev-status-stale",
        severity: ageDays > 14 ? "danger" : "warn",
        daysOver: ageDays - 7,
        rule: `Row hasn't been edited in ${ageDays} days (status: ${status})`,
      });
    }
  }

  // (3) In sprint, no Milestone.
  if (inCurrentSprint && !milestone) {
    out.push({
      kind: "dev-no-milestone",
      severity: "warn",
      daysOver: 0,
      rule: "Pulled into a sprint without a strategic Milestone set",
    });
  }

  // (4) In sprint, no internal target (preferred) or external ETA (fallback).
  // The planning-relevant absence is the *internal* target — that's what
  // determines whether the team has a credible merge plan. If internal isn't
  // set, fall back to checking external ETA (the old behaviour).
  const etaField = ctx.etaFieldName ?? FD_FIELDS.eta;
  if (inCurrentSprint) {
    const hasInternal = !!(ctx.internalTargetDate && ctx.internalTargetDate.trim());
    if (!hasInternal) {
      const eta = (record.fields as Record<string, unknown>)[etaField];
      if (!eta) {
        out.push({
          kind: "dev-no-eta",
          severity: "warn",
          daysOver: 0,
          rule: `Pulled into a sprint with no internal target and no ${etaField} set`,
        });
      }
    }
  }

  // (5) Internal target signals — fire whenever target is set and the ticket
  // is still open (active status), regardless of whether it's in the current
  // sprint. Internal target is the merge plan, not the sprint label.
  if (
    ACTIVE_DEV_STATUSES.has(status) &&
    ctx.internalTargetDate &&
    ctx.internalTargetDate.trim()
  ) {
    const targetMs = Date.parse(ctx.internalTargetDate + "T23:59:59Z");
    if (Number.isFinite(targetMs)) {
      const diffMs = targetMs - now;
      const diffDays = Math.ceil(diffMs / DAY_MS);
      if (diffMs < 0) {
        const overdueDays = Math.abs(diffDays);
        out.push({
          kind: "dev-internal-target-passed",
          severity: overdueDays > 3 ? "danger" : "warn",
          daysOver: overdueDays,
          rule: `Internal target was ${overdueDays} day(s) ago and ticket is still open`,
        });
      } else if (diffDays <= 3) {
        out.push({
          kind: "dev-internal-target-imminent",
          severity: "warn",
          daysOver: 0,
          rule: `Internal target is ${diffDays} day(s) away`,
        });
      }
    }
  }

  return out;
}

/**
 * Convenience: attach raw last-modified-time onto our typed record so aging
 * helpers can read it. Bitable returns `last_modified_time` on raw records.
 */
export function withTimestamps<T extends { record_id: string; fields: object }>(
  record: T,
  raw: RawRecord
): T & { lastModifiedTime?: number; createdTime?: number } {
  return {
    ...record,
    lastModifiedTime: raw.last_modified_time,
    createdTime: raw.created_time,
  };
}
