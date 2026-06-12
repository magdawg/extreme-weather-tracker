"use client";

import { SOURCES, SOURCE_ORDER } from "@/lib/sources";
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
    <div className="flex flex-col gap-1.5">
      {SOURCE_ORDER.map((s) => {
        const meta = SOURCES[s];
        const on = active.has(s);
        return (
          <button
            key={s}
            onClick={() => onToggle(s)}
            title={meta.description}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
              on ? "bg-white/10" : "opacity-40 hover:opacity-70"
            }`}
          >
            <span className="inline-flex h-3 w-3 items-center justify-center rounded-full border border-white/30 text-[8px] font-semibold leading-none">
              {meta.mark}
            </span>
            <span className="flex-1">{meta.label}</span>
            <span className="tabular-nums text-xs opacity-60">
              {loading ? "—" : (counts[s] ?? 0)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
