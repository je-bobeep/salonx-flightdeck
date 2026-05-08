"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Map,
  Inbox,
  Network,
  CalendarRange,
  History,
  Sparkles,
  BookText,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: Sparkles },
  { href: "/triage", label: "Triage Queue", icon: Inbox },
  { href: "/roadmap", label: "Roadmap", icon: Map },
  { href: "/linkage", label: "Linkage", icon: Network },
  { href: "/sprint", label: "This Week", icon: CalendarRange },
  { href: "/decisions", label: "Decisions", icon: BookText },
  { href: "/sessions", label: "Sessions history", icon: History },
];

export function Sidebar({ userName }: { userName?: string | null }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-neutral-200 bg-neutral-50/60 px-3 py-4">
      <div className="mb-6 px-2">
        <div className="text-sm font-semibold tracking-tight text-neutral-900">
          flightdeck
        </div>
        <div className="text-xs text-neutral-500">salonx PM ops</div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                active
                  ? "bg-white text-neutral-900 shadow-card ring-1 ring-neutral-200"
                  : "text-neutral-600 hover:bg-white hover:text-neutral-900"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 border-t border-neutral-200 pt-3 px-2">
        <div className="text-xs text-neutral-500">Signed in as</div>
        <div className="text-sm font-medium text-neutral-800 truncate">
          {userName ?? "—"}
        </div>
        <form action="/api/auth/signout" method="post" className="mt-2">
          <button
            type="submit"
            className="text-xs text-neutral-500 hover:text-neutral-900 hover:underline"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
