"use client";

import { SEVERITIES, SEVERITY_ORDER } from "@/lib/severity";
import { FOCUS } from "@/lib/ui";
import type { Severity } from "@/lib/severity";

export default function SeverityFilter({
  active,
  counts,
  onToggle,
  loading = false,
}: {
  active: Set<Severity>;
  counts: Record<Severity, number>;
  onToggle: (s: Severity) => void;
  loading?: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg bg-black/20 p-1 ring-1 ring-white/10">
      {SEVERITY_ORDER.map((s) => {
        const on = active.has(s);
        const meta = SEVERITIES[s];
        const count = counts[s] ?? 0;
        return (
          <button
            key={s}
            onClick={() => onToggle(s)}
            aria-pressed={on}
            title={
              loading
                ? meta.label
                : `${meta.label} — ${count.toLocaleString()} events`
            }
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-md px-1 py-1.5 text-center transition ${FOCUS} ${
              on ? "bg-white/15 shadow-sm" : "hover:bg-white/5"
            }`}
          >
            <span
              className={`flex items-center gap-1.5 text-[11px] font-medium leading-none transition-colors ${
                on ? "text-white" : "text-white/50"
              }`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full ring-1 ring-black/20"
                style={{ background: meta.hex, opacity: on ? 1 : 0.55 }}
              />
              {meta.label}
            </span>
            <span
              className={`tabular-nums text-[10px] transition-colors ${
                on ? "text-white/60" : "text-white/35"
              }`}
            >
              {loading ? "—" : count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
