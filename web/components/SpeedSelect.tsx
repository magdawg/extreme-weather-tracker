"use client";

import { SEGMENT, segmentBtn } from "@/lib/ui";

// Multiplier applied to the playback step size — higher sweeps faster.
export const SPEED_OPTIONS: { label: string; speed: number }[] = [
  { label: "0.5×", speed: 0.5 },
  { label: "1×", speed: 1 },
  { label: "2×", speed: 2 },
  { label: "4×", speed: 4 },
];

export default function SpeedSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (speed: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">
        Speed
      </span>
      <div className={SEGMENT}>
        {SPEED_OPTIONS.map((o) => {
          const on = value === o.speed;
          return (
            <button
              key={o.label}
              onClick={() => onChange(o.speed)}
              aria-pressed={on}
              title={`Play at ${o.label} speed`}
              className={segmentBtn(on)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
