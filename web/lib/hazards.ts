import type { HazardType } from "./types";

export interface HazardMeta {
  label: string;
  hex: string;
  rgb: [number, number, number];
  emoji: string;
}

export const HAZARDS: Record<HazardType, HazardMeta> = {
  storm: { label: "Storms", hex: "#6366f1", rgb: [99, 102, 241], emoji: "🌀" },
  flood: { label: "Floods", hex: "#06b6d4", rgb: [6, 182, 212], emoji: "🌊" },
  wildfire: { label: "Wildfires", hex: "#f97316", rgb: [249, 115, 22], emoji: "🔥" },
  heat: { label: "Extreme heat", hex: "#ef4444", rgb: [239, 68, 68], emoji: "🌡️" },
  drought: { label: "Drought", hex: "#d97706", rgb: [217, 119, 6], emoji: "🏜️" },
  coral_bleach: { label: "Coral bleaching", hex: "#ec4899", rgb: [236, 72, 153], emoji: "🪸" },
  marine_heat: { label: "Marine heatwave", hex: "#f43f5e", rgb: [244, 63, 94], emoji: "🌡" },
  swell: { label: "Extreme swell", hex: "#0ea5e9", rgb: [14, 165, 233], emoji: "🌊" },
  mortality: { label: "Mass mortality", hex: "#7c3aed", rgb: [124, 58, 237], emoji: "💀" },
  deforestation: { label: "Deforestation", hex: "#65a30d", rgb: [101, 163, 13], emoji: "🌳" },
  air_quality: { label: "Hazardous air", hex: "#78716c", rgb: [120, 113, 108], emoji: "💨" },
};

// Drives the filter chips, legend, default active set, stats counter, and
// ENSO signal calc. Any hazard absent here is effectively hidden from the
// UI even though its color/label metadata above stays intact — so events of
// that hazard still render with correct styling IF something forces them
// through (none does today). To re-expose a spike source, just add it back
// to this array and to SOURCE_ORDER in lib/sources.ts.
export const HAZARD_ORDER: HazardType[] = [
  "storm",
  "flood",
  "wildfire",
  "heat",
  "drought",
  "coral_bleach",
  // Hidden until backfilled + reviewed — see SPIKE_SOURCES.md
  // "marine_heat",
  // "swell",
  // "mortality",
  // "deforestation",
  // "air_quality",
];
