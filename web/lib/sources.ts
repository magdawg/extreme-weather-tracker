export type SourceId =
  | "gdacs"
  | "firms"
  | "open-meteo"
  | "noaa-crw"
  | "noaa-oisst"
  | "open-meteo-marine"
  | "copernicus-marine"
  | "gbif"
  | "gfw"
  | "openaq";

export interface SourceMeta {
  label: string;
  description: string;
  mark: string; // single-letter monogram shown next to the label
  url: string; // provider homepage, linked from the event detail card
}

export const SOURCES: Record<SourceId, SourceMeta> = {
  gdacs: {
    label: "GDACS",
    description: "Global Disaster Alert — storms, floods, drought",
    mark: "G",
    url: "https://www.gdacs.org",
  },
  firms: {
    label: "NASA FIRMS",
    description: "Satellite wildfire detections",
    mark: "F",
    url: "https://firms.modaps.eosdis.nasa.gov",
  },
  "open-meteo": {
    label: "Open-Meteo",
    description: "Daily temperature extremes (heat)",
    mark: "M",
    url: "https://open-meteo.com",
  },
  "noaa-crw": {
    label: "NOAA Coral Reef Watch",
    description: "Satellite coral bleaching alert areas",
    mark: "C",
    url: "https://coralreefwatch.noaa.gov",
  },
  "noaa-oisst": {
    label: "NOAA OISST",
    description: "Marine heatwaves from satellite SST anomaly",
    mark: "O",
    url: "https://psl.noaa.gov/marine-heatwaves/",
  },
  "open-meteo-marine": {
    label: "Open-Meteo Marine",
    description: "Significant wave height — extreme swells",
    mark: "S",
    url: "https://open-meteo.com/en/docs/marine-weather-api",
  },
  "copernicus-marine": {
    label: "Copernicus Marine",
    description: "Global wave forecast (CMEMS) — upgrade path for swells",
    mark: "K",
    url: "https://data.marine.copernicus.eu",
  },
  gbif: {
    label: "GBIF",
    description: "Biodiversity occurrences — clustered mortality signal",
    mark: "B",
    url: "https://www.gbif.org",
  },
  gfw: {
    label: "Global Forest Watch",
    description: "Integrated deforestation alerts (GLAD-L/S2, RADD, DIST-ALERT)",
    mark: "D",
    url: "https://www.globalforestwatch.org",
  },
  openaq: {
    label: "OpenAQ",
    description: "Hazardous-tier PM2.5 from ground stations",
    mark: "Q",
    url: "https://openaq.org",
  },
};

// Mirrors HAZARD_ORDER's gating in lib/hazards.ts — any source not listed
// here is hidden from the source filter UI and excluded from the default
// active set. SOURCES map above stays complete so EventDetails / MapView
// can still render any event that does come through. See SPIKE_SOURCES.md.
export const SOURCE_ORDER: SourceId[] = [
  "gdacs",
  "firms",
  "open-meteo",
  "noaa-crw",
  // Hidden until backfilled + reviewed:
  // "noaa-oisst",
  // "open-meteo-marine",
  // "copernicus-marine",
  // "gbif",
  // "gfw",
  // "openaq",
];

export function isKnownSource(s: string): s is SourceId {
  return s in SOURCES;
}
