/**
 * Single source of truth for the SalonX team's Lark Assignee open_ids.
 *
 * IMPORTANT: open_ids are tenant-scoped. These are for `open.larksuite.com`
 * (the tenant the SalonX Phase 2 Tracker lives in). The same people have
 * *different* open_ids in `open.feishu.cn`, so DO NOT copy from any
 * `salon-x-business/.claude/skills/` source — those target feishu.cn and
 * will fail here with `code=1254066 UserFieldConvFail`.
 *
 * Verified 2026-05-06 by reading the Assignee field on live Feature
 * Development rows.
 *
 * Imported from:
 *  - lib/claude/prompts/bd-to-dev.ts (system prompt's TEAM_TABLE)
 *  - apps/dashboard/app/api/scoping/turn/route.ts (per-turn CONTEXT block)
 *  - apps/dashboard/lib/field-options.ts (TicketPanel inline assignee picker)
 *  - memory/reference_lark_base.md (canonical reference, kept in sync)
 */

export type TeamMember = {
  name: string;
  openId: string;
};

export const TEAM: ReadonlyArray<TeamMember> = [
  { name: "Jingjing Feng (Winney)", openId: "ou_08cf01cd3ec1f3790c2b88d7dc573fdf" },
  { name: "Yi Wang", openId: "ou_928341220770d0181c5cae0efd2a46b4" },
  { name: "Feida Zhang", openId: "ou_bb0a5e2f5e84f2fb68e53f556a07aef9" },
  { name: "Philly Cai", openId: "ou_fb3479ce4e9b2e98fcfdae0803379661" },
  { name: "Jia En Chai", openId: "ou_50c267dd36ca03ad02cca05eda7117c6" },
  { name: "Kan Lu", openId: "ou_433b91ac0b296b1fcecfd5441f554d66" },
];

/** Pretty Markdown table for system-prompt embedding. */
export function teamTableMarkdown(): string {
  const lines = [
    "| Name | open_id |",
    "| ---- | ------- |",
    ...TEAM.map((m) => `| ${m.name} | ${m.openId} |`),
  ];
  return lines.join("\n");
}
