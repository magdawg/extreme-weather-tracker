"use client";

import { ICON_BTN, FOCUS } from "@/lib/ui";
import { PlayIcon, PauseIcon } from "@/components/icons";

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
  // Percentage of the range covered, used to paint the filled portion of the
  // rail behind the thumb.
  const pct =
    maxMs > minMs
      ? Math.min(100, Math.max(0, ((valueMs - minMs) / (maxMs - minMs)) * 100))
      : 0;

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onTogglePlay}
        aria-label={playing ? "Pause playback" : "Play forward in time"}
        aria-pressed={playing}
        title={playing ? "Pause" : "Play forward in time"}
        className={`h-9 w-9 ${ICON_BTN} ${
          playing
            ? "border-indigo-400/40 bg-indigo-500/25 text-indigo-100 hover:bg-indigo-500/35"
            : ""
        }`}
      >
        {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
      </button>

      <span className="w-[4.5rem] shrink-0 text-xs tabular-nums text-white/45">
        {fmt(minMs)}
      </span>

      <input
        type="range"
        min={minMs}
        max={maxMs}
        step={DAY_MS}
        value={valueMs}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Show events up to date"
        className={`ewt-range flex-1 ${FOCUS}`}
        style={{
          background: `linear-gradient(to right, #6366f1 ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
        }}
      />

      <span
        className={`w-[4.5rem] shrink-0 text-right text-xs tabular-nums ${
          atNow ? "font-semibold text-indigo-200" : "text-white/80"
        }`}
      >
        {atNow ? "Now" : fmt(valueMs)}
      </span>
    </div>
  );
}
