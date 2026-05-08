// Wire types for scoping sessions, messages, and proposed actions.

export type ScopingMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "system";
  contentJson: string;
  createdAtMs: number;
};

export type ProposedActionState =
  | "pending"
  | "approved"
  | "rejected"
  | "fired"
  | "failed";

export type ProposedAction = {
  id: string;
  sessionId: string;
  kind: string;
  payload: unknown;
  state: ProposedActionState;
  result: unknown;
  createdAtMs: number;
  resolvedAtMs: number | null;
};

export type SessionDetail = {
  id: string;
  flowType: string;
  ticketKind: string | null;
  ticketRecordId: string | null;
  ticketTitle: string | null;
  ticketNumber: number | null;
  status: string;
  model: string;
  claudeSessionUuid: string;
  createdAtMs: number;
  updatedAtMs: number;
  messages: ScopingMessage[];
  proposedActions: ProposedAction[];
};

export type CreateSessionRequest = {
  flowType: "bd-to-dev" | "pair-sanity" | "weekly-review";
  ticketRecordId?: string;
  ticketKind?: "bd" | "dev";
  pairBdRecordId?: string;
  pairDevRecordId?: string;
  model?: string;
  /** Opt-in: when true, the bd-to-dev / pair-sanity prompt mandates an
   * Investigation phase before drafting (codebase grep + PRD lookup +
   * shipped-PR check). Off by default — adds 15-30s + tool budget per scope. */
  investigationEnabled?: boolean;
};
