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
  playing,
  onTogglePlay,
}: {
  minMs: number;
  maxMs: number;
  valueMs: number;
  onChange: (ms: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  const atNow = valueMs >= maxMs;
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onTogglePlay}
        aria-label={playing ? "Pause playback" : "Play forward in time"}
        aria-pressed={playing}
        title={playing ? "Pause" : "Play forward in time"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/90 transition hover:bg-white/10"
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect x="2" y="1.5" width="3" height="9" rx="1" fill="currentColor" />
            <rect x="7" y="1.5" width="3" height="9" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3 1.5 L10 6 L3 10.5 Z" fill="currentColor" />
          </svg>
        )}
      </button>
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
