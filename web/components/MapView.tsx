"use client";

import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer, GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import "maplibre-gl/dist/maplibre-gl.css";

import { HAZARDS } from "@/lib/hazards";
import { SEVERITIES, tierOf } from "@/lib/severity";
import { toLngLat } from "@/lib/api";
import { TELECONNECTIONS, TELE_IMPACTS } from "@/lib/teleconnections";
import type { TeleFeature } from "@/lib/teleconnections";
import type { EventFeature, EventProperties } from "@/lib/types";
import type { SelectedEvent } from "@/components/EventDetails";

// Free vector basemap, no API key required.
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";

// Friendly display names for the provenance the API hands us in `source`.
const SOURCE_LABELS: Record<string, string> = {
  gdacs: "GDACS",
  firms: "NASA FIRMS",
  "open-meteo": "Open-Meteo",
};

interface MapPoint {
  position: [number, number];
  radius: number;
  color: [number, number, number];
  intensity: number;
  props: EventProperties;
}

function toPoints(features: EventFeature[]): MapPoint[] {
  const pts: MapPoint[] = [];
  for (const f of features) {
    const ll = toLngLat(f.geometry);
    if (!ll) continue;
    const intensity = f.properties.intensity_norm ?? 0.3;
    const meta = HAZARDS[f.properties.hazard_type];
    pts.push({
      position: ll,
      radius: 4 + intensity * 16,
      color: meta ? meta.rgb : [200, 200, 200],
      intensity,
      props: f.properties,
    });
  }
  return pts;
}

// GDACS names are usually just "<hazard> in <countries>", which restates the
// hazard + country lines we already render. When the title adds nothing beyond
// that, drop it and lead with the hazard label instead.
function titleRestatesCountry(title: string | null | undefined, country: string | null | undefined) {
  if (!title || !country) return false;
  return title.toLowerCase().includes(country.toLowerCase());
}

// Inner SVG markup per hazard — mirrors the React glyphs in components/icons.tsx
// (24px grid, 1.75 stroke). The tooltip is injected as an HTML string, so the
// icons live here as strings rather than components. `color` drives both stroke
// and fill via currentColor.
const HAZARD_SVG: Record<string, string> = {
  storm: '<path d="M12 12c3 0 5-1.5 5-3.4S15 5 12 5.4"/><path d="M12 12c-3 0-5 1.5-5 3.4S9 19 12 18.6"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  flood: '<path d="M3 8c1.4 0 1.4 1.3 2.8 1.3S7.2 8 8.6 8s1.4 1.3 2.8 1.3S12.8 8 14.2 8s1.4 1.3 2.8 1.3S18.4 8 21 8"/><path d="M3 13c1.4 0 1.4 1.3 2.8 1.3S7.2 13 8.6 13s1.4 1.3 2.8 1.3S12.8 13 14.2 13s1.4 1.3 2.8 1.3S18.4 13 21 13"/><path d="M3 18c1.4 0 1.4 1.3 2.8 1.3S7.2 18 8.6 18s1.4 1.3 2.8 1.3S12.8 18 14.2 18s1.4 1.3 2.8 1.3S18.4 18 21 18"/>',
  wildfire: '<path d="M12 3c.9 2.6 2.6 3.5 3.8 5.2C16.9 9.7 17.5 11 17.5 12.6a5.5 5.5 0 0 1-11 0c0-1.1.3-2.2 1-3.1.5 1.1 1.4 1.6 2.2 1.6.9 0 1.3-1 1.3-2.1 0-2 .3-4 1-6Z"/>',
  heat: '<path d="M10 13.6V5.5a2 2 0 1 1 4 0v8.1a4 4 0 1 1-4 0Z"/><path d="M12 10.5v4.5"/>',
  drought: '<circle cx="12" cy="10" r="3.4"/><path d="M12 3v1.6M12 15.4V17M4.6 10h1.6M17.8 10h1.6M6.7 4.7l1.1 1.1M16.2 4.7l-1.1 1.1"/><path d="M4 20h3M9 20h3.5M15 20h5"/>',
};

function hazardSvg(hazard: string, color: string) {
  const inner = HAZARD_SVG[hazard] ?? "";
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" style="color:${color};flex:none">${inner}</svg>`;
}

// The tooltip is injected as raw HTML; event titles/countries originate
// upstream (GDACS), so escape them to avoid breaking the markup.
function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

// A teleconnection zone tooltip — the expected El Niño impact for the region,
// clearly flagged as the typical pattern rather than an observed event.
function teleTooltip(f: TeleFeature) {
  const imp = TELE_IMPACTS[f.properties.impact];
  return {
    html: `<div style="display:flex;align-items:center;gap:7px;font-weight:600;font-size:13px"><span style="width:10px;height:10px;border-radius:3px;background:${imp.hex};flex:none"></span><span>${esc(f.properties.name)}</span></div>
      <div style="margin-top:5px;font-size:12px;color:${imp.hex};opacity:.95">${esc(imp.label)}</div>
      <div style="margin-top:4px;font-size:11px;opacity:.7;max-width:230px;line-height:1.45">${esc(f.properties.note)}</div>
      <div style="margin-top:6px;font-size:10px;opacity:.45">Typical El Niño pattern · not an observed event</div>`,
  };
}

function getTooltip({ object }: { object?: MapPoint | TeleFeature }) {
  // Teleconnection zones are GeoJSON features (`.properties.impact`); events are
  // MapPoints (`.props`). Branch on shape so one handler serves both layers.
  if (object && "properties" in object && object.properties?.impact) {
    return teleTooltip(object);
  }
  if (!object || !("props" in object) || !object.props) return null;
  const p = object.props;
  const date = p.started_at
    ? new Date(p.started_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";
  const meta = HAZARDS[p.hazard_type];
  const label = esc(meta?.label ?? p.hazard_type);
  const sev = SEVERITIES[tierOf(p)];
  const source = esc(SOURCE_LABELS[p.source] ?? p.source);
  const icon = hazardSvg(p.hazard_type, meta?.hex ?? "#cbd5e1");

  // Severity shown as a color-coded pill (color isn't the only cue — the label
  // names the tier too).
  const badge = `<span style="display:inline-flex;align-items:center;padding:1px 7px;border-radius:9999px;font-size:11px;font-weight:600;line-height:1.4;color:${sev.hex};background:${sev.hex}22;border:1px solid ${sev.hex}55">${sev.label}</span>`;

  const showTitle = p.title && !titleRestatesCountry(p.title, p.country);
  const header = showTitle
    ? `<div style="display:flex;align-items:center;gap:7px;font-weight:600;font-size:13px">${icon}<span>${esc(p.title!)}</span></div>
       <div style="display:flex;align-items:center;gap:6px;margin-top:4px"><span style="font-size:12px;opacity:.65">${label}</span>${badge}</div>`
    : `<div style="display:flex;align-items:center;gap:7px"><span style="display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:13px">${icon}${label}</span>${badge}</div>`;

  return {
    html: `${header}
      ${p.country ? `<div style="margin-top:6px;font-size:12px;opacity:.85">${esc(p.country)}</div>` : ""}
      ${date ? `<div style="margin-top:2px;font-size:11px;opacity:.6;font-variant-numeric:tabular-nums">${date}</div>` : ""}
      ${source ? `<div style="margin-top:5px;font-size:11px;opacity:.5">Source: ${source}</div>` : ""}`,
  };
}

// Module-scope accessors keep their reference identity across renders so deck.gl
// doesn't flag attributes as "changed" on every effect run — which on the
// HeatmapLayer would otherwise force a full re-aggregation (recreating the
// transform-feedback shader and re-rendering the weight texture).
const getPointPosition = (d: MapPoint) => d.position;
const getPointRadius = (d: MapPoint) => d.radius;
const getPointFillColor = (d: MapPoint): [number, number, number, number] => [
  d.color[0],
  d.color[1],
  d.color[2],
  170,
];
const getPointLineColor = (d: MapPoint): [number, number, number, number] => [
  d.color[0],
  d.color[1],
  d.color[2],
  255,
];
const getPointWeight = (d: MapPoint) => d.intensity;

function scatterLayer(points: MapPoint[]) {
  return new ScatterplotLayer<MapPoint>({
    id: "events",
    data: points,
    pickable: true,
    stroked: true,
    radiusUnits: "pixels",
    radiusMinPixels: 3,
    radiusMaxPixels: 40,
    lineWidthMinPixels: 1,
    getPosition: getPointPosition,
    getRadius: getPointRadius,
    getFillColor: getPointFillColor,
    getLineColor: getPointLineColor,
  });
}

function teleColor(
  f: TeleFeature,
  alpha: number,
): [number, number, number, number] {
  const c = TELE_IMPACTS[f.properties.impact].rgb;
  return [c[0], c[1], c[2], alpha];
}

// Expected El Niño impact zones — translucent filled polygons drawn beneath the
// event dots, so the live hazards stay readable and clickable on top.
function teleLayer() {
  return new GeoJsonLayer({
    id: "teleconnections",
    data: TELECONNECTIONS,
    pickable: true,
    stroked: true,
    filled: true,
    lineWidthUnits: "pixels",
    lineWidthMinPixels: 1,
    getLineWidth: 1,
    getFillColor: (f) => teleColor(f as unknown as TeleFeature, 40),
    getLineColor: (f) => teleColor(f as unknown as TeleFeature, 160),
  });
}

// The Niño-3.4 region — the box NOAA averages sea-surface temperature over for
// the ONI / monthly index: 5°N–5°S, 170°W–120°W. Drawn only while the user
// hovers the "Niño-3.4" label on the ENSO card, so they can see *where* on the
// globe the number comes from.
const NINO34_REGION = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [-170, -5],
            [-120, -5],
            [-120, 5],
            [-170, 5],
            [-170, -5],
          ],
        ],
      },
    },
  ],
};

// Centre of the box — where the label sits.
const NINO34_CENTRE: [number, number] = [-145, 0];

function nino34Layers() {
  return [
    new GeoJsonLayer({
      id: "nino34",
      data: NINO34_REGION,
      pickable: false,
      stroked: true,
      filled: true,
      lineWidthUnits: "pixels",
      lineWidthMinPixels: 2,
      getLineWidth: 2,
      getFillColor: [52, 211, 153, 40],
      getLineColor: [52, 211, 153, 220],
    }),
    new TextLayer<{ position: [number, number]; text: string }>({
      id: "nino34-label",
      data: [{ position: NINO34_CENTRE, text: "Niño-3.4" }],
      pickable: false,
      // The default font atlas is ASCII-only, which drops "ñ" — list the exact
      // glyphs we render so the tilde-n is included.
      characterSet: Array.from("Niño-3.4"),
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getSize: 13,
      getColor: [224, 242, 254, 255],
      fontWeight: 600,
      // A dark pill behind the text keeps it legible over the ocean basemap.
      background: true,
      getBackgroundColor: [11, 16, 32, 210],
      backgroundPadding: [5, 3],
    }),
  ];
}

function heatLayer(points: MapPoint[]) {
  return new HeatmapLayer<MapPoint>({
    id: "heat",
    data: points,
    getPosition: getPointPosition,
    getWeight: getPointWeight,
    radiusPixels: 45,
    intensity: 1,
    threshold: 0.05,
    // Default is 2048 — a 4-megapixel texture rendered on every data/viewport
    // change. 1024 quarters the GPU work per re-aggregation with no visible
    // quality loss at globe-scale zooms.
    weightsTextureSize: 1024,
  });
}

export default function MapView({
  features,
  heatmap,
  teleconnections,
  highlightNino34,
  onSelect,
}: {
  features: EventFeature[];
  heatmap: boolean;
  teleconnections: boolean;
  highlightNino34?: boolean;
  onSelect?: (event: SelectedEvent | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  // Keep the latest onSelect in a ref so the overlay (created once) always calls
  // the current handler without being re-instantiated.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Initialise the map exactly once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP,
      center: [10, 25],
      zoom: 1.4,
      minZoom: 1,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const overlay = new MapboxOverlay({
      interleaved: false,
      // A little slack so small dots are easy to hover and click.
      pickingRadius: 6,
      getTooltip: getTooltip as any,
      // Click a dot to open its detail card; click empty map to dismiss.
      onClick: (info: { object?: MapPoint }) =>
        onSelectRef.current?.(
          info.object?.props
            ? { props: info.object.props, position: info.object.position }
            : null,
        ),
    });
    map.addControl(overlay as unknown as maplibregl.IControl);

    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Stable points reference for an unchanged `features` array — critical for
  // the heatmap: deck.gl treats a new data reference as "data changed", which
  // rebuilds the transform-feedback shader and re-renders the weight texture.
  // Without this memo, toggling teleconnections or the Niño-3.4 hover would
  // recompute the points and force a full heatmap re-aggregation.
  const points = useMemo(() => toPoints(features), [features]);

  // Same reasoning for the active data layer — memoize so toggles to other
  // overlays don't construct a fresh HeatmapLayer instance with churned props.
  const dataLayer = useMemo(
    () => (heatmap ? heatLayer(points) : scatterLayer(points)),
    [points, heatmap],
  );

  // Re-render layers whenever the filtered data or view mode changes.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    // Zones first so they render beneath the dots/heatmap; events stay on top
    // and win hover/click picking.
    overlay.setProps({
      layers: [
        ...(teleconnections ? [teleLayer()] : []),
        dataLayer,
        // On top of everything so the region outline + label read clearly on hover.
        ...(highlightNino34 ? nino34Layers() : []),
      ],
    });
  }, [dataLayer, teleconnections, highlightNino34]);

  // Outer div owns the absolute sizing. The inner div is maplibre's container —
  // maplibre adds `.maplibregl-map { position: relative }` to it, which would
  // override `absolute inset-0` and collapse it to 0 height, so we give the
  // inner element an explicit h-full/w-full instead of relying on inset.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
