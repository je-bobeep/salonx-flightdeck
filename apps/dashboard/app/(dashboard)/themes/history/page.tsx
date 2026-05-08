import { TopBar } from "@/components/layout/TopBar";
import { Badge } from "@/components/ui/badge";
import { readDailyBucketHistory } from "@flightdeck/themes/cache";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Theme cluster history (debug). Lists the most-recent 14 daily buckets so
 * the user can inspect prior clusterings and re-seed the candidate vocabulary
 * when a clustering looked good but later drifted. Reads SQLite directly via
 * the cache helper rather than going through `/api/data/themes/history` —
 * server-component path, no extra HTTP hop.
 */
export default function ThemesHistoryPage() {
  const history = readDailyBucketHistory();

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Theme history" />
      <div className="flex-1 overflow-auto p-6">
        <div className="flex flex-col gap-4">
          <header>
            <h1 className="text-base font-semibold tracking-tight text-neutral-900">
              Theme cluster history (14d retention)
            </h1>
            <p className="mt-1 max-w-3xl text-xs text-neutral-500">
              Each row is a daily snapshot. Useful for re-seeding the
              candidate vocabulary when a clustering looked good but later
              drifted.
            </p>
          </header>

          <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-card">
            {history.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-neutral-500">
                No daily theme buckets cached yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50/60 text-[11px] uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                    <th className="px-4 py-2 text-left font-medium">Mode</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Themes
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Names</th>
                    <th className="px-4 py-2 text-left font-medium">
                      Computed at
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {history.map((entry) => (
                    <HistoryRow
                      key={entry.dateKey}
                      dateKey={entry.dateKey}
                      mode={entry.payload.mode}
                      themeCount={entry.payload.themes.length}
                      themeNames={entry.payload.themes.map((t) => t.name)}
                      computedAt={entry.payload.computedAt}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({
  dateKey,
  mode,
  themeCount,
  themeNames,
  computedAt,
}: {
  dateKey: string;
  mode: "claude" | "fallback" | "unavailable";
  themeCount: number;
  themeNames: string[];
  computedAt: string;
}) {
  // Pick a tone for the mode badge. "claude" = success, "unavailable" =
  // warn, legacy "fallback" = neutral (won't be minted by writes anymore but
  // older buckets may still carry it).
  const tone =
    mode === "claude" ? "success" : mode === "unavailable" ? "warn" : "neutral";

  // Truncate the joined names so a wide cluster doesn't push the table to
  // overflow horizontally on narrow viewports.
  const joined = themeNames.join(", ");
  const truncated =
    joined.length > 200 ? `${joined.slice(0, 200)}…` : joined;

  return (
    <tr className="align-top">
      <td className="px-4 py-2 font-mono text-xs text-neutral-700">
        {dateKey}
      </td>
      <td className="px-4 py-2">
        <Badge tone={tone}>{mode}</Badge>
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-neutral-800">
        {themeCount}
      </td>
      <td
        className={cn(
          "px-4 py-2 text-xs",
          themeNames.length === 0 ? "text-neutral-400" : "text-neutral-700"
        )}
        title={themeNames.length > 0 ? joined : undefined}
      >
        {themeNames.length === 0 ? "—" : truncated}
      </td>
      <td className="px-4 py-2 text-xs text-neutral-500">
        {formatComputedAt(computedAt)}
      </td>
    </tr>
  );
}

function formatComputedAt(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  // Match the locale-aware short format used elsewhere in the dashboard.
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
