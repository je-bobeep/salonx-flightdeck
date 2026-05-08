"use client";

import * as React from "react";
import { useSetDevThemeOverride, useThemes } from "@/lib/queries/data";

export function DevThemePicker({ devRecordId }: { devRecordId: string }) {
  const { data } = useThemes();
  const mutate = useSetDevThemeOverride();
  const [editing, setEditing] = React.useState(false);

  const themes = data?.ok ? data.blob.themes : [];
  const current = themes.find((t) => t.devRecordIds.includes(devRecordId));

  function onPick(themeId: string) {
    if (themeId === current?.id || !themeId) {
      setEditing(false);
      return;
    }
    mutate.mutate(
      { devRecordId, themeId },
      { onSettled: () => setEditing(false) }
    );
  }

  if (!data?.ok || themes.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-neutral-400">
        Theme: — (no clusters yet)
      </p>
    );
  }

  if (editing) {
    return (
      <div className="mt-2 flex items-center gap-2 text-[11px]">
        <span className="text-neutral-500">Move to:</span>
        <select
          autoFocus
          defaultValue={current?.id ?? ""}
          onChange={(e) => onPick(e.target.value)}
          className="rounded border border-neutral-200 bg-white px-1 py-0.5 text-[11px]"
          disabled={mutate.isPending}
        >
          <option value="" disabled>
            Pick a theme…
          </option>
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.bdVolume})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-neutral-500 hover:text-neutral-800"
        >
          cancel
        </button>
      </div>
    );
  }

  return (
    <p className="mt-2 text-[11px] text-neutral-500">
      Theme:{" "}
      <span className="text-neutral-700">{current?.name ?? "— (unclustered)"}</span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="ml-1.5 text-blue-600 hover:underline"
      >
        Move…
      </button>
    </p>
  );
}
