export type HazardType =
  | "storm"
  | "flood"
  | "wildfire"
  | "heat"
  | "drought";

export interface EventProperties {
  source: string;
  hazard_type: HazardType;
  title: string | null;
  severity_raw: string | null;
  intensity_norm: number | null;
  started_at: string | null;
  country: string | null;
}

export interface EventFeature {
  type: "Feature";
  geometry: { type: string; coordinates: number[] | number[][] | number[][][] };
  properties: EventProperties;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: EventFeature[];
}

export interface HazardStat {
  hazard_type: HazardType;
  count: number;
  mean_intensity: number | null;
  latest: string | null;
}

/** One Oceanic Niño Index reading: a season placed at its centre month. */
export interface OniPoint {
  date: string; // ISO date of the season's centre month (first of month)
  anom: number; // ONI anomaly, °C
}

/** One monthly Niño-3.4 SST anomaly reading. */
export interface Nino34Point {
  date: string; // ISO date, first of the calendar month
  anom: number; // monthly SST anomaly, °C (1991–2020 base)
}

/**
 * The fresher, supplementary monthly Niño-3.4 anomaly served alongside the ONI.
 * A single-month value with no 3-month centring lag — the most current read on
 * the Pacific — but on a different base period, so it is *not* an ONI value and
 * never classifies the phase. `series` is a short recent tail, not full history.
 */
export interface EnsoMonthly {
  current: { year: number; month: number; date: string; anom: number } | null;
  series: Nino34Point[];
}

/** ENSO state from GET /enso — a global index, not a located event. */
export interface EnsoData {
  current: {
    season: string;
    year: number;
    date: string;
    anom: number;
    phase: "el-nino" | "la-nina" | "neutral";
  } | null;
  series: OniPoint[];
  monthly?: EnsoMonthly | null;
}
