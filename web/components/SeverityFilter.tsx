"use client";

import { SEVERITIES, SEVERITY_ORDER } from "@/lib/severity";
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
    <div className="flex gap-1">
      {SEVERITY_ORDER.map((s) => {
        const on = active.has(s);
        const meta = SEVERITIES[s];
        const count = counts[s] ?? 0;
        return (
          <button
            key={s}
            onClick={() => onToggle(s)}
            title={
              loading ? meta.label : `${meta.label} — ${count.toLocaleString()} events`
            }
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-center transition ${
              on ? "bg-white/15" : "opacity-40 hover:opacity-70"
            }`}
          >
            <span className="flex items-center gap-1 text-[11px] leading-none">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: meta.hex }}
              />
              {meta.label}
            </span>
            <span className="tabular-nums text-[10px] opacity-60">
              {loading ? "—" : count.toLocaleString()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
