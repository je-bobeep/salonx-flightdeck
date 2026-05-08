import { z } from "zod";
import { SIBLINGS, type SiblingName } from "@flightdeck/sibling/paths";
import { gitLogGrep, gitOriginGithub } from "@flightdeck/sibling/git";
import { ghPrSearch, GhUnavailable } from "@flightdeck/sibling/gh";
import {
  readPrdIndex,
  searchPrdIndex,
  readSiblingFile,
} from "@flightdeck/sibling/prds";
import { searchKb } from "@flightdeck/sibling/kb";
import { codeGrep } from "@flightdeck/sibling/code-grep";

const SIBLING_NAMES = ["salonX", "salonXBusiness", "salonXKb", "salonXFlightdeck"] as const;

// --- siblings.read_index --------------------------------------------------

export const readIndexSchema = {
  description:
    "Read salon-x-business/INDEX.md and return the full feature-area → PRD path map. Useful for short-circuiting cross-repo lookup: if a feature area name overlaps with a Lark ticket title, the relevant PRDs are listed here.",
  inputSchema: {},
};

export async function readIndex() {
  const entries = await readPrdIndex();
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          entries.map((e) => ({
            featureArea: e.featureArea,
            prds: e.prdPaths.length,
            specs: e.specPaths.length,
            tech: e.techPaths.length,
            codePaths: e.codePaths,
            firstPrd: e.prdPaths[0],
          })),
          null,
          2
        ),
      },
    ],
  };
}

// --- siblings.search_prd_index --------------------------------------------

export const searchPrdIndexSchema = {
  description:
    "Search the PRD INDEX.md by keywords. Returns up to N feature areas whose name or PRD filenames match. Cheaper than greping every PRD body.",
  inputSchema: {
    keywords: z.array(z.string()).min(1).describe("Feature keywords"),
    limit: z.number().int().min(1).max(20).optional().default(5),
  },
};

export async function searchPrdIndexTool(args: {
  keywords: string[];
  limit?: number;
}) {
  const hits = await searchPrdIndex(args.keywords, { limit: args.limit ?? 5 });
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          hits.map((h) => ({
            featureArea: h.featureArea,
            prds: h.prdPaths,
            specs: h.specPaths,
            codePaths: h.codePaths,
          })),
          null,
          2
        ),
      },
    ],
  };
}

// --- siblings.read_file ---------------------------------------------------

export const readFileSchema = {
  description:
    "Read a markdown / text file inside one of the SalonX sibling repos. Path must resolve under the configured FLIGHTDECK_REPO_ROOT (binaries are refused).",
  inputSchema: {
    path: z
      .string()
      .describe(
        "Absolute path. Use one of the paths returned by siblings.read_index or siblings.search_prd_index, or a path under ~/all-salonx-repo/<sibling>/."
      ),
    max_bytes: z.number().int().min(1024).max(500_000).optional().default(200_000),
  },
};

export async function readFile(args: { path: string; max_bytes?: number }) {
  const result = await readSiblingFile(args.path, { maxBytes: args.max_bytes });
  return {
    content: [
      {
        type: "text" as const,
        text: result.truncated
          ? `[truncated to ${args.max_bytes ?? 200_000} bytes]\n\n${result.content}`
          : result.content,
      },
    ],
  };
}

// --- siblings.git_log_grep ------------------------------------------------

export const gitLogGrepSchema = {
  description:
    "Search commit messages in the salon-x production repo via `git log --grep`. Use to find recent shipped/merged work by keyword. Returns up to N matching commits with author, date, and subject.",
  inputSchema: {
    keyword: z.string().describe("Phrase to match in commit subjects/messages"),
    sibling: z
      .enum(SIBLING_NAMES)
      .optional()
      .default("salonX")
      .describe("Which sibling repo to search (default salonX)"),
    limit: z.number().int().min(1).max(100).optional().default(20),
  },
};

export async function gitLogGrepTool(args: {
  keyword: string;
  sibling?: SiblingName;
  limit?: number;
}) {
  const repoFn = SIBLINGS[args.sibling ?? "salonX"];
  const commits = await gitLogGrep(repoFn(), args.keyword, {
    limit: args.limit ?? 20,
  });
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(commits, null, 2),
      },
    ],
  };
}

// --- siblings.gh_pr_search ------------------------------------------------

export const ghPrSearchSchema = {
  description:
    "Search GitHub PRs in the salon-x repo by keyword via the gh CLI. Returns title, state, URL, author, and dates. Degrades gracefully if gh isn't installed/authed.",
  inputSchema: {
    keyword: z.string().describe("PR search query"),
    state: z.enum(["open", "closed", "merged", "all"]).optional().default("all"),
    limit: z.number().int().min(1).max(50).optional().default(10),
  },
};

export async function ghPrSearchTool(args: {
  keyword: string;
  state?: "open" | "closed" | "merged" | "all";
  limit?: number;
}) {
  const origin = await gitOriginGithub(SIBLINGS.salonX());
  if (!origin) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "no GitHub origin for salon-x" }),
        },
      ],
    };
  }
  try {
    const prs = await ghPrSearch(`${origin.owner}/${origin.repo}`, args.keyword, {
      state: args.state ?? "all",
      limit: args.limit ?? 10,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(prs, null, 2) },
      ],
    };
  } catch (e) {
    if (e instanceof GhUnavailable) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: "gh unavailable", detail: e.message }),
          },
        ],
      };
    }
    throw e;
  }
}

// --- siblings.code_grep ---------------------------------------------------

export const codeGrepSchema = {
  description:
    "Grep the salon-x production codebase for a regex pattern. Uses `git grep` so .gitignore is honoured automatically (node_modules/dist excluded). Returns up to 30 file:line:text hits, capped at 5 per file. Use this in the bd-to-dev / pair-sanity *investigation* phase to find how a feature actually works today before drafting a Story description's `Current behaviour` section.",
  inputSchema: {
    pattern: z
      .string()
      .describe(
        "Extended-regex pattern (POSIX). Examples: 'Designat[a-z]+', 'staffSchedul', 'BookingState\\.cancelled'. Case-insensitive by default."
      ),
    sibling: z
      .enum(SIBLING_NAMES)
      .optional()
      .default("salonX")
      .describe("Which sibling repo to grep (default salonX — the production codebase)."),
    extensions: z
      .array(z.string())
      .optional()
      .describe(
        "Restrict to filenames with these extensions, e.g. ['ts', 'tsx']. Omit to grep all tracked files."
      ),
    limit: z.number().int().min(1).max(50).optional().default(30),
    case_sensitive: z.boolean().optional().default(false),
  },
};

export async function codeGrepTool(args: {
  pattern: string;
  sibling?: SiblingName;
  extensions?: string[];
  limit?: number;
  case_sensitive?: boolean;
}) {
  const repoFn = SIBLINGS[args.sibling ?? "salonX"];
  const hits = await codeGrep(repoFn(), args.pattern, {
    limit: args.limit ?? 30,
    extensions: args.extensions,
    caseSensitive: args.case_sensitive ?? false,
  });
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          { sibling: args.sibling ?? "salonX", count: hits.length, hits },
          null,
          2
        ),
      },
    ],
  };
}

// --- siblings.kb_search ---------------------------------------------------

export const kbSearchSchema = {
  description:
    "Keyword search across salonx-kb help articles (Japanese under docs/, English under i18n/en/). Returns title, relative path, and short excerpt for each hit.",
  inputSchema: {
    keywords: z.array(z.string()).min(1),
    limit: z.number().int().min(1).max(30).optional().default(10),
  },
};

export async function kbSearchTool(args: {
  keywords: string[];
  limit?: number;
}) {
  const hits = await searchKb(args.keywords, { limit: args.limit ?? 10 });
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(hits, null, 2),
      },
    ],
  };
}
