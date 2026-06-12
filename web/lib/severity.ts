import type { EventFeature, EventProperties } from "./types";

// Unified severity tiers. GDACS hands us an authoritative alert colour
// (severity_raw = Green/Orange/Red), which maps 1:1 to the score bands on the
// 0–3 GDACS scale: Green 0–1, Orange 1–2, Red 2–3. We trust that colour
// directly. Sources without a colour (FIRMS wildfires, Open-Meteo heat,
// whose severity_raw is free text like "FRP 42 MW") fall back to bucketing the
// normalized intensity by thirds — the same band boundaries, expressed as 0..1.
export type Severity = "minor" | "moderate" | "severe";

export interface SeverityMeta {
  label: string;
  hex: string;
}

export const SEVERITIES: Record<Severity, SeverityMeta> = {
  minor: { label: "Minor", hex: "#22c55e" }, // GDACS Green
  moderate: { label: "Moderate", hex: "#f59e0b" }, // GDACS Orange
  severe: { label: "Severe", hex: "#ef4444" }, // GDACS Red
};

export const SEVERITY_ORDER: Severity[] = ["minor", "moderate", "severe"];

const COLOR_TIER: Record<string, Severity> = {
  green: "minor",
  orange: "moderate",
  red: "severe",
};

const LOWER = 1 / 3; // score 1 of 3
const UPPER = 2 / 3; // score 2 of 3

/**
 * Severity tier for an event. Prefers the source's own alert colour
 * (GDACS); otherwise buckets intensity_norm by thirds. Null intensity → minor.
 */
export function tierOf(props: EventProperties): Severity {
  const raw = props.severity_raw?.trim().toLowerCase();
  if (raw && raw in COLOR_TIER) return COLOR_TIER[raw];

  const i = props.intensity_norm;
  if (i === null || i < LOWER) return "minor";
  if (i < UPPER) return "moderate";
  return "severe";
}

export function matchesSeverity(
  f: EventFeature,
  active: Set<Severity>,
): boolean {
  return active.has(tierOf(f.properties));
}
