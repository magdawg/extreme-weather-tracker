"use client";

import { SOURCES, SOURCE_ORDER } from "@/lib/sources";
import { listRow } from "@/lib/ui";
import type { SourceId } from "@/lib/sources";

export default function SourceFilter({
  active,
  counts,
  onToggle,
  loading = false,
}: {
  active: Set<SourceId>;
  counts: Record<SourceId, number>;
  onToggle: (s: SourceId) => void;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {SOURCE_ORDER.map((s) => {
        const meta = SOURCES[s];
        const on = active.has(s);
        return (
          <button
            key={s}
            onClick={() => onToggle(s)}
            aria-pressed={on}
            title={meta.description}
            className={listRow(on)}
          >
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[9px] font-semibold leading-none ring-1 transition-colors ${
                on
                  ? "bg-indigo-400/15 text-indigo-200 ring-indigo-300/30"
                  : "text-white/50 ring-white/15"
              }`}
            >
              {meta.mark}
            </span>
            <span className="flex-1">{meta.label}</span>
            <span className="tabular-nums text-xs text-white/45">
              {loading ? "—" : (counts[s] ?? 0).toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
