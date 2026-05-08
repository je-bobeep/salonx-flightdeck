// Wire shapes shared between the /api/data/* routes (server) and the
// useQuery hooks that consume them (client). Keep these JSON-friendly.

import type { AgingSignal } from "@flightdeck/lark/aging";
import type { Theme } from "@flightdeck/themes/shapes";

export type BdRow = {
  recordId: string;
  number: string;
  item: string;
  translate: string;
  category: string[];
  subCategory: string;
  fromPocMerchant: boolean;
  status: string;
  priority: string;
  /** When Lark auto-stamped the row (reliable). */
  dateCreatedMs: number | null;
  /** What the BD-logger typed in the manual `Date recorded` field. May have
   * year typos. Prefer dateCreatedMs for any computation. */
  dateRecordedMs: number | null;
  ageDays: number | null;
  createdByName: string;
  hasLinkedDev: boolean;
  linkedDevIds: string[];
  /** True if the BD row has a `Day of deploying` value set — i.e. the ask
   * has been (or is scheduled to be) shipped, even without a formal Dev
   * ticket link. Used by the triage filter alongside hasLinkedDev. */
  hasDayOfDeploying: boolean;
  aging: AgingSignal[];
};

export type DevRow = {
  recordId: string;
  description: string;
  storyDescription: string;
  status: string;
  priority: string;
  milestone: string;
  sprint: string;
  module: string[];
  product: string[];
  requestType: string;
  customerFeedback: boolean;
  assignees: { id: string; name?: string }[];
  bdLinkIds: string[];
  /** External commitment ETA (Asano-san facing). Stored on the Lark FD row. */
  eta: string;
  releaseDate: string;
  /** Flightdeck-local internal merge target (private to this dashboard).
   *  ISO YYYY-MM-DD, or empty string when unset. Decoupled from Lark Base. */
  internalTargetDate: string;
  lastModifiedMs: number | null;
  aging: AgingSignal[];
};

export type TriageData = {
  groups: { priority: string; rows: BdRow[] }[];
  totalCount: number;
  /** Active Dev tickets with priority="0 Critical Fix". Pinned to the top of
   * the Triage page as the most-urgent-in-flight items. */
  criticalFix: DevRow[];
};

export type CoverageEntry = {
  theme: Theme;
  coveredBdCount: number;
  uncoveredBdCount: number;
  coveredBdIds: string[];
  uncoveredBdIds: string[];
  devTickets: {
    recordId: string;
    description: string;
    status: string;
    eta: string;
    releaseDate: string;
  }[];
};

export type LinkageData = {
  pairs: { bd: BdRow; dev: DevRow }[];
  orphanDev: DevRow[];
  coverage: CoverageEntry[];
  /** Snapshot of the BD rows referenced by coverage entries, so the view can
   * render uncovered-BD details without a second fetch. Keyed by recordId. */
  bdById: Record<string, BdRow>;
};

export type SprintData = {
  sprints: {
    label: string;
    assignees: { name: string; rows: DevRow[] }[];
  }[];
  currentSprintLabel: string | null;
};

export type SessionRow = {
  id: string;
  flowType: string;
  ticketKind: string | null;
  ticketRecordId: string | null;
  ticketNumber: number | null;
  ticketTitle: string | null;
  status: string;
  model: string;
  createdAtMs: number;
  updatedAtMs: number;
  /** Count of proposed_actions in 'pending' state for this session. */
  pendingActions: number;
};

export type TodayData = {
  now: number;
  bd: {
    newLast7d: number;
    unaddressed: number;
    stale30d: number;
    stale14d: number;
    pocCount: number;
    /** POC merchant rows that have aged past 14 days unaddressed. The plain
     * `pocCount` includes fresh POC asks too; this is the urgency-worthy
     * subset that drives the headline. */
    pocStale: number;
    immediateCoveragePct: number | null;
    immediateTotal: number;
    immediateLinked: number;
  };
  sprint: {
    label: string | null;
    total: number;
    active: number;
    noEta: number;
    noMilestone: number;
    stuck: number;
  };
  roadmap: {
    /** Themes whose `rising===true` AND have zero Dev tickets in any band. */
    risingNotOnRoadmap: number;
    /** Themes whose `bdMedianAgeDays > 14` AND coveredBdCount === 0. */
    uncoveredImmediateThemes: number;
    /** True when the theme cluster came from the deterministic fallback
     * (no Claude clustering). In that mode `risingNotOnRoadmap` is
     * structurally always 0 and the UI should hide rising-dependent CTAs. */
    fallbackThemes: boolean;
  };
};

export type RoadmapBand = "now" | "next" | "soon" | "later";

export type RoadmapTicket = {
  recordId: string;
  description: string;
  status: string;
  priority: string;
  milestone: string;
  sprint: string;
  assigneeNames: string[];
  eta: string;
  releaseDate: string;
  /** Flightdeck-local internal target. Empty string when unset. */
  internalTargetDate: string;
  /** True if this ticket has at least one BD link. Used for pull/push split. */
  hasFeedback: boolean;
  /** External ETA is in the past but the ticket is still in flight. */
  overdue: boolean;
  /** Internal target is in the past but the ticket is still in flight. */
  internalOverdue: boolean;
  /** Internal target passed but external still in the future — slip warning. */
  internalSlipping: boolean;
};

export type RoadmapCell = {
  theme: Theme | null;
  /** When `theme` is null, this is the module/milestone label used to group
   * unthemed tickets so the column doesn't collapse into one flat pile. */
  unthemedLabel?: string;
  /** Tickets in this cell, sorted by ETA asc. */
  tickets: RoadmapTicket[];
  pull: number;
  push: number;
};

export type RoadmapColumn = {
  band: RoadmapBand;
  label: string;
  helper: string;
  cells: RoadmapCell[];
  totalTickets: number;
};

export type RoadmapData = {
  columns: RoadmapColumn[];
  /** Themes flagged as rising but with no ticket on the roadmap. */
  risingNotScheduled: { id: string; name: string; bdVolume: number }[];
  currentSprintLabel: string | null;
  nextSprintLabel: string | null;
};
