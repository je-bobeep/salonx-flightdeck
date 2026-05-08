import { z } from "zod";
import { larkFetch } from "./client";
import {
  BdFeedbackRecord,
  FeatureDevRecord,
  type BdRecordId,
  type DevRecordId,
} from "./schemas";

// --- Field metadata -------------------------------------------------------

const FieldMetaResponse = z.object({
  code: z.number(),
  data: z
    .object({
      items: z.array(
        z.object({
          field_id: z.string(),
          field_name: z.string(),
          type: z.number(),
          ui_type: z.string().optional(),
          property: z.unknown().optional(),
          is_primary: z.boolean().optional(),
        })
      ),
      page_token: z.string().optional(),
      has_more: z.boolean().optional(),
    })
    .optional(),
});

export type FieldMeta = {
  fieldId: string;
  fieldName: string;
  type: number;
  uiType: string | undefined;
};

const fieldCache = new Map<string, { fields: FieldMeta[]; fetchedAt: number }>();
const FIELD_CACHE_TTL_MS = 5 * 60 * 1000;

/** List all fields of a table. Cached for 5 minutes. */
export async function listFields(
  appToken: string,
  tableId: string
): Promise<FieldMeta[]> {
  const key = `${appToken}::${tableId}`;
  const hit = fieldCache.get(key);
  if (hit && Date.now() - hit.fetchedAt < FIELD_CACHE_TTL_MS) {
    return hit.fields;
  }
  const out: FieldMeta[] = [];
  let pageToken: string | undefined;
  do {
    const json = await larkFetch({
      path: `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`,
      query: { page_size: 100, page_token: pageToken },
    });
    const parsed = FieldMetaResponse.parse(json);
    for (const item of parsed.data?.items ?? []) {
      out.push({
        fieldId: item.field_id,
        fieldName: item.field_name,
        type: item.type,
        uiType: item.ui_type,
      });
    }
    pageToken = parsed.data?.has_more ? parsed.data.page_token : undefined;
  } while (pageToken);
  fieldCache.set(key, { fields: out, fetchedAt: Date.now() });
  return out;
}

// --- Record list / search -------------------------------------------------

const ListRecordsResponse = z.object({
  code: z.number(),
  data: z
    .object({
      items: z
        .array(
          z.object({
            record_id: z.string(),
            fields: z.record(z.unknown()),
            created_time: z.number().optional(),
            last_modified_time: z.number().optional(),
          })
        )
        .optional(),
      page_token: z.string().optional(),
      has_more: z.boolean().optional(),
      total: z.number().optional(),
    })
    .optional(),
});

export type RawRecord = {
  record_id: string;
  fields: Record<string, unknown>;
  created_time?: number;
  last_modified_time?: number;
};

type ListOpts = {
  fieldNames?: string[]; // optional projection
  filter?: string; // Lark formula-language filter
  sort?: { field_name: string; desc?: boolean }[];
  pageSize?: number; // default 100
  /** If true, auto-paginate and return everything. Default true. */
  all?: boolean;
};

/** Generic list. Caller is responsible for parsing fields with the right schema. */
export async function listRecords(
  appToken: string,
  tableId: string,
  opts: ListOpts = {}
): Promise<RawRecord[]> {
  const out: RawRecord[] = [];
  let pageToken: string | undefined;
  const all = opts.all ?? true;
  do {
    const json = await larkFetch({
      path: `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      query: {
        page_size: opts.pageSize ?? 100,
        page_token: pageToken,
        field_names: opts.fieldNames
          ? JSON.stringify(opts.fieldNames)
          : undefined,
        filter: opts.filter,
        sort: opts.sort ? JSON.stringify(opts.sort) : undefined,
      },
    });
    const parsed = ListRecordsResponse.parse(json);
    for (const item of parsed.data?.items ?? []) {
      out.push(item);
    }
    pageToken = parsed.data?.has_more ? parsed.data.page_token : undefined;
    if (!all) break;
  } while (pageToken);
  return out;
}

const SearchRecordsResponse = ListRecordsResponse;

type SearchBody = {
  view_id?: string;
  field_names?: string[];
  filter?: {
    conjunction: "and" | "or";
    conditions: Array<{
      field_name: string;
      operator:
        | "is"
        | "isNot"
        | "contains"
        | "doesNotContain"
        | "isEmpty"
        | "isNotEmpty"
        | "isGreater"
        | "isGreaterEqual"
        | "isLess"
        | "isLessEqual";
      value?: string[];
    }>;
  };
  sort?: { field_name: string; desc?: boolean }[];
  automatic_fields?: boolean;
};

export async function searchRecords(
  appToken: string,
  tableId: string,
  body: SearchBody,
  opts: { pageSize?: number; all?: boolean } = {}
): Promise<RawRecord[]> {
  const out: RawRecord[] = [];
  let pageToken: string | undefined;
  const all = opts.all ?? true;
  do {
    const json = await larkFetch({
      method: "POST",
      path: `/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
      query: { page_size: opts.pageSize ?? 100, page_token: pageToken },
      body,
    });
    const parsed = SearchRecordsResponse.parse(json);
    for (const item of parsed.data?.items ?? []) {
      out.push(item);
    }
    pageToken = parsed.data?.has_more ? parsed.data.page_token : undefined;
    if (!all) break;
  } while (pageToken);
  return out;
}

// --- Single record GET ---------------------------------------------------

const GetRecordResponse = z.object({
  code: z.number(),
  data: z
    .object({
      record: z.object({
        record_id: z.string(),
        fields: z.record(z.unknown()),
      }),
    })
    .optional(),
});

export async function getRecord(
  appToken: string,
  tableId: string,
  recordId: string
): Promise<RawRecord | null> {
  const json = await larkFetch({
    path: `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
  });
  const parsed = GetRecordResponse.parse(json);
  if (!parsed.data) return null;
  return {
    record_id: parsed.data.record.record_id,
    fields: parsed.data.record.fields,
  };
}

// --- Typed lists ---------------------------------------------------------

import { TRACKER } from "./wiki";
import { BD_FIELDS, FD_FIELDS } from "./schemas";

export async function listBdFeedback(
  opts: ListOpts = {}
): Promise<BdFeedbackRecord[]> {
  const raw = await listRecords(TRACKER.appToken, TRACKER.tables.bdFeedback, opts);
  return raw.map((r) =>
    BdFeedbackRecord.parse({ record_id: r.record_id, fields: r.fields })
  );
}

export async function listFeatureDev(
  opts: ListOpts = {}
): Promise<FeatureDevRecord[]> {
  const raw = await listRecords(
    TRACKER.appToken,
    TRACKER.tables.featureDevelopment,
    opts
  );
  return raw.map((r) =>
    FeatureDevRecord.parse({ record_id: r.record_id, fields: r.fields })
  );
}

// --- Writes --------------------------------------------------------------

const UpdateRecordResponse = z.object({
  code: z.number(),
  data: z
    .object({
      record: z.object({
        record_id: z.string(),
        fields: z.record(z.unknown()),
      }),
    })
    .optional(),
});

const CreateRecordResponse = UpdateRecordResponse;

/**
 * Update record fields. Always passes `ignore_consistency_check: true` because
 * without it, concurrent edits return code 9499. (See
 * memory/reference_lark_base.md.)
 */
export async function updateRecord(
  appToken: string,
  tableId: string,
  recordId: string,
  fields: Record<string, unknown>
): Promise<RawRecord> {
  const json = await larkFetch({
    method: "PUT",
    path: `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
    query: { ignore_consistency_check: true },
    body: { fields },
  });
  const parsed = UpdateRecordResponse.parse(json);
  if (!parsed.data) {
    throw new Error("updateRecord: no record in response");
  }
  return {
    record_id: parsed.data.record.record_id,
    fields: parsed.data.record.fields,
  };
}

/**
 * Create a new record. Never passes `user_id_type` (returns an error). Empty
 * `query: {}` is mandatory per memory/reference_lark_base.md.
 */
export async function createRecord(
  appToken: string,
  tableId: string,
  fields: Record<string, unknown>
): Promise<RawRecord> {
  const json = await larkFetch({
    method: "POST",
    path: `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
    body: { fields },
  });
  const parsed = CreateRecordResponse.parse(json);
  if (!parsed.data) {
    throw new Error("createRecord: no record in response");
  }
  return {
    record_id: parsed.data.record.record_id,
    fields: parsed.data.record.fields,
  };
}

/**
 * Link a BD Feedback row to a Feature Dev row (or unlink). On the Feature Dev
 * side, the field is `BD Feedback` and the WRITE format is a plain array of
 * record IDs (the read shape `{link_record_ids: [...]}` is rejected with
 * code 1254074). We pre-read existing links and merge / remove.
 */
export async function setDevBdLinks(
  devRecordId: DevRecordId,
  bdRecordIds: BdRecordId[]
): Promise<RawRecord> {
  return updateRecord(
    TRACKER.appToken,
    TRACKER.tables.featureDevelopment,
    devRecordId,
    { [FD_FIELDS.bdFeedback]: bdRecordIds }
  );
}

/** Add a BD↔Dev link, preserving existing links on the Dev row. */
export async function linkBdToDev(
  bdRecordId: BdRecordId,
  devRecordId: DevRecordId
): Promise<RawRecord> {
  const existing = await getRecord(
    TRACKER.appToken,
    TRACKER.tables.featureDevelopment,
    devRecordId
  );
  const current = (existing?.fields?.[FD_FIELDS.bdFeedback] as
    | { link_record_ids?: string[] }
    | undefined)?.link_record_ids ?? [];
  if (current.includes(bdRecordId)) {
    return existing!;
  }
  return setDevBdLinks(devRecordId, [
    ...current.map((id) => id as BdRecordId),
    bdRecordId,
  ]);
}

/** Remove a BD↔Dev link. */
export async function unlinkBdFromDev(
  bdRecordId: BdRecordId,
  devRecordId: DevRecordId
): Promise<RawRecord> {
  const existing = await getRecord(
    TRACKER.appToken,
    TRACKER.tables.featureDevelopment,
    devRecordId
  );
  const current = (existing?.fields?.[FD_FIELDS.bdFeedback] as
    | { link_record_ids?: string[] }
    | undefined)?.link_record_ids ?? [];
  const next = current.filter((id) => id !== bdRecordId).map((id) => id as BdRecordId);
  return setDevBdLinks(devRecordId, next);
}

// Re-export BD field map for convenience; FD already exported via schemas.
export { BD_FIELDS, FD_FIELDS };
