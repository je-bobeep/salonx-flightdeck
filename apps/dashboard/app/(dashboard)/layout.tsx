import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getSession, SESSION_COOKIE_NAME } from "@flightdeck/auth/db";
import { whoami } from "@flightdeck/lark/whoami";
import { Sidebar } from "@/components/layout/Sidebar";
import { ReauthBanner } from "@/components/layout/ReauthBanner";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { TicketPanelHost } from "@/components/panel/TicketPanel";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = sessionId ? getSession(sessionId) : null;
  if (!session) {
    redirect("/");
  }

  // Try to get the user's name for the sidebar footer; tolerate auth errors.
  let userName: string | null = null;
  try {
    const me = await whoami();
    userName = me?.name ?? null;
  } catch {
    // Banner will surface the error; sidebar just shows a dash.
  }

  return (
    <QueryProvider>
      <div className="flex h-screen overflow-hidden bg-neutral-50">
        <Sidebar userName={userName} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <ReauthBanner />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
        <Suspense fallback={null}>
          <TicketPanelHost />
        </Suspense>
      </div>
    </QueryProvider>
  );
}
