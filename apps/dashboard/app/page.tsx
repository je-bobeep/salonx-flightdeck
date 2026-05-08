import { redirect } from "next/navigation";
import { getToken } from "@flightdeck/auth/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const token = getToken();
  if (token) {
    redirect("/today");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">salonx-flightdeck</h1>
        <p className="text-sm text-neutral-500">
          Personal PM ops tooling for SalonX. Local-only.
        </p>
      </header>
      <section className="rounded-lg border border-neutral-200 bg-white p-6 shadow-card">
        <div className="flex flex-col gap-3">
          <p className="text-base">Not signed in.</p>
          <a
            href="/auth/lark/start"
            className="self-start rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Sign in with Lark
          </a>
        </div>
      </section>
    </main>
  );
}
