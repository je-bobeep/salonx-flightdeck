import { redirect } from "next/navigation";
import { getToken } from "@flightdeck/auth/db";
import { TopBar } from "@/components/layout/TopBar";
import { DecisionDetailView } from "@/components/views/DecisionDetailView";

export const dynamic = "force-dynamic";

/**
 * Decision detail. Same token gate as the index page; the slug is decoded
 * from the route segment and passed straight through to the client view,
 * which fetches `/api/data/decisions/<slug>` via TanStack Query.
 */
export default async function DecisionDetailPage(ctx: {
  params: Promise<{ slug: string }>;
}) {
  const token = getToken();
  if (!token) redirect("/");
  const { slug } = await ctx.params;

  return (
    <div className="flex h-full flex-col">
      <TopBar title="Decision" queryKeyPrefix={["decision", slug]} />
      <div className="flex-1 overflow-auto p-6">
        <DecisionDetailView slug={slug} />
      </div>
    </div>
  );
}
