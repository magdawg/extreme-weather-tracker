export type HazardType =
  | "storm"
  | "flood"
  | "wildfire"
  | "heat"
  | "drought";

export interface EventProperties {
  id: number;
  source: string;
  hazard_type: HazardType;
  title: string | null;
  severity_raw: string | null;
  intensity_norm: number | null;
  started_at: string | null;
  ended_at: string | null;
  country: string | null;
  url: string | null;
  metadata: Record<string, unknown>;
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
