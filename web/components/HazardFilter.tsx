"use client";

import { HAZARDS, HAZARD_ORDER } from "@/lib/hazards";
import { listRow } from "@/lib/ui";
import { HazardIcon } from "@/components/icons";
import type { HazardType } from "@/lib/types";

export default function HazardFilter({
  active,
  counts,
  onToggle,
  loading = false,
}: {
  active: Set<HazardType>;
  counts: Record<HazardType, number>;
  onToggle: (h: HazardType) => void;
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      {HAZARD_ORDER.map((h) => {
        const meta = HAZARDS[h];
        const on = active.has(h);
        return (
          <button
            key={h}
            onClick={() => onToggle(h)}
            aria-pressed={on}
            className={listRow(on)}
          >
            {/* The hazard color rides the icon itself when active, so the row
                needs no separate swatch; when off it inherits the dim row text
                color via currentColor. */}
            <span
              className="shrink-0 transition-colors"
              style={on ? { color: meta.hex } : undefined}
            >
              <HazardIcon hazard={h} size={17} />
            </span>
            <span className="flex-1">{meta.label}</span>
            <span className="tabular-nums text-xs text-white/45">
              {loading ? "—" : (counts[h] ?? 0).toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
