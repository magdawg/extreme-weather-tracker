"use client";

import { HAZARDS, HAZARD_ORDER } from "@/lib/hazards";
import type { HazardType } from "@/lib/types";

export default function HazardFilter({
  active,
  counts,
  onToggle,
}: {
  active: Set<HazardType>;
  counts: Record<HazardType, number>;
  onToggle: (h: HazardType) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {HAZARD_ORDER.map((h) => {
        const meta = HAZARDS[h];
        const on = active.has(h);
        return (
          <button
            key={h}
            onClick={() => onToggle(h)}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
              on ? "bg-white/10" : "opacity-40 hover:opacity-70"
            }`}
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ background: meta.hex }}
            />
            <span className="flex-1">
              {meta.emoji} {meta.label}
            </span>
            <span className="tabular-nums text-xs opacity-60">
              {counts[h] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
