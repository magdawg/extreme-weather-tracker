"use client";

const DAY_MS = 86_400_000;

function fmt(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function TimeSlider({
  minMs,
  maxMs,
  valueMs,
  onChange,
}: {
  minMs: number;
  maxMs: number;
  valueMs: number;
  onChange: (ms: number) => void;
}) {
  const atNow = valueMs >= maxMs;
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 text-xs opacity-60">{fmt(minMs)}</span>
      <input
        type="range"
        min={minMs}
        max={maxMs}
        step={DAY_MS}
        value={valueMs}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-indigo-400"
      />
      <span className="w-20 text-right text-xs tabular-nums opacity-80">
        {atNow ? "Now" : fmt(valueMs)}
      </span>
    </div>
  );
}
