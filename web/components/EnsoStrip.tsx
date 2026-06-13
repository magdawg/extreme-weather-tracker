"use client";

import { useState } from "react";

import { ChevronDownIcon, InfoIcon } from "@/components/icons";
import EnsoSignal from "@/components/EnsoSignal";
import Tooltip from "@/components/Tooltip";
import { PANEL, FOCUS } from "@/lib/ui";
import {
  ENSO_PHASES,
  EL_NINO_THRESHOLD,
  LA_NINA_THRESHOLD,
  phaseOf,
  type EnsoPhase,
  type EnsoSignalResult,
} from "@/lib/enso";
import type { EnsoData } from "@/lib/types";

// Signed value, e.g. "+0.48" / "-1.20".
function signed(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Centre month (1-based) of each overlapping 3-month ONI season — matches the
// ENSO_SEASONS order in api/index.py. A season spans centre−1, centre, centre+1.
const SEASON_CENTRE: Record<string, number> = {
  DJF: 1, JFM: 2, FMA: 3, MAM: 4, AMJ: 5, MJJ: 6,
  JJA: 7, JAS: 8, ASO: 9, SON: 10, OND: 11, NDJ: 12,
};

// Turn a season code into the human period it covers, e.g. MAM 2026 →
// "Mar–Apr–May 2026". The ONI is a 3-month mean, so "as of" a single calendar
// day is misleading — this names the actual averaging window instead.
function seasonPeriod(season: string, year: number): string {
  const c = SEASON_CENTRE[season];
  if (!c) return `${year}`;
  const m = [(c + 10) % 12, (c + 11) % 12, c % 12];
  return `${MONTHS[m[0]]}–${MONTHS[m[1]]}–${MONTHS[m[2]]} ${year}`;
}

/**
 * Headline phase. Beyond the three formal phases, when the index is neutral but
 * trending toward a threshold we surface a "Watch" — that's the whole point of
 * the project right now: catching the El Niño *before* it crosses +0.5.
 */
function headline(
  anom: number,
  delta: number,
): { label: string; accent: EnsoPhase } {
  const phase = phaseOf(anom);
  if (phase !== "neutral") return { label: ENSO_PHASES[phase].label, accent: phase };
  if (anom >= 0 && delta > 0) return { label: "El Niño Watch", accent: "el-nino" };
  if (anom <= 0 && delta < 0) return { label: "La Niña Watch", accent: "la-nina" };
  return { label: "Neutral", accent: "neutral" };
}

export default function EnsoStrip({
  enso,
  signal,
  onShowInfo,
  onShowSignalInfo,
  onShowMonthlyInfo,
  onHoverNino34,
}: {
  enso: EnsoData | null;
  signal?: EnsoSignalResult | null;
  onShowInfo?: () => void;
  onShowSignalInfo?: () => void;
  onShowMonthlyInfo?: () => void;
  onHoverNino34?: (hovering: boolean) => void;
}) {
  // The whole panel collapses to just the headline + ONI reading by default —
  // a glanceable badge that expands into the full breakdown on tap.
  const [panelOpen, setPanelOpen] = useState(false);
  // The El Niño signal is tucked away collapsed by default — it's secondary
  // context to the current-state headline above it.
  const [signalOpen, setSignalOpen] = useState(false);
  // Latest month is the secondary read. On a phone the card runs long, so it's
  // collapsed behind a tap there; on the roomier desktop layout it's always
  // shown (the `sm:` rules below ignore this state).
  const [monthlyOpen, setMonthlyOpen] = useState(false);

  const current = enso?.current;
  if (!current) return null;

  // The ONI value covers a 3-month season, not a single day — label it with the
  // period it averages (e.g. "Mar–Apr–May 2026") rather than today's date.
  const oniPeriod = seasonPeriod(current.season, current.year);

  const series = enso!.series;
  const prev = series.length >= 2 ? series[series.length - 2].anom : current.anom;
  const delta = current.anom - prev;
  const { label, accent } = headline(current.anom, delta);
  const meta = ENSO_PHASES[accent];

  // How far the index sits from the nearest ENSO threshold — the interpretive
  // line that turns a bare number into "almost an El Niño".
  let context: string;
  if (current.anom >= EL_NINO_THRESHOLD) {
    context = `${signed(current.anom - EL_NINO_THRESHOLD)} past the +0.5 El Niño threshold`;
  } else if (current.anom <= LA_NINA_THRESHOLD) {
    context = `${signed(current.anom - LA_NINA_THRESHOLD)} past the −0.5 La Niña threshold`;
  } else {
    const gap = EL_NINO_THRESHOLD - current.anom;
    context = `${gap.toFixed(2)} below the +0.5 El Niño threshold`;
  }

  const rising = delta > 0.005;
  const falling = delta < -0.005;

  // The fresher monthly Niño-3.4 anomaly (supplementary, not the ONI). Its trend
  // is vs the previous calendar month, and the sparkline shows the recent run.
  const monthly = enso!.monthly ?? null;
  const monthlyCur = monthly?.current ?? null;
  const mSeries = monthly?.series ?? [];
  const mPrev =
    mSeries.length >= 2 ? mSeries[mSeries.length - 2].anom : monthlyCur?.anom ?? 0;
  const mDelta = monthlyCur ? monthlyCur.anom - mPrev : 0;
  const mRising = mDelta > 0.005;
  const mFalling = mDelta < -0.005;
  const monthLabel = monthlyCur
    ? new Date(Date.UTC(monthlyCur.year, monthlyCur.month - 1, 1)).toLocaleDateString(
        undefined,
        { month: "long", year: "numeric" },
      )
    : "";

  return (
    <div
      className={`absolute right-4 top-4 z-10 px-3 py-2.5 sm:px-3.5 ${PANEL} ${
        panelOpen && signalOpen ? "w-72 max-w-[calc(100vw-2rem)]" : "w-44 sm:w-52"
      }`}
    >
      <button
        type="button"
        onClick={() => setPanelOpen((v) => !v)}
        aria-expanded={panelOpen}
        aria-label={panelOpen ? "Collapse ENSO panel" : "Expand ENSO panel"}
        className={`-mx-1 block w-[calc(100%+0.5rem)] cursor-pointer rounded-md px-1 py-0.5 text-left transition hover:bg-white/5 ${FOCUS}`}
      >
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: meta.hex, boxShadow: `0 0 8px ${meta.hex}` }}
            aria-hidden="true"
          />
          <span className="text-[11px] font-medium uppercase tracking-wide text-white/45">
            ENSO
          </span>
          <span
            className="ml-auto text-xs font-semibold"
            style={{ color: meta.hex }}
          >
            {label}
          </span>
          <ChevronDownIcon
            size={14}
            className={`text-white/40 transition-transform ${panelOpen ? "" : "-rotate-90"}`}
          />
        </div>

        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums leading-none text-white">
            {signed(current.anom)}
          </span>
          <Tooltip
            side="bottom"
            align="right"
            label="Oceanic Niño Index — a 3-month average of sea-surface temperature in the highlighted Pacific region."
          >
            <span
              className="cursor-help border-b border-dotted border-white/30 text-[11px] text-white/45"
              onMouseEnter={() => onHoverNino34?.(true)}
              onMouseLeave={() => onHoverNino34?.(false)}
            >
              ONI °C
            </span>
          </Tooltip>
          {(rising || falling) && (
            <Tooltip
              side="bottom"
              align="right"
              className="ml-auto"
              label={`${signed(delta)} °C change in comparison to the previous 3-month season`}
            >
              <span
                className={`flex items-center gap-0.5 text-[11px] tabular-nums ${
                  rising ? "text-rose-300" : "text-sky-300"
                }`}
              >
                <ChevronDownIcon
                  size={12}
                  className={rising ? "rotate-180" : ""}
                />
                {signed(delta)}
              </span>
            </Tooltip>
          )}
        </div>
      </button>

      {panelOpen && (
        <>
          <p className="mt-1.5 text-[11px] leading-snug text-white/55">{context}</p>

          <div className="mt-1 flex items-end justify-between gap-2">
            <p className="text-[10px] leading-tight text-white/35">
              {oniPeriod} season
            </p>
            {onShowInfo && (
              <button
                type="button"
                onClick={onShowInfo}
                aria-label="What is ENSO / the El Niño index?"
                className={`-mb-0.5 -mr-0.5 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/80 ${FOCUS}`}
              >
                <InfoIcon size={13} />
              </button>
            )}
          </div>
        </>
      )}

      {panelOpen && monthlyCur && (
        <>
          <div className="my-2.5 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => setMonthlyOpen((v) => !v)}
            aria-expanded={monthlyOpen}
            className={`-mx-1 flex w-[calc(100%+0.5rem)] items-center justify-between rounded-md px-1 py-0.5 text-left transition hover:bg-white/5 sm:pointer-events-none sm:hover:bg-transparent ${FOCUS}`}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wider text-white/55">
              Latest month
            </span>
            <ChevronDownIcon
              size={14}
              className={`text-white/40 transition-transform sm:hidden ${
                monthlyOpen ? "" : "-rotate-90"
              }`}
            />
          </button>
          <div className={`${monthlyOpen ? "" : "hidden"} sm:block`}>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-lg font-semibold tabular-nums leading-none text-white/90">
                {signed(monthlyCur.anom)}
              </span>
            <Tooltip
              side="bottom"
              align="right"
              label="The latest single month of sea-surface temperature in the highlighted Pacific region."
            >
              <span
                className="cursor-help border-b border-dotted border-white/30 text-[11px] text-white/45"
                onMouseEnter={() => onHoverNino34?.(true)}
                onMouseLeave={() => onHoverNino34?.(false)}
              >
                Niño-3.4 °C
              </span>
            </Tooltip>
            {(mRising || mFalling) && (
              <Tooltip
                side="bottom"
                align="right"
                className="ml-auto"
                label={`${signed(mDelta)} °C change in comparison to the previous month`}
              >
                <span
                  className={`flex items-center gap-0.5 text-[11px] tabular-nums ${
                    mRising ? "text-rose-300" : "text-sky-300"
                  }`}
                >
                  <ChevronDownIcon size={12} className={mRising ? "rotate-180" : ""} />
                  {signed(mDelta)}
                </span>
              </Tooltip>
            )}
          </div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <p className="text-[10px] leading-snug text-white/35">
              {monthLabel} · single-month SST anomaly, fresher than the ONI
            </p>
            {onShowMonthlyInfo && (
              <button
                type="button"
                onClick={onShowMonthlyInfo}
                aria-label="How does the monthly Niño-3.4 anomaly differ from the ONI?"
                className={`-mb-0.5 -mr-0.5 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white/80 ${FOCUS}`}
              >
                <InfoIcon size={13} />
              </button>
            )}
            </div>
          </div>
        </>
      )}

      {panelOpen && signal && (
        <>
          <div className="my-2.5 h-px bg-white/10" />
          <button
            type="button"
            onClick={() => setSignalOpen((v) => !v)}
            aria-expanded={signalOpen}
            className={`-mx-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center justify-between rounded-md px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-white/55 transition hover:text-white/90 ${FOCUS}`}
          >
            <span>El Niño signal</span>
            <ChevronDownIcon
              size={14}
              className={`text-white/40 transition-transform ${signalOpen ? "" : "-rotate-90"}`}
            />
          </button>
          {signalOpen && (
            <div className="mt-2">
              <EnsoSignal data={signal} onShowInfo={onShowSignalInfo} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
