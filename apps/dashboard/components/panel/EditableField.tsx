"use client";

import * as React from "react";
import { Check, Pencil, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLarkDate } from "@/lib/format";

/**
 * Inline-editable field primitives used by the slide-over panels. Each one
 * wraps a "view" mode (click anywhere to enter edit) and a save/cancel pair
 * (⏎ saves, Esc cancels). Save calls `onSave(newValue)` and waits for it to
 * resolve before exiting edit mode; the parent does the actual PATCH and
 * query invalidation.
 */

type CommonProps<V> = {
  /** Current value to display + start with on edit. */
  value: V;
  /** Async — typically a fetch + query invalidate. Reject to surface error. */
  onSave: (newValue: V) => Promise<void>;
  /** Display when value is "empty". */
  placeholder?: string;
};

function useEditState<V>(initial: V) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<V>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset draft if the underlying value changes while we're in view mode.
  React.useEffect(() => {
    if (!editing) setDraft(initial);
  }, [initial, editing]);

  function start() {
    setDraft(initial);
    setError(null);
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(initial);
    setError(null);
  }
  return { editing, setEditing, draft, setDraft, busy, setBusy, error, setError, start, cancel };
}

// ---------------------------------------------------------------------------
// EditableText — single-line string field (e.g. Description, Sprint).

export function EditableText({
  value,
  onSave,
  placeholder = "—",
  multiline = false,
  className,
}: CommonProps<string> & { multiline?: boolean; className?: string }) {
  const s = useEditState(value);

  async function save() {
    if (s.draft === value) {
      s.cancel();
      return;
    }
    s.setBusy(true);
    s.setError(null);
    try {
      await onSave(s.draft);
      s.setEditing(false);
    } catch (e) {
      s.setError(e instanceof Error ? e.message : String(e));
    } finally {
      s.setBusy(false);
    }
  }

  if (s.editing) {
    if (multiline) {
      return (
        <div className="flex flex-col gap-1">
          <textarea
            autoFocus
            value={s.draft}
            onChange={(e) => s.setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") s.cancel();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
            }}
            disabled={s.busy}
            rows={Math.max(6, s.draft.split("\n").length + 1)}
            className={cn(
              "w-full rounded border border-blue-400 bg-white px-2 py-1.5 font-sans text-xs text-neutral-900 shadow-sm focus:outline-none",
              className
            )}
          />
          <ActionRow busy={s.busy} error={s.error} onSave={save} onCancel={s.cancel} />
          <p className="text-[10px] text-neutral-500">⌘↵ to save · Esc to cancel</p>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="text"
          value={s.draft}
          onChange={(e) => s.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") s.cancel();
            if (e.key === "Enter") save();
          }}
          onBlur={save}
          disabled={s.busy}
          className={cn(
            "min-w-0 flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-xs text-neutral-900 focus:outline-none",
            className
          )}
        />
        {s.error ? <span className="text-[10px] text-red-600">{s.error}</span> : null}
      </div>
    );
  }
  return (
    <ViewShell onClick={s.start}>
      {value && value.length > 0 ? (
        multiline ? (
          <pre className="whitespace-pre-wrap font-sans text-inherit">{value}</pre>
        ) : (
          <span>{value}</span>
        )
      ) : (
        <span className="text-neutral-400">{placeholder}</span>
      )}
    </ViewShell>
  );
}

// ---------------------------------------------------------------------------
// EditableSelect — single-select with a known option list.

export function EditableSelect({
  value,
  options,
  onSave,
  placeholder = "—",
  allowClear = true,
}: CommonProps<string> & {
  options: readonly string[];
  allowClear?: boolean;
}) {
  const s = useEditState(value);

  async function save(next: string) {
    if (next === value) {
      s.cancel();
      return;
    }
    s.setBusy(true);
    s.setError(null);
    try {
      await onSave(next);
      s.setEditing(false);
    } catch (e) {
      s.setError(e instanceof Error ? e.message : String(e));
    } finally {
      s.setBusy(false);
    }
  }

  if (s.editing) {
    return (
      <div className="flex items-center gap-1">
        <select
          autoFocus
          value={s.draft}
          onChange={(e) => save(e.target.value)}
          onBlur={() => {
            if (!s.busy) s.cancel();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") s.cancel();
          }}
          disabled={s.busy}
          className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0.5 text-xs text-neutral-900 focus:outline-none"
        >
          {allowClear ? <option value="">— (clear)</option> : null}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        {s.error ? <span className="text-[10px] text-red-600">{s.error}</span> : null}
      </div>
    );
  }
  return (
    <ViewShell onClick={s.start}>
      {value && value.length > 0 ? (
        <span>{value}</span>
      ) : (
        <span className="text-neutral-400">{placeholder}</span>
      )}
    </ViewShell>
  );
}

// ---------------------------------------------------------------------------
// EditableMultiSelect — checkbox list inside a small dropdown.

export function EditableMultiSelect({
  value,
  options,
  onSave,
  placeholder = "—",
}: CommonProps<string[]> & { options: readonly string[] }) {
  const s = useEditState(value);

  function toggle(opt: string) {
    s.setDraft(
      s.draft.includes(opt) ? s.draft.filter((x) => x !== opt) : [...s.draft, opt]
    );
  }
  async function save() {
    const sorted = (arr: string[]) => arr.slice().sort().join("|");
    if (sorted(s.draft) === sorted(value)) {
      s.cancel();
      return;
    }
    s.setBusy(true);
    s.setError(null);
    try {
      await onSave(s.draft);
      s.setEditing(false);
    } catch (e) {
      s.setError(e instanceof Error ? e.message : String(e));
    } finally {
      s.setBusy(false);
    }
  }

  if (s.editing) {
    // Allow free-typing of values not in the standard option list — the user
    // can encounter ad-hoc values from Lark.
    const knownPlusCurrent = Array.from(new Set([...options, ...s.draft]));
    return (
      <div className="flex flex-col gap-1 rounded border border-blue-400 bg-white p-1.5">
        <div className="flex max-h-44 flex-col gap-0.5 overflow-auto">
          {knownPlusCurrent.map((o) => (
            <label
              key={o}
              className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-neutral-800 hover:bg-neutral-50"
            >
              <input
                type="checkbox"
                checked={s.draft.includes(o)}
                onChange={() => toggle(o)}
                disabled={s.busy}
              />
              {o}
            </label>
          ))}
        </div>
        <ActionRow busy={s.busy} error={s.error} onSave={save} onCancel={s.cancel} />
      </div>
    );
  }
  return (
    <ViewShell onClick={s.start}>
      {value.length > 0 ? (
        <span>{value.join(", ")}</span>
      ) : (
        <span className="text-neutral-400">{placeholder}</span>
      )}
    </ViewShell>
  );
}

// ---------------------------------------------------------------------------
// EditableDate — yyyy-mm-dd input. Stores ISO date string in the view; the
// PATCH route converts to epoch ms before writing to Lark.

export function EditableDate({
  /** ETA / releaseDate raw string from DevRow — could be epoch ms or ISO. */
  value,
  onSave,
  placeholder = "—",
}: CommonProps<string>) {
  const s = useEditState(toISODate(value));

  async function save(next: string) {
    if (next === toISODate(value)) {
      s.cancel();
      return;
    }
    s.setBusy(true);
    s.setError(null);
    try {
      await onSave(next);
      s.setEditing(false);
    } catch (e) {
      s.setError(e instanceof Error ? e.message : String(e));
    } finally {
      s.setBusy(false);
    }
  }

  if (s.editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="date"
          value={s.draft}
          onChange={(e) => s.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") s.cancel();
            if (e.key === "Enter") save(s.draft);
          }}
          onBlur={() => save(s.draft)}
          disabled={s.busy}
          className="rounded border border-blue-400 bg-white px-1 py-0.5 text-xs text-neutral-900 focus:outline-none"
        />
        {s.error ? <span className="text-[10px] text-red-600">{s.error}</span> : null}
      </div>
    );
  }
  return (
    <ViewShell onClick={s.start}>
      {value ? (
        <span>{formatLarkDate(value)}</span>
      ) : (
        <span className="text-neutral-400">{placeholder}</span>
      )}
    </ViewShell>
  );
}

function toISODate(raw: string): string {
  if (!raw) return "";
  const num = Number(raw);
  if (Number.isFinite(num) && num > 1_000_000_000_000) {
    const d = new Date(num);
    return d.toISOString().slice(0, 10);
  }
  const t = Date.parse(raw);
  if (Number.isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  return raw;
}

// ---------------------------------------------------------------------------
// EditableUserPicker — single-user select, sourced from KNOWN_ASSIGNEES.

export function EditableUserPicker({
  /** Array because Lark User fields are multi-valued, but our UI only edits
   * the first one to keep the surface simple. The PATCH route accepts the
   * single open_id we send. */
  value,
  options,
  onSave,
  placeholder = "Unassigned",
}: CommonProps<{ id: string; name?: string }[]> & {
  options: readonly { name: string; openId: string }[];
}) {
  const current = value[0];
  const s = useEditState(current?.id ?? "");

  async function save(next: string) {
    if (next === (current?.id ?? "")) {
      s.cancel();
      return;
    }
    s.setBusy(true);
    s.setError(null);
    try {
      await onSave(next ? [{ id: next }] : []);
      s.setEditing(false);
    } catch (e) {
      s.setError(e instanceof Error ? e.message : String(e));
    } finally {
      s.setBusy(false);
    }
  }

  if (s.editing) {
    return (
      <div className="flex items-center gap-1">
        <select
          autoFocus
          value={s.draft}
          onChange={(e) => save(e.target.value)}
          onBlur={() => {
            if (!s.busy) s.cancel();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") s.cancel();
          }}
          disabled={s.busy}
          className="min-w-0 flex-1 rounded border border-blue-400 bg-white px-1 py-0.5 text-xs text-neutral-900 focus:outline-none"
        >
          <option value="">— (unassign)</option>
          {options.map((o) => (
            <option key={o.openId} value={o.openId}>
              {o.name}
            </option>
          ))}
        </select>
        {s.error ? <span className="text-[10px] text-red-600">{s.error}</span> : null}
      </div>
    );
  }
  return (
    <ViewShell onClick={s.start}>
      {current ? (
        <span>{current.name ?? current.id}</span>
      ) : (
        <span className="text-neutral-400">{placeholder}</span>
      )}
    </ViewShell>
  );
}

// ---------------------------------------------------------------------------
// Shared chrome.

function ViewShell({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-baseline gap-1.5 rounded px-1 py-0.5 text-left text-neutral-800 hover:bg-blue-50/40"
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <Pencil className="h-3 w-3 shrink-0 text-neutral-300 transition-opacity group-hover:text-neutral-500" />
    </button>
  );
}

function ActionRow({
  busy,
  error,
  onSave,
  onCancel,
}: {
  busy: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded bg-neutral-900 px-2 py-0.5 text-[11px] text-white disabled:opacity-50"
      >
        <Check className="h-3 w-3" />
        Save
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded border border-neutral-200 bg-white px-2 py-0.5 text-[11px] text-neutral-700 disabled:opacity-50"
      >
        <X className="h-3 w-3" />
        Cancel
      </button>
      {error ? <span className="text-[10px] text-red-600">{error}</span> : null}
    </div>
  );
}
