import { redirect } from "next/navigation";
import { getToken } from "@flightdeck/auth/db";
import { TopBar } from "@/components/layout/TopBar";
import { DecisionsView } from "@/components/views/DecisionsView";

export const dynamic = "force-dynamic";

/**
 * Decisions index. Renders the searchable list of product decisions parsed
 * from `salon-x-business/decisions/`. Token gate matches the rest of the
 * dashboard tree — the layout already redirects, but the explicit gate here
 * mirrors the per-page pattern used elsewhere and keeps the contract local.
 */
export default function DecisionsIndexPage() {
  const token = getToken();
  if (!token) redirect("/");

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Decisions" queryKeyPrefix={["decisions"]} />
      <div className="flex-1 overflow-auto p-6">
        <DecisionsView />
      </div>
    </div>
  );
}
