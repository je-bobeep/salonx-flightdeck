import { z } from "zod";
import { larkFetch } from "./client";

const WikiNodeResponse = z.object({
  code: z.number(),
  data: z
    .object({
      node: z
        .object({
          obj_token: z.string(),
          obj_type: z.string(),
          node_token: z.string(),
          node_type: z.string(),
          space_id: z.string().optional(),
          parent_node_token: z.string().optional(),
          title: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

// Cache resolutions for the lifetime of the process — these don't change
// often and the workspace tree is stable.
const cache = new Map<string, string>();

/**
 * Resolve a Lark Wiki node token (e.g. `LyN0w7ukQiLZ70k3yMclfCy7gwc`) to the
 * underlying object token (e.g. a Bitable app_token). Used to avoid hardcoding
 * IDs that move when the doc is reorganized in the wiki tree.
 */
export async function resolveWikiToken(wikiToken: string): Promise<string> {
  const hit = cache.get(wikiToken);
  if (hit) return hit;

  const json = await larkFetch({
    path: "/wiki/v2/spaces/get_node",
    query: { token: wikiToken, obj_type: "wiki" },
  });
  const parsed = WikiNodeResponse.parse(json);
  const objToken = parsed.data?.node?.obj_token;
  if (!objToken) {
    throw new Error(`Wiki node ${wikiToken} returned no obj_token`);
  }
  cache.set(wikiToken, objToken);
  return objToken;
}

// Static IDs straight from memory/reference_lark_base.md — these are "tier 0"
// fallbacks for when the wiki resolve hasn't run yet (e.g. server-component
// first paint). Always prefer resolveWikiToken() in user-driven flows.
export const TRACKER = {
  wikiToken: "LyN0w7ukQiLZ70k3yMclfCy7gwc",
  appToken: "MObXbnFnkafeEAsRrFUlcwrRgcf",
  tables: {
    bdFeedback: "tbl49YoFep0cYYDd",
    featureDevelopment: "tblU2lOjqHwSbWor",
    bugs: "tblsY2Bov8Y8PNXx",
  },
  webRoot: "https://storehub.sg.larksuite.com/wiki/LyN0w7ukQiLZ70k3yMclfCy7gwc",
} as const;
