"use client";

import { SEVERITIES, SEVERITY_ORDER } from "@/lib/severity";
import type { Severity, SeverityFilter as SeverityValue } from "@/lib/severity";

export default function SeverityFilter({
  value,
  counts,
  onChange,
}: {
  value: SeverityValue;
  counts: Record<Severity, number>;
  onChange: (v: SeverityValue) => void;
}) {
  const total = SEVERITY_ORDER.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium opacity-90">Severity</div>
      <div className="flex gap-1">
        <Segment
          label="All"
          count={total}
          on={value === "all"}
          onClick={() => onChange("all")}
        />
        {SEVERITY_ORDER.map((s) => (
          <Segment
            key={s}
            label={SEVERITIES[s].label}
            count={counts[s] ?? 0}
            hex={SEVERITIES[s].hex}
            on={value === s}
            onClick={() => onChange(s)}
          />
        ))}
      </div>
    </div>
  );
}

function Segment({
  label,
  count,
  hex,
  on,
  onClick,
}: {
  label: string;
  count: number;
  hex?: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`${label} — ${count.toLocaleString()} events`}
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-md px-1 py-1.5 text-center transition ${
        on ? "bg-white/15" : "opacity-50 hover:opacity-80"
      }`}
    >
      <span className="flex items-center gap-1 text-[11px] leading-none">
        {hex && (
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: hex }}
          />
        )}
        {label}
      </span>
      <span className="tabular-nums text-[10px] opacity-60">
        {count.toLocaleString()}
      </span>
    </button>
  );
}
