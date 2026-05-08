"use client";

import { useQueryClient } from "@tanstack/react-query";
import { RefreshCcw } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * Top bar showing the active view title + global "fetched Ns ago" + manual
 * refresh. The freshness label aggregates dataUpdatedAt across all queries
 * with a key prefix the page declares (default: all).
 */
export function TopBar({
  title,
  queryKeyPrefix,
}: {
  title: string;
  queryKeyPrefix?: readonly unknown[];
}) {
  const qc = useQueryClient();
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);

  // Find newest dataUpdatedAt across visible queries
  const newestUpdate = React.useMemo(() => {
    const queries = qc
      .getQueryCache()
      .findAll({ queryKey: queryKeyPrefix, exact: false });
    let max = 0;
    for (const q of queries) {
      const t = q.state.dataUpdatedAt;
      if (t > max) max = t;
    }
    return max;
  }, [qc, now, queryKeyPrefix]);

  const ageSeconds =
    newestUpdate > 0 ? Math.max(0, Math.round((now - newestUpdate) / 1000)) : null;

  function refresh() {
    qc.invalidateQueries({ queryKey: queryKeyPrefix, exact: false });
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6">
      <h1 className="text-base font-semibold tracking-tight text-neutral-900">
        {title}
      </h1>
      <div className="flex items-center gap-3">
        <span className="text-xs text-neutral-500">
          {ageSeconds === null
            ? "—"
            : ageSeconds < 5
              ? "fetched just now"
              : `fetched ${formatAge(ageSeconds)} ago`}
        </span>
        <Button variant="secondary" size="sm" onClick={refresh}>
          <RefreshCcw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>
    </header>
  );
}

function formatAge(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}
