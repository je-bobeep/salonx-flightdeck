import { z } from "zod";
import { ulid } from "ulid";
import path from "node:path";

// Propose tools persist a row in proposed_actions and return the action_id.
// They never write to Lark or disk directly. Approval happens in the dashboard
// UI via POST /api/lark/proposed-action/<id>/approve.
//
// We import the better-sqlite3 helpers lazily (inside each handler) so that
// importing this module doesn't blow up if FLIGHTDECK_DB_PATH isn't set.

async function getDb() {
  // Read DB module dynamically so the MCP server can be loaded by Claude Code
  // even if the SQLite module fails to compile in this Node version (it
  // shouldn't, but better safe).
  const { default: Database } = await import("better-sqlite3");
  const fs = await import("node:fs");
  const dbPath =
    process.env.FLIGHTDECK_DB_PATH ??
    path.resolve(process.cwd(), ".data/tokens.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

type Session = { id: string };

async function resolveSession(sessionId: string | undefined): Promise<Session> {
  if (!sessionId) {
    throw new Error(
      "session_id is required. Pass the active scoping session id."
    );
  }
  const db = await getDb();
  const row = db
    .prepare("SELECT id FROM scoping_sessions WHERE id = ?")
    .get(sessionId) as { id: string } | undefined;
  if (!row) {
    throw new Error(`No scoping session with id=${sessionId}`);
  }
  return row;
}

async function persist(
  sessionId: string,
  kind: string,
  payload: unknown
): Promise<{ action_id: string }> {
  const db = await getDb();
  const id = `act_${ulid()}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO proposed_actions (id, session_id, kind, payload_json, state, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).run(id, sessionId, kind, JSON.stringify(payload), now);

  // Telemetry: bump proposal_count on this session's row. The row is created
  // lazily on first event in the dashboard's session-create route; defend
  // against missing rows by upserting. We don't know flow_type or started_at
  // from this side — those come from the session row itself; we'll backfill
  // them from scoping_sessions on rollup if missing.
  try {
    db.prepare(
      `INSERT INTO scoping_telemetry (
         session_id, flow_type, started_at, proposal_count, last_event_at
       )
       SELECT s.id, s.flow_type, s.created_at, 1, ?
       FROM scoping_sessions s
       WHERE s.id = ?
       ON CONFLICT(session_id) DO UPDATE SET
         proposal_count = proposal_count + 1,
         last_event_at  = excluded.last_event_at`
    ).run(now, sessionId);
  } catch (e) {
    console.warn(
      "[propose] telemetry write failed (non-fatal): %s",
      e instanceof Error ? e.message : String(e)
    );
  }
  return { action_id: id };
}

// --- propose.create_dev_ticket -------------------------------------------

export const createDevTicketSchema = {
  description:
    "Propose to create a new Feature Development row in Lark from a BD scoping session. Always describe behaviour, not code (per the dev-ticket SKILL). The user reviews the structured action and clicks Approve before any write fires.",
  inputSchema: {
    session_id: z
      .string()
      .describe("The active scoping session id (e.g. ses_01H...)"),
    bd_record_id: z
      .string()
      .describe("The originating BD Feedback record_id to link to."),
    description: z
      .string()
      .describe(
        "Sentence-case action-first title, no trailing period. e.g. 'Split staff online booking toggle into Available and Designatable'."
      ),
    story_description: z
      .string()
      .describe(
        "Plain text Story description with sections: Background, Goal, Acceptance Criteria, Out of Scope, Reference. NO db column names, file paths, or commit hashes."
      ),
    request_type: z.enum(["Bug", "Feature Enhancement", "New Feature", "Tech"]),
    module: z.array(z.string()).default([]),
    product: z.array(z.string()).default([]),
    priority: z.string().describe("e.g. '0 Critical Fix', '1 Immediately (within 1 month)'"),
    milestone: z.string().describe("e.g. '1: Run-the-shop Baseline'"),
    sprint: z.string().optional(),
    customer_feedback: z.boolean().default(true),
    assignee_open_id: z
      .string()
      .optional()
      .describe(
        "Lark open_id of the assignee (only if confidently identified). Otherwise omit and let the user assign manually."
      ),
    needs_translation_review: z.boolean().default(false),
    eta: z.string().optional().describe("ETA / deploy target date if known."),
  },
};

export async function createDevTicket(args: {
  session_id: string;
  bd_record_id: string;
  description: string;
  story_description: string;
  request_type: string;
  module?: string[];
  product?: string[];
  priority: string;
  milestone: string;
  sprint?: string;
  customer_feedback?: boolean;
  assignee_open_id?: string;
  needs_translation_review?: boolean;
  eta?: string;
}) {
  await resolveSession(args.session_id);
  const result = await persist(args.session_id, "lark.create_dev_ticket", args);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...result,
          state: "pending_approval",
          message:
            "Proposed a new Feature Dev row. The user must approve before it's created in Lark.",
        }),
      },
    ],
  };
}

// --- propose.update_bd_status --------------------------------------------

export const updateBdStatusSchema = {
  description:
    "Propose to update a BD Feedback row's Status (e.g. to 'Declined' with verdict reasoning). User approves before the write fires.",
  inputSchema: {
    session_id: z.string(),
    bd_record_id: z.string(),
    new_status: z
      .string()
      .describe("e.g. 'Logged', 'In Discussion', 'Declined', 'Done'"),
    verdict_text: z
      .string()
      .optional()
      .describe(
        "Optional rationale / verdict text. UI may surface it for user editing before approval."
      ),
  },
};

export async function updateBdStatus(args: {
  session_id: string;
  bd_record_id: string;
  new_status: string;
  verdict_text?: string;
}) {
  await resolveSession(args.session_id);
  const result = await persist(args.session_id, "lark.update_bd_status", args);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...result,
          state: "pending_approval",
          message: "Proposed a BD Status update. User approves before the write fires.",
        }),
      },
    ],
  };
}

// --- propose.create_bd_dev_link ------------------------------------------

export const createBdDevLinkSchema = {
  description:
    "Propose to link a BD Feedback row to an existing Feature Development row via the DuplexLink. User approves before the write fires.",
  inputSchema: {
    session_id: z.string(),
    bd_record_id: z.string(),
    dev_record_id: z.string(),
    rationale: z
      .string()
      .optional()
      .describe("Why this Dev ticket addresses this BD ask."),
  },
};

export async function createBdDevLink(args: {
  session_id: string;
  bd_record_id: string;
  dev_record_id: string;
  rationale?: string;
}) {
  await resolveSession(args.session_id);
  const result = await persist(args.session_id, "lark.create_bd_dev_link", args);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...result,
          state: "pending_approval",
          message: "Proposed a BD↔Dev link. User approves before the write fires.",
        }),
      },
    ],
  };
}

// --- propose.write_stakeholder_md ----------------------------------------

export const writeStakeholderMdSchema = {
  description:
    "Propose to write a stakeholder-update Markdown file under scoping-outputs/<YYYY-MM-DD>-stakeholder.md. If the file already exists, the runner appends a numeric suffix (-stakeholder-2.md, -3.md, ...) — never overwrites. User approves before the file is written.",
  inputSchema: {
    session_id: z.string(),
    markdown: z
      .string()
      .describe("Full markdown body. Will be written verbatim."),
    title_hint: z
      .string()
      .optional()
      .describe("Short title for the approval card (not part of the file)."),
  },
};

export async function writeStakeholderMd(args: {
  session_id: string;
  markdown: string;
  title_hint?: string;
}) {
  await resolveSession(args.session_id);
  const result = await persist(args.session_id, "propose.write_stakeholder_md", args);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          ...result,
          state: "pending_approval",
          message:
            "Proposed a stakeholder-update Markdown file. User approves before the file is written.",
        }),
      },
    ],
  };
}
