// ENSO (El Niño–Southern Oscillation) phase taxonomy — the same role hazards.ts
// plays for hazards. ENSO is a single global climate index (the Oceanic Niño
// Index), so it has three phases rather than located hazard types.

import { HAZARD_ORDER } from "./hazards";
import type { HazardType, OniPoint } from "./types";

export type EnsoPhase = "el-nino" | "la-nina" | "neutral";

export interface EnsoPhaseMeta {
  label: string;
  hex: string;
  rgb: [number, number, number];
}

// Warm reds for El Niño, cool blues for La Niña, slate for neutral — so the
// slider band reads like a temperature anomaly at a glance.
export const ENSO_PHASES: Record<EnsoPhase, EnsoPhaseMeta> = {
  "el-nino": { label: "El Niño", hex: "#ef4444", rgb: [239, 68, 68] },
  "la-nina": { label: "La Niña", hex: "#3b82f6", rgb: [59, 130, 246] },
  neutral: { label: "Neutral", hex: "#94a3b8", rgb: [148, 163, 184] },
};

// El Niño ≥ +0.5, La Niña ≤ −0.5 (°C ONI). Mirrored in ingestion/enso.py and
// api/index.py — keep all three in sync.
export const EL_NINO_THRESHOLD = 0.5;
export const LA_NINA_THRESHOLD = -0.5;

// The strongest events on record peaked near ±2.8 (the 2015-16 El Niño hit
// +2.75), so this caps the band/bar height for the anomaly magnitude without
// clipping the historical extremes.
export const ONI_MAX = 2.8;

export function phaseOf(anom: number): EnsoPhase {
  if (anom >= EL_NINO_THRESHOLD) return "el-nino";
  if (anom <= LA_NINA_THRESHOLD) return "la-nina";
  return "neutral";
}

// --- El Niño signal --------------------------------------------------------
//
// How does the *mix* of hazards differ during El Niño months versus the whole
// record? We bucket every dated event by the ENSO phase of its month, then
// compare each hazard's share of El Niño-month events against its share across
// all months. Share-of-mix (rather than raw counts) is deliberate: the total
// event volume drifts over time as sources and backfills change, and shares
// cancel that out — the question is which hazards take a *bigger slice* when
// the Pacific runs warm, not whether there are more events overall.
//
// This is correlational, computed from the events already loaded in the
// browser — not a forecast, and only meaningful once enough events overlap the
// El Niño periods in the record (the readiness gate below).

export interface HazardSignal {
  hazard: HazardType;
  baseShare: number; // share of all dated events (0..1)
  elNinoShare: number; // share of El Niño-month events (0..1)
  relative: number; // elNinoShare / baseShare − 1; NaN if the hazard never occurs
  elNinoCount: number;
  baseCount: number;
}

export interface EnsoSignalResult {
  ready: boolean;
  signals: HazardSignal[]; // one per hazard, in HAZARD_ORDER
  elNinoEvents: number;
  otherEvents: number; // dated events in non-El-Niño months (the comparison base)
  elNinoMonths: number; // distinct calendar months in El Niño phase that have events
  totalMonths: number;
}

// Enough overlap to read anything into the comparison. Below these, the mix is
// dominated by noise, so we show a "not enough data yet" state instead.
const MIN_EL_NINO_EVENTS = 25;
const MIN_OTHER_EVENTS = 25;
const MIN_EL_NINO_MONTHS = 3;

type SignalEvent = {
  properties: { hazard_type: HazardType; started_at: string | null };
};

export function ensoHazardSignal(
  features: SignalEvent[],
  series: OniPoint[],
): EnsoSignalResult {
  // Month key ("YYYY-MM") → phase, from the ONI series. Each month has exactly
  // one centre-season reading, so a monthly lookup is unambiguous.
  const phaseByMonth = new Map<string, EnsoPhase>();
  for (const p of series) phaseByMonth.set(p.date.slice(0, 7), phaseOf(p.anom));

  const base = Object.fromEntries(HAZARD_ORDER.map((h) => [h, 0])) as Record<
    HazardType,
    number
  >;
  const elnino = Object.fromEntries(HAZARD_ORDER.map((h) => [h, 0])) as Record<
    HazardType,
    number
  >;
  const baseMonths = new Set<string>();
  const elNinoMonths = new Set<string>();

  for (const f of features) {
    const s = f.properties.started_at;
    if (!s) continue;
    const month = s.slice(0, 7);
    const phase = phaseByMonth.get(month);
    if (!phase) continue; // outside the published ONI record — skip from both sides
    const h = f.properties.hazard_type;
    base[h]++;
    baseMonths.add(month);
    if (phase === "el-nino") {
      elnino[h]++;
      elNinoMonths.add(month);
    }
  }

  const totalBase = HAZARD_ORDER.reduce((a, h) => a + base[h], 0);
  const totalElNino = HAZARD_ORDER.reduce((a, h) => a + elnino[h], 0);

  const signals: HazardSignal[] = HAZARD_ORDER.map((h) => {
    const baseShare = totalBase ? base[h] / totalBase : 0;
    const elNinoShare = totalElNino ? elnino[h] / totalElNino : 0;
    return {
      hazard: h,
      baseShare,
      elNinoShare,
      relative: baseShare > 0 ? elNinoShare / baseShare - 1 : NaN,
      elNinoCount: elnino[h],
      baseCount: base[h],
    };
  });

  return {
    ready:
      totalElNino >= MIN_EL_NINO_EVENTS &&
      totalBase - totalElNino >= MIN_OTHER_EVENTS &&
      elNinoMonths.size >= MIN_EL_NINO_MONTHS,
    signals,
    elNinoEvents: totalElNino,
    otherEvents: totalBase - totalElNino,
    elNinoMonths: elNinoMonths.size,
    totalMonths: baseMonths.size,
  };
}
