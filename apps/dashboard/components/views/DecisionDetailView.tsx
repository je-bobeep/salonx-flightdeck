"use client";

import * as React from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDecision } from "@/lib/queries/data";
import type { Decision, DecisionKind, DecisionStatus } from "@/lib/decisions-shapes";

/** Same kind tone palette as DecisionsView. Duplicated rather than imported so
 * the two views can drift independently if we want different emphasis on the
 * detail page (e.g. larger badges) — for now they're identical. */
const KIND_TONE: Record<
  DecisionKind,
  "neutral" | "success" | "warn" | "danger" | "accent"
> = {
  commit: "accent",
  decline: "warn",
  defer: "neutral",
  tradeoff: "neutral",
  design: "accent",
  process: "neutral",
};

const STATUS_TONE: Record<
  DecisionStatus,
  "neutral" | "success" | "warn" | "danger" | "accent"
> = {
  // active = blue (in flight); superseded = neutral (quietly retired);
  // reverted = warn (loud — we tried it and pulled it back).
  active: "accent",
  superseded: "neutral",
  reverted: "warn",
};

export function DecisionDetailView({ slug }: { slug: string }) {
  const { data, isLoading, error } = useDecision(slug);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-500">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (!data) return null;
  if (!data.ok) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {data.error}
      </div>
    );
  }

  const decision = data.decision;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/decisions"
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900"
        >
          <ArrowLeft className="h-3 w-3" /> All decisions
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <DecisionBody decision={decision} />
        <DecisionSidebar decision={decision} />
      </div>
    </div>
  );
}

/** Renders the markdown body. We don't have @tailwindcss/typography installed,
 * so each common element gets a hand-tuned className via the `components`
 * prop. Wrapper uses `space-y-3` so paragraphs/headings don't collide.
 *
 * If we later add @tailwindcss/typography, swap this whole block for
 * `<div className="prose prose-neutral max-w-none">`. */
function DecisionBody({ decision }: { decision: Decision }) {
  return (
    <article className="rounded-lg border border-neutral-200 bg-white p-6 shadow-card">
      <h1 className="mb-4 text-lg font-semibold tracking-tight text-neutral-900">
        {decision.frontmatter.title}
      </h1>
      <div className="space-y-3 text-sm leading-relaxed text-neutral-800">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="mt-6 text-base font-semibold text-neutral-900">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-neutral-700">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="mt-4 text-sm font-semibold text-neutral-800">
                {children}
              </h3>
            ),
            p: ({ children }) => (
              <p className="text-sm leading-relaxed text-neutral-800">
                {children}
              </p>
            ),
            ul: ({ children }) => (
              <ul className="ml-5 list-disc space-y-1 text-sm text-neutral-800 marker:text-neutral-400">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="ml-5 list-decimal space-y-1 text-sm text-neutral-800 marker:text-neutral-400">
                {children}
              </ol>
            ),
            li: ({ children }) => <li className="pl-1">{children}</li>,
            a: ({ children, href }) => (
              <a
                href={href}
                className="text-blue-700 underline-offset-2 hover:underline"
                target={href?.startsWith("http") ? "_blank" : undefined}
                rel={
                  href?.startsWith("http") ? "noreferrer noopener" : undefined
                }
              >
                {children}
              </a>
            ),
            code: ({ children, className }) => {
              // ReactMarkdown calls this for both inline code and fenced
              // blocks; the fenced version supplies a `language-…` className.
              const isBlock = Boolean(className);
              if (isBlock) {
                return (
                  <code className="block whitespace-pre rounded-md bg-neutral-50 p-3 font-mono text-[12px] text-neutral-800">
                    {children}
                  </code>
                );
              }
              return (
                <code className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[12px] text-neutral-800">
                  {children}
                </code>
              );
            },
            blockquote: ({ children }) => (
              <blockquote className="border-l-2 border-neutral-300 pl-3 text-neutral-600 italic">
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  {children}
                </table>
              </div>
            ),
            th: ({ children }) => (
              <th className="border-b border-neutral-200 px-2 py-1 text-left font-semibold text-neutral-700">
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td className="border-b border-neutral-100 px-2 py-1 text-neutral-800">
                {children}
              </td>
            ),
            hr: () => <hr className="my-4 border-neutral-200" />,
          }}
        >
          {decision.body}
        </ReactMarkdown>
      </div>
    </article>
  );
}

function DecisionSidebar({ decision }: { decision: Decision }) {
  const fm = decision.frontmatter;
  return (
    <aside className="flex flex-col gap-4">
      <SidebarBlock>
        <SidebarLabel>Status</SidebarLabel>
        <Badge tone={STATUS_TONE[fm.status]}>{fm.status}</Badge>
      </SidebarBlock>

      <SidebarBlock>
        <SidebarLabel>Kind</SidebarLabel>
        <div className="flex flex-wrap gap-1">
          {fm.kind.map((k) => (
            <Badge key={k} tone={KIND_TONE[k]}>
              {k}
            </Badge>
          ))}
        </div>
      </SidebarBlock>

      <SidebarBlock>
        <SidebarLabel>Date</SidebarLabel>
        <div className="text-sm text-neutral-800">{fm.date}</div>
      </SidebarBlock>

      {fm.stakeholders && fm.stakeholders.length > 0 ? (
        <SidebarBlock>
          <SidebarLabel>Stakeholders</SidebarLabel>
          <ul className="space-y-0.5 text-sm text-neutral-800">
            {fm.stakeholders.map((sh) => (
              <li key={sh}>{sh}</li>
            ))}
          </ul>
        </SidebarBlock>
      ) : null}

      {fm.tags && fm.tags.length > 0 ? (
        <SidebarBlock>
          <SidebarLabel>Tags</SidebarLabel>
          <div className="flex flex-wrap gap-1">
            {fm.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-600"
              >
                {t}
              </span>
            ))}
          </div>
        </SidebarBlock>
      ) : null}

      <RelatedSection decision={decision} />

      <CopyPermalinkButton />

      <p className="rounded-md bg-neutral-50 px-3 py-2 text-[11px] leading-relaxed text-neutral-500">
        Edit at{" "}
        <code className="font-mono text-neutral-700">
          salon-x-business/decisions/{decision.slug}.md
        </code>
      </p>
    </aside>
  );
}

/** Frontmatter `related_*` fields, rendered as text-only chips. v1 has no
 * route to render a Lark BD/Dev row in isolation, so the chips don't link
 * anywhere yet — when v2 adds the slide-over wiring, swap each chip for a
 * Link / button that opens the panel. The PRD pointer falls back to a
 * copy-to-clipboard since portal can't render a salon-x-business path
 * directly either. */
function RelatedSection({ decision }: { decision: Decision }) {
  const fm = decision.frontmatter;
  const hasAny =
    (fm.related_bd && fm.related_bd.length > 0) ||
    (fm.related_dev && fm.related_dev.length > 0) ||
    Boolean(fm.related_prd) ||
    Boolean(fm.related_meeting) ||
    Boolean(fm.supersedes);
  if (!hasAny) return null;

  return (
    <SidebarBlock>
      <SidebarLabel>Related</SidebarLabel>
      <div className="flex flex-col gap-2 text-sm">
        {fm.related_bd && fm.related_bd.length > 0 ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              BD
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {fm.related_bd.map((r) => (
                <RelatedChip key={r}>{r}</RelatedChip>
              ))}
            </div>
          </div>
        ) : null}

        {fm.related_dev && fm.related_dev.length > 0 ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              Dev
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {fm.related_dev.map((r) => (
                <RelatedChip key={r}>{r}</RelatedChip>
              ))}
            </div>
          </div>
        ) : null}

        {fm.related_prd ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              PRD
            </div>
            <CopyablePath path={fm.related_prd} />
          </div>
        ) : null}

        {fm.related_meeting ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              Meeting
            </div>
            <CopyablePath path={fm.related_meeting} />
          </div>
        ) : null}

        {fm.supersedes ? (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              Supersedes
            </div>
            <Link
              href={`/decisions/${fm.supersedes}`}
              className="text-sm text-blue-700 underline-offset-2 hover:underline"
            >
              {fm.supersedes}
            </Link>
          </div>
        ) : null}
      </div>
    </SidebarBlock>
  );
}

function RelatedChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-md bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-700"
      title="v1: text-only. v2 will resolve to the BD/Dev row panel."
    >
      {children}
    </span>
  );
}

/** Copy-the-path-to-clipboard mini-button. salon-x-business paths can't be
 * rendered by the portal, so the most useful affordance is "give me the
 * string so I can `cd` to it in another window". */
function CopyablePath({ path }: { path: string }) {
  const [copied, setCopied] = React.useState(false);
  function handleCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(path).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 text-left text-[11px] font-mono text-neutral-700 hover:bg-neutral-200"
      title="Copy path to clipboard"
    >
      <span className="truncate">{path}</span>
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-green-600" />
      ) : (
        <Copy className="h-3 w-3 shrink-0 text-neutral-500" />
      )}
    </button>
  );
}

function CopyPermalinkButton() {
  const [copied, setCopied] = React.useState(false);
  function handleCopy() {
    if (typeof window !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }
  return (
    <Button variant="secondary" size="sm" onClick={handleCopy}>
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5" /> Copied!
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" /> Copy permalink
        </>
      )}
    </Button>
  );
}

function SidebarBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 shadow-card">
      {children}
    </div>
  );
}

function SidebarLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
      {children}
    </div>
  );
}
