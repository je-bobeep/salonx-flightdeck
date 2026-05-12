// Lark fetch + projection helpers for cluster inputs. BD and Dev.

import {
  listRecords,
  type RawRecord,
} from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import {
  BD_FIELDS,
  FD_FIELDS,
  readBool,
  readDateMs,
  readLinkIds,
  readMultiSelect,
  readString,
  readUsers,
} from "@flightdeck/lark/schemas";
import { bdAgingSignals, devAgingSignals } from "@flightdeck/lark/aging";
import type { BdRow, DevRow } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Format an epoch-ms timestamp as `YYYY-MM-DD` in UTC. Empty string when null
 *  so the wire shape stays a plain `string` per DevRow.internalTargetDate. */
function msToIsoDate(ms: number | null): string {
  if (ms === null) return "";
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Cutoff for `Date recorded` reliability. Manual `Date recorded` entries
 * became unreliable around this date (BD #120 has 2025-04-08 typed when the
 * row was actually auto-stamped on 2026-04-08 — at least 365d off). For any
 * row whose Lark-side `Date Created` is on or after this cutoff, prefer
 * `Date Created` and ignore `Date recorded`. Older rows continue to use
 * `Date recorded` (which was reliable at the time).
 */
const DATE_CREATED_AUTHORITATIVE_FROM_MS = Date.UTC(2026, 0, 15); // 2026-01-15

export async function fetchAllBd(): Promise<RawRecord[]> {
  return listRecords(TRACKER.appToken, TRACKER.tables.bdFeedback, {
    pageSize: 100,
  });
}

export async function fetchAllDev(): Promise<RawRecord[]> {
  return listRecords(TRACKER.appToken, TRACKER.tables.featureDevelopment, {
    pageSize: 100,
  });
}

export function projectBd(raw: RawRecord, now = Date.now()): BdRow {
  const fields = raw.fields;
  const linked = readLinkIds(fields[BD_FIELDS.developmentTask]);
  const dateCreatedMs = readDateMs(fields[BD_FIELDS.dateCreated]);
  const dateRecordedMs = readDateMs(fields[BD_FIELDS.dateRecorded]);
  // Pick the canonical "added at" timestamp. For rows auto-stamped on or
  // after the cutoff, only trust Date Created; for older rows, trust Date
  // recorded (which was the reliable signal at the time) and fall back to
  // Date Created if missing.
  const ageSourceMs =
    dateCreatedMs !== null && dateCreatedMs >= DATE_CREATED_AUTHORITATIVE_FROM_MS
      ? dateCreatedMs
      : (dateRecordedMs ?? dateCreatedMs);
  const item = readString(fields[BD_FIELDS.item]);
  const translate = readString(fields[BD_FIELDS.translate]);
  const number = readString(fields[BD_FIELDS.number]);
  const subCategory = readString(fields[BD_FIELDS.subCategory]);
  const status = readString(fields[BD_FIELDS.status]);
  const priority = readString(fields[BD_FIELDS.priority]);
  const fromPoc =
    readString(fields[BD_FIELDS.fromThePocMerchant]).toLowerCase() === "yes";
  const createdBy = readUsers(fields[BD_FIELDS.createdBy])[0];
  const aging = bdAgingSignals(
    {
      record_id: raw.record_id as never,
      fields,
      lastModifiedTime: raw.last_modified_time,
    } as never,
    now
  );
  return {
    recordId: raw.record_id,
    number,
    item,
    translate,
    category: readMultiSelect(fields[BD_FIELDS.category]),
    subCategory,
    fromPocMerchant: fromPoc,
    status,
    priority,
    dateCreatedMs,
    dateRecordedMs,
    ageDays:
      ageSourceMs !== null ? Math.floor((now - ageSourceMs) / DAY_MS) : null,
    createdByName: createdBy?.name ?? createdBy?.enName ?? "",
    hasLinkedDev: linked.length > 0,
    linkedDevIds: linked,
    hasDayOfDeploying: readDateMs(fields[BD_FIELDS.dayOfDeploying]) !== null,
    aging,
  };
}

export function projectDev(
  raw: RawRecord,
  ctx: {
    currentSprintLabel?: string;
    now?: number;
  } = {}
): DevRow {
  const fields = raw.fields;
  const description = readString(fields[FD_FIELDS.description]);
  const storyDescription = readString(fields[FD_FIELDS.storyDescription]);
  const status = readString(fields[FD_FIELDS.status]);
  const priority = readString(fields[FD_FIELDS.priority]);
  const milestone = readString(fields[FD_FIELDS.milestone]);
  const sprint = readString(fields[FD_FIELDS.sprint]);
  const module = readMultiSelect(fields[FD_FIELDS.module]);
  const product = readMultiSelect(fields[FD_FIELDS.product]);
  const requestType = readString(fields[FD_FIELDS.requestType]);
  const customerFeedback = readBool(fields[FD_FIELDS.customerFeedback]);
  const assignees = readUsers(fields[FD_FIELDS.assignee]).map((u) => ({
    id: u.id,
    name: u.name ?? u.enName,
  }));
  const bdLinkIds = readLinkIds(fields[FD_FIELDS.bdFeedback]);
  const eta = readString(fields[FD_FIELDS.eta]);
  const releaseDate = readString(fields[FD_FIELDS.releaseDate]);
  const internalTargetDate = msToIsoDate(
    readDateMs(fields[FD_FIELDS.internalEta])
  );
  const aging = devAgingSignals(
    {
      record_id: raw.record_id as never,
      fields,
      lastModifiedTime: raw.last_modified_time,
    } as never,
    { ...ctx, internalTargetDate }
  );
  return {
    recordId: raw.record_id,
    description,
    storyDescription,
    status,
    priority,
    milestone,
    sprint,
    module,
    product,
    requestType,
    customerFeedback,
    assignees,
    bdLinkIds,
    eta,
    releaseDate,
    internalTargetDate,
    lastModifiedMs: raw.last_modified_time ?? null,
    aging,
  };
}
