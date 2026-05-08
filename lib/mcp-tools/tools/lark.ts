import { z } from "zod";
import {
  listFeatureDev,
  searchRecords,
  getRecord,
} from "@flightdeck/lark/bitable";
import { TRACKER } from "@flightdeck/lark/wiki";
import { FD_FIELDS } from "@flightdeck/lark/schemas";

export const readBdFeedbackSchema = {
  description:
    "Get a single BD Feedback row by record_id (full fields). Use this to read the merchant request, category, status, and links to dev tickets.",
  inputSchema: {
    record_id: z.string().describe("Lark record_id, e.g. recv7BlqqM8CrP"),
  },
};

export async function readBdFeedback(args: { record_id: string }) {
  const rec = await getRecord(
    TRACKER.appToken,
    TRACKER.tables.bdFeedback,
    args.record_id
  );
  if (!rec) {
    return { content: [{ type: "text" as const, text: `BD record ${args.record_id} not found` }] };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(rec, null, 2),
      },
    ],
  };
}

export const readFeatureDevSchema = {
  description:
    "Get a single Feature Development row by record_id (full fields). Use this to inspect a dev ticket's Description, Story description, Status, Sprint, Milestone, linked BD Feedback rows, etc.",
  inputSchema: {
    record_id: z.string().describe("Lark record_id, e.g. recvggaV0WNGSr"),
  },
};

export async function readFeatureDev(args: { record_id: string }) {
  const rec = await getRecord(
    TRACKER.appToken,
    TRACKER.tables.featureDevelopment,
    args.record_id
  );
  if (!rec) {
    return { content: [{ type: "text" as const, text: `Feature Dev record ${args.record_id} not found` }] };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(rec, null, 2),
      },
    ],
  };
}

export const searchFeatureDevSchema = {
  description:
    "Find Feature Development rows by title keyword. Returns up to 10 matches with their record_id, Description, Status, Sprint, Milestone, Assignee. Useful for checking if an existing dev ticket already covers a BD ask.",
  inputSchema: {
    keyword: z
      .string()
      .describe("Substring to match against the Description (title) field"),
    limit: z.number().int().min(1).max(20).optional().default(10),
  },
};

export async function searchFeatureDev(args: { keyword: string; limit?: number }) {
  const records = await searchRecords(
    TRACKER.appToken,
    TRACKER.tables.featureDevelopment,
    {
      filter: {
        conjunction: "and",
        conditions: [
          {
            field_name: FD_FIELDS.description,
            operator: "contains",
            value: [args.keyword],
          },
        ],
      },
      automatic_fields: false,
    },
    { pageSize: args.limit ?? 10, all: false }
  );
  // Trim payload to just the fields the model actually needs.
  const slim = records.map((r) => ({
    record_id: r.record_id,
    Description: r.fields[FD_FIELDS.description],
    Status: r.fields[FD_FIELDS.status],
    Sprint: r.fields[FD_FIELDS.sprint],
    Milestone: r.fields[FD_FIELDS.milestone],
    Assignee: r.fields[FD_FIELDS.assignee],
    BDFeedback: r.fields[FD_FIELDS.bdFeedback],
  }));
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(slim, null, 2),
      },
    ],
  };
}

// Re-export listFeatureDev so other helpers can use it via this module if needed.
export { listFeatureDev };
