"use client";

import { ICON_BTN, FOCUS } from "@/lib/ui";
import { PlayIcon, PauseIcon, InfoIcon } from "@/components/icons";
import { ENSO_PHASES, ONI_MAX, phaseOf } from "@/lib/enso";
import type { OniPoint } from "@/lib/types";

const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;

function fmt(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * ENSO mini-chart rendered directly behind the time rail: one bar per ONI
 * season, positioned at its date. El Niño anomalies rise above the centre line
 * in red, La Niña falls below in blue — so scrubbing the timeline visually
 * correlates event bursts with the ENSO phase that drove them.
 */
function EnsoBand({
  oni,
  minMs,
  maxMs,
}: {
  oni: OniPoint[];
  minMs: number;
  maxMs: number;
}) {
  const span = maxMs - minMs;
  if (span <= 0) return null;
  // One month as a fraction of the rail, widened slightly so adjacent bars
  // touch instead of leaving sub-pixel gaps.
  const widthPct = Math.max(0.6, (MONTH_MS / span) * 100 * 1.1);

  return (
    <div className="relative h-3.5 w-full overflow-hidden rounded-sm">
      {/* Centre line (neutral / zero anomaly). */}
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/15" />
      {oni.map((p, i) => {
        const t = Date.parse(p.date);
        if (Number.isNaN(t) || t < minMs || t > maxMs) return null;
        const leftPct = ((t - minMs) / span) * 100;
        const phase = phaseOf(p.anom);
        const mag = Math.min(1, Math.abs(p.anom) / ONI_MAX);
        const hPct = mag * 50; // half the band height at most
        const positive = p.anom >= 0;
        return (
          <div
            key={i}
            className="absolute"
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              height: `${hPct}%`,
              [positive ? "bottom" : "top"]: "50%",
              backgroundColor: ENSO_PHASES[phase].hex,
              opacity: phase === "neutral" ? 0.35 : 0.75,
            }}
          />
        );
      })}
    </div>
  );
}

export default function TimeSlider({
  minMs,
  maxMs,
  valueMs,
  onChange,
  playing,
  onTogglePlay,
  oni,
  onShowEnsoInfo,
}: {
  minMs: number;
  maxMs: number;
  valueMs: number;
  onChange: (ms: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  oni?: OniPoint[];
  onShowEnsoInfo?: () => void;
}) {
  const atNow = valueMs >= maxMs;
  // Percentage of the range covered, used to paint the filled portion of the
  // rail behind the thumb.
  const pct =
    maxMs > minMs
      ? Math.min(100, Math.max(0, ((valueMs - minMs) / (maxMs - minMs)) * 100))
      : 0;

  const hasBand = !!oni && oni.length > 0;

  return (
    <div className="flex flex-col gap-1.5">
      {hasBand && (
        // Spacer widths mirror the controls row below (play button + the two
        // date labels) so the band column lines up exactly with the range
        // input's flex-1 column.
        <div className="flex items-end gap-2 sm:gap-3">
          <span className="w-9 shrink-0" aria-hidden="true" />
          <span className="w-[4.5rem] shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {/* Label + legend so the sparkline isn't a mystery shape: this is
                the El Niño / La Niña index over the same dates as the slider. */}
            <div className="mb-1 flex items-center gap-x-2.5 gap-y-0.5 text-[10px] leading-none text-white/45">
              <span
                className="font-medium uppercase tracking-wide text-white/55"
                title="El Niño–Southern Oscillation — NOAA Oceanic Niño Index"
              >
                ENSO
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: ENSO_PHASES["el-nino"].hex }}
                />
                El Niño
              </span>
              <span className="flex items-center gap-1">
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: ENSO_PHASES["la-nina"].hex }}
                />
                La Niña
              </span>
              {onShowEnsoInfo && (
                <button
                  type="button"
                  onClick={onShowEnsoInfo}
                  aria-label="What is ENSO / the El Niño index?"
                  className={`ml-0.5 inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/80 ${FOCUS}`}
                >
                  <InfoIcon size={12} />
                </button>
              )}
            </div>
            <EnsoBand oni={oni!} minMs={minMs} maxMs={maxMs} />
          </div>
          <span className="w-[4.5rem] shrink-0" aria-hidden="true" />
        </div>
      )}

      <div className="flex items-center gap-2 sm:gap-3">
        <button
          onClick={onTogglePlay}
          aria-label={playing ? "Pause playback" : "Play forward in time"}
          aria-pressed={playing}
          title={playing ? "Pause" : "Play forward in time"}
          className={`h-9 w-9 shrink-0 ${ICON_BTN} ${
            playing
              ? "border-indigo-400/40 bg-indigo-500/25 text-indigo-100 hover:bg-indigo-500/35"
              : ""
          }`}
        >
          {playing ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
        </button>

        <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-[11px] tabular-nums leading-tight text-white/45 sm:text-xs">
          {fmt(minMs)}
        </span>

        {/* min-w-0 lets the range input shrink below its intrinsic width inside
            the flex row — without it the row overflows and the right-hand date
            label is pushed off-screen on narrow viewports. */}
        <input
          type="range"
          min={minMs}
          max={maxMs}
          step={DAY_MS}
          value={valueMs}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Show events up to date"
          className={`ewt-range min-w-0 flex-1 ${FOCUS}`}
          style={{
            background: `linear-gradient(to right, #6366f1 ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
          }}
        />

        <span
          className={`w-[4.5rem] shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums leading-tight sm:text-xs ${
            atNow ? "font-semibold text-indigo-200" : "text-white/80"
          }`}
        >
          {atNow ? "Now" : fmt(valueMs)}
        </span>
      </div>
    </div>
  );
}
