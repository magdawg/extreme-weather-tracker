"use client";

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
      <span className="text-xs opacity-60">Speed</span>
      <div className="flex gap-1">
        {SPEED_OPTIONS.map((o) => {
          const on = value === o.speed;
          return (
            <button
              key={o.label}
              onClick={() => onChange(o.speed)}
              title={`Play at ${o.label} speed`}
              className={`rounded-md px-2 py-0.5 text-xs tabular-nums transition ${
                on ? "bg-white/15" : "opacity-50 hover:opacity-80"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
