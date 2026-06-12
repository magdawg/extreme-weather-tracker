export type SourceId = "gdacs" | "firms" | "open-meteo";

export interface SourceMeta {
  label: string;
  description: string;
  mark: string; // single-letter monogram shown next to the label
}

export const SOURCES: Record<SourceId, SourceMeta> = {
  gdacs: {
    label: "GDACS",
    description: "Global Disaster Alert — storms, floods, drought",
    mark: "G",
  },
  firms: {
    label: "NASA FIRMS",
    description: "Satellite wildfire detections",
    mark: "F",
  },
  "open-meteo": {
    label: "Open-Meteo",
    description: "Daily temperature extremes (heat)",
    mark: "M",
  },
};

export const SOURCE_ORDER: SourceId[] = ["gdacs", "firms", "open-meteo"];

export function isKnownSource(s: string): s is SourceId {
  return s in SOURCES;
}
