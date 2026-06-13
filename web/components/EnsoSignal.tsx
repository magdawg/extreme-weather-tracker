"use client";

import { InfoIcon } from "@/components/icons";
import { FOCUS } from "@/lib/ui";
import { HAZARDS } from "@/lib/hazards";
import type { EnsoSignalResult, HazardSignal } from "@/lib/enso";

// The diverging bars are scaled so a ±100% shift fills half the track; bigger
// shifts saturate the bar but the exact figure still shows as text.
const BAR_MAX = 1;

function pct(rel: number): string {
  if (Number.isNaN(rel)) return "—";
  const v = Math.round(Math.abs(rel) * 100);
  return `${rel >= 0 ? "+" : "−"}${v}%`;
}

function Row({ s }: { s: HazardSignal }) {
  const meta = HAZARDS[s.hazard];
  const has = !Number.isNaN(s.relative);
  // Bar width as a fraction of the half-track (centre → edge), clamped.
  const mag = has ? Math.min(1, Math.abs(s.relative) / BAR_MAX) : 0;
  const up = has && s.relative >= 0;
  // More-during-El-Niño reads warm (rose), less reads cool (sky) — matching the
  // trend arrow on the ENSO card.
  const fill = up ? "#fb7185" : "#38bdf8";

  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="w-[5.25rem] shrink-0 truncate text-xs text-white/75">
        {meta.label}
      </span>
      <div className="relative h-2 flex-1 rounded-full bg-white/[0.06]">
        {/* Centre tick (the baseline share). */}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/20" />
        {has && mag > 0 && (
          <div
            className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
            style={{
              width: `${mag * 50}%`,
              [up ? "left" : "right"]: "50%",
              backgroundColor: fill,
            }}
          />
        )}
      </div>
      <span
        className={`w-10 shrink-0 text-right text-[11px] tabular-nums ${
          has ? (up ? "text-rose-300" : "text-sky-300") : "text-white/30"
        }`}
      >
        {pct(s.relative)}
      </span>
    </div>
  );
}

/**
 * The "El Niño signal": how each hazard's share of events shifts during El Niño
 * months versus the full record. Correlational, derived entirely from the
 * events already loaded — see {@link ensoHazardSignal}.
 */
export default function EnsoSignal({
  data,
  onShowInfo,
}: {
  data: EnsoSignalResult;
  onShowInfo?: () => void;
}) {
  if (!data.ready) {
    return (
      <p className="text-xs leading-relaxed text-white/45">
        Not enough overlap between events and El Niño periods yet to read a
        signal — it appears once the record covers more of the warm phase.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-2.5 text-[11px] leading-relaxed text-white/55">
        How each hazard&apos;s share of events shifts in{" "}
        <span className="text-rose-300">El Niño</span> months vs its usual share
        across the whole record.{" "}
        <span className="text-rose-300">+11%</span> = an 11% bigger slice of the
        mix than normal (not 11% more events);{" "}
        <span className="text-sky-300">−</span> = a smaller slice.
      </p>

      <div className="space-y-0.5">
        {data.signals.map((s) => (
          <Row key={s.hazard} s={s} />
        ))}
      </div>

      <div className="mt-2.5 flex items-start justify-between gap-2">
        <p className="text-[10px] leading-snug text-white/35">
          Correlational, not a forecast · {data.elNinoEvents.toLocaleString()}{" "}
          events across {data.elNinoMonths} El Niño months since 2021
        </p>
        {onShowInfo && (
          <button
            type="button"
            onClick={onShowInfo}
            aria-label="How is the El Niño signal computed?"
            className={`-mr-0.5 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/80 ${FOCUS}`}
          >
            <InfoIcon size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
