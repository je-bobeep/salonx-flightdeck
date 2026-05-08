// Hardcoded select options for fields rendered as inline editors in
// TicketPanel. Lark exposes these as SingleSelect/MultiSelect schema, but
// reading them per-edit is overkill and the option set is stable. Keep this
// in sync with the values used by `lib/mcp-tools/tools/propose.ts` and the
// known values in `memory/reference_lark_base.md`.

export const DEV_STATUS_OPTIONS = [
  "Pending PM PRD",
  "Pending PRD",
  "Exploring",
  "Logged",
  "In Discussion",
  "Ready for Development",
  "Ready",
  "In Progress",
  "In Review",
  "In Testing",
  "Ready for Release",
  "Merged to Develop",
  "Released",
  "Done",
  "Won't Do",
] as const;

export const DEV_PRIORITY_OPTIONS = [
  "0 Critical Fix",
  "1 Immediately (within 1 month)",
  "2 Next (within 2-3 months)",
  "3 Future (after 3 months)",
] as const;

export const DEV_MILESTONE_OPTIONS = [
  "-1: Critical Fix from BD",
  "0: Jan 19 Onboarding",
  "1: Run-the-shop Baseline",
  "2: Booking-led Growth Loop",
  "3: Staff Flywheel v1",
  "4: Marketing Automation v1",
  "5: Tech Debt",
] as const;

export const DEV_REQUEST_TYPE_OPTIONS = [
  "Bug",
  "Feature Enhancement",
  "New Feature",
  "Tech",
] as const;

export const BD_STATUS_OPTIONS = [
  "Logged",
  "In Discussion",
  "Pending PRD",
  "Done",
  "Declined",
  "Won't Do",
] as const;

export const BD_PRIORITY_OPTIONS = [
  "Immediate",
  "High",
  "Medium",
  "Low",
  "Next",
] as const;

// Verified open.larksuite.com Assignee open_ids — single source of truth
// lives in `lib/claude/team.ts`. Re-exported here so panel components can
// import without depending on the claude workspace package directly.
export { TEAM as KNOWN_ASSIGNEES } from "@flightdeck/claude/team";
