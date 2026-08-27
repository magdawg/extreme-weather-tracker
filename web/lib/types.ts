export type HazardType =
  | "storm"
  | "flood"
  | "wildfire"
  | "heat"
  | "drought"
  | "coral_bleach"
  | "marine_heat"
  | "swell"
  | "mortality"
  | "deforestation"
  | "air_quality";

/**
 * Donation / help links surfaced when a post-ingestion resolver matched this
 * event to an external campaign or response page. The property is OMITTED
 * when no resolver hit — so checking `props.donations` truthiness is enough
 * to know whether to render the Help section in EventDetails.
 *
 * `ifrc_*` comes from IFRC GO (Red Cross emergency portal). The page is an
 * authoritative "response is underway" record, NOT a consumer donate flow.
 * `gg_*` comes from GlobalGiving and IS a real donate page. See
 * SPIKE_DONATIONS.md for the matching strategy and coverage caveats.
 */
export interface EventDonations {
  ifrc_url?: string | null;
  ifrc_appeal_requested?: number | null;
  ifrc_appeal_funded?: number | null;
  gg_url?: string | null;
  gg_title?: string | null;
  gg_org?: string | null;
}

export interface EventProperties {
  source: string;
  hazard_type: HazardType;
  title: string | null;
  severity_raw: string | null;
  intensity_norm: number | null;
  started_at: string | null;
  country: string | null;
  // Per-event "more info" link from the provider (currently only GDACS).
  // Falls back to the provider's homepage in the UI when null.
  url: string | null;
  // Present only when at least one donation resolver found a match — usually
  // absent. See EventDonations for the field semantics.
  donations?: EventDonations | null;
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
