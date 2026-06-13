// El Niño teleconnections — the regions whose weather *typically* shifts during
// an El Niño winter. This is reference/forecast context, NOT observed events:
// it deliberately lives outside the Event contract (a hand-authored static
// overlay), shown alongside the live hazard dots so users can compare the
// *expected* pattern against what's *actually* happening on the map.
//
// The zones are deliberately coarse rectangles — they represent broad regional
// tendencies from the climatological record (NOAA CPC / IRI composites), not
// precise meteorological contours. Each zone carries one headline impact.

export type TeleImpact = "wet" | "dry" | "hot" | "stormy" | "calm";

export interface TeleImpactMeta {
  label: string;
  hex: string;
  rgb: [number, number, number];
}

// Distinct overlay hues; rendered as translucent fills so they read as zones
// rather than competing with the hazard dots.
export const TELE_IMPACTS: Record<TeleImpact, TeleImpactMeta> = {
  wet: { label: "Wetter / flood-prone", hex: "#3b82f6", rgb: [59, 130, 246] },
  dry: { label: "Drier / drought & fire", hex: "#f59e0b", rgb: [245, 158, 11] },
  hot: { label: "Warmer than usual", hex: "#ef4444", rgb: [239, 68, 68] },
  stormy: { label: "More tropical cyclones", hex: "#8b5cf6", rgb: [139, 92, 246] },
  calm: { label: "Fewer tropical cyclones", hex: "#14b8a6", rgb: [20, 184, 166] },
};

export const TELE_IMPACT_ORDER: TeleImpact[] = [
  "wet",
  "dry",
  "hot",
  "stormy",
  "calm",
];

export interface TeleProps {
  name: string;
  impact: TeleImpact;
  note: string;
}

export interface TeleFeature {
  type: "Feature";
  properties: TeleProps;
  geometry: { type: "Polygon"; coordinates: number[][][] };
}

// A west/south/east/north box as a closed polygon ring. None of these regions
// cross the antimeridian, so a simple rectangle is safe.
function box(w: number, s: number, e: number, n: number): number[][][] {
  return [
    [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ],
  ];
}

function zone(
  name: string,
  impact: TeleImpact,
  note: string,
  w: number,
  s: number,
  e: number,
  n: number,
): TeleFeature {
  return {
    type: "Feature",
    properties: { name, impact, note },
    geometry: { type: "Polygon", coordinates: box(w, s, e, n) },
  };
}

export const TELECONNECTIONS: {
  type: "FeatureCollection";
  features: TeleFeature[];
} = {
  type: "FeatureCollection",
  features: [
    // — Wetter —
    zone(
      "US Gulf Coast & Southeast",
      "wet",
      "Wetter, stormier winters across the US South.",
      -100, 25, -78, 35,
    ),
    zone(
      "California & US Southwest",
      "wet",
      "Wetter — more atmospheric-river storms and flooding.",
      -122, 31, -107, 38,
    ),
    zone(
      "Coastal Peru & Ecuador",
      "wet",
      "Heavy rain and flooding along the west coast of South America.",
      -82, -12, -75, 2,
    ),
    zone(
      "Southeastern South America",
      "wet",
      "Wetter across N. Argentina, Uruguay and southern Brazil.",
      -64, -38, -47, -24,
    ),
    zone(
      "Horn of Africa",
      "wet",
      "Enhanced 'short rains' across East Africa.",
      35, -5, 51, 12,
    ),

    // — Drier —
    zone(
      "Indonesia & Maritime Continent",
      "dry",
      "Drier — drought and haze risk.",
      95, -10, 141, 7,
    ),
    zone(
      "Northern Australia",
      "dry",
      "Drier and hotter — elevated bushfire risk.",
      120, -25, 150, -11,
    ),
    zone(
      "Amazon & northern South America",
      "dry",
      "Drier — drought and fire risk in the Amazon.",
      -70, -8, -50, 5,
    ),
    zone(
      "Southern Africa",
      "dry",
      "Drier — drought risk across the region.",
      20, -30, 35, -16,
    ),
    zone(
      "India & South Asia",
      "dry",
      "Tends to weaken the summer monsoon — drier.",
      72, 10, 88, 27,
    ),
    zone(
      "Pacific Northwest & northern US",
      "dry",
      "Drier and milder winters from the NW across the northern Rockies, Plains and Midwest.",
      -125, 42, -83, 49,
    ),

    // — Warmer —
    zone(
      "Alaska & western Canada",
      "hot",
      "Milder, warmer-than-average winters.",
      -160, 55, -100, 68,
    ),

    // — More tropical cyclones —
    zone(
      "Central & eastern tropical Pacific",
      "stormy",
      "More hurricanes and typhoons in the central/eastern Pacific.",
      -160, 5, -100, 22,
    ),

    // — Fewer tropical cyclones —
    zone(
      "North Atlantic & Caribbean",
      "calm",
      "Fewer Atlantic hurricanes — stronger wind shear suppresses them.",
      -84, 10, -40, 30,
    ),
  ],
};
