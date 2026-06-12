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
};

export const HAZARD_ORDER: HazardType[] = [
  "storm",
  "flood",
  "wildfire",
  "heat",
  "drought",
];
