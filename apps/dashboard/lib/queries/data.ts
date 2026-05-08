"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  TriageData,
  LinkageData,
  SprintData,
  SessionRow,
  TodayData,
  RoadmapData,
} from "@/lib/data-shapes";
import type {
  DecisionsListResponse,
  DecisionDetailResponse,
  DecisionsSearchIndexResponse,
} from "@/lib/decisions-shapes";
import type { ThemesBlob } from "@flightdeck/themes/shapes";

async function jsonGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    throw new Error(`${url}: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export function useTriage() {
  return useQuery<TriageData>({
    queryKey: ["triage"],
    queryFn: () => jsonGet<TriageData>("/api/data/triage"),
  });
}

export function useLinkage() {
  return useQuery<LinkageData>({
    queryKey: ["linkage"],
    queryFn: () => jsonGet<LinkageData>("/api/data/linkage"),
  });
}

export function useSprint() {
  return useQuery<SprintData>({
    queryKey: ["sprint"],
    queryFn: () => jsonGet<SprintData>("/api/data/sprint"),
  });
}

export function useSessions() {
  return useQuery<{ sessions: SessionRow[] }>({
    queryKey: ["sessions"],
    queryFn: () => jsonGet<{ sessions: SessionRow[] }>("/api/data/sessions"),
  });
}

export function useToday() {
  return useQuery<TodayData>({
    queryKey: ["today"],
    queryFn: () => jsonGet<TodayData>("/api/data/today"),
  });
}

export type ThemesResponse = {
  ok: boolean;
  blob: ThemesBlob;
  fetchedAt: number;
  fresh: boolean;
  error?: string;
};

export function useThemes() {
  return useQuery<ThemesResponse>({
    queryKey: ["themes"],
    queryFn: () => jsonGet<ThemesResponse>("/api/data/themes"),
    // Cluster cache rolls over daily — no aggressive refetch needed.
    staleTime: 5 * 60 * 1000,
  });
}

/** Force a re-cluster (POST). Default mode is incremental: existing
 * assignments are sticky and only newly-arrived BD rows get bucketed. Pass
 * `from-scratch` to recompute every assignment (use when themes feel stale
 * or wrong). On success, invalidates dependent queries. */
export function useRefreshThemes() {
  const qc = useQueryClient();
  return useMutation<ThemesResponse, Error, "incremental" | "from-scratch" | undefined>({
    mutationFn: async (mode) => {
      const res = await fetch("/api/data/themes", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: mode ?? "incremental" }),
      });
      if (!res.ok) {
        // Surface the server's structured error verbatim — the route emits a
        // human-readable message for the 429 cooldown case that we want the
        // user to see, not a generic "HTTP 429".
        let serverMsg = "";
        try {
          const body = (await res.json()) as { error?: unknown };
          const err = body?.error;
          if (typeof err === "string") serverMsg = err;
        } catch {
          // ignore
        }
        throw new Error(
          serverMsg || `themes refresh: HTTP ${res.status}`
        );
      }
      return (await res.json()) as ThemesResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["themes"] });
      qc.invalidateQueries({ queryKey: ["linkage"] });
      qc.invalidateQueries({ queryKey: ["roadmap"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

/** Manual per-row "Move to theme" override (BD side). Sticky across reclusters. */
export function useSetRowThemeOverride() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean },
    Error,
    { bdRecordId: string; themeId: string | null }
  >({
    mutationFn: async ({ bdRecordId, themeId }) => {
      const res = await fetch("/api/data/themes/override", {
        method: themeId ? "POST" : "DELETE",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "bd", bdRecordId, themeId }),
      });
      if (!res.ok) throw new Error(`override: HTTP ${res.status}`);
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["themes"] });
      qc.invalidateQueries({ queryKey: ["roadmap"] });
      qc.invalidateQueries({ queryKey: ["linkage"] });
    },
  });
}

/** Manual per-row "Move to theme" override (Dev side). Sticky across reclusters. */
export function useSetDevThemeOverride() {
  const qc = useQueryClient();
  return useMutation<
    { ok: boolean },
    Error,
    { devRecordId: string; themeId: string | null }
  >({
    mutationFn: async ({ devRecordId, themeId }) => {
      const res = await fetch("/api/data/themes/override", {
        method: themeId ? "POST" : "DELETE",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "dev", devRecordId, themeId }),
      });
      if (!res.ok) throw new Error(`override: HTTP ${res.status}`);
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["themes"] });
      qc.invalidateQueries({ queryKey: ["roadmap"] });
      qc.invalidateQueries({ queryKey: ["linkage"] });
    },
  });
}

export function useRoadmap() {
  return useQuery<RoadmapData>({
    queryKey: ["roadmap"],
    queryFn: () => jsonGet<RoadmapData>("/api/data/roadmap"),
  });
}

/** List of decisions (frontmatter + summary, no body). Cheap to refetch on
 * focus, so a 60s staleTime is plenty. */
export function useDecisions() {
  return useQuery<DecisionsListResponse>({
    queryKey: ["decisions"],
    queryFn: () => jsonGet<DecisionsListResponse>("/api/data/decisions"),
    staleTime: 60_000,
  });
}

/** Full decision (frontmatter + body) for the detail page. Disabled until a
 * truthy slug is available. */
export function useDecision(slug: string | undefined | null) {
  return useQuery<DecisionDetailResponse>({
    queryKey: ["decision", slug],
    queryFn: () =>
      jsonGet<DecisionDetailResponse>(
        `/api/data/decisions/${encodeURIComponent(slug as string)}`
      ),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
}

/** Pre-built MiniSearch index for client-side hydration. Larger payload, so
 * cache aggressively (5 min) — the index is only invalidated when a decision
 * file is added/edited, which is cheap to wait out. */
export function useDecisionsSearchIndex() {
  return useQuery<DecisionsSearchIndexResponse>({
    queryKey: ["decisions-search-index"],
    queryFn: () =>
      jsonGet<DecisionsSearchIndexResponse>(
        "/api/data/decisions/search-index"
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export type TaxonomyProposalsResponse = {
  ok: boolean;
  proposals: Array<{
    name: string;
    firstSeenAt: number;
    lastSeenAt: number;
    memberCount: number;
  }>;
  error?: string;
};

/** Pending taxonomy proposals — names Claude minted that aren't in
 * CANDIDATE_THEMES yet. The user accepts (record-only) or rejects each. */
export function useTaxonomyProposals() {
  return useQuery<TaxonomyProposalsResponse>({
    queryKey: ["taxonomy-proposals"],
    queryFn: () => jsonGet<TaxonomyProposalsResponse>("/api/data/themes/proposals"),
    staleTime: 5 * 60 * 1000,
  });
}

/** Accept or reject a pending proposal. Records the decision in the
 * taxonomy_proposals table; the actual canon edit is manual (taxonomy.ts). */
export function useDecideProposal() {
  const qc = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { name: string; action: "accept" | "reject" }>({
    mutationFn: async ({ name, action }) => {
      const res = await fetch("/api/data/themes/proposals", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, action }),
      });
      if (!res.ok) throw new Error(`proposal decide: HTTP ${res.status}`);
      return (await res.json()) as { ok: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["taxonomy-proposals"] });
    },
  });
}
