"use client";

import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import "maplibre-gl/dist/maplibre-gl.css";

import { HAZARDS } from "@/lib/hazards";
import { SEVERITIES, tierOf } from "@/lib/severity";
import { toLngLat } from "@/lib/api";
import type { EventFeature, EventProperties } from "@/lib/types";

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

function getTooltip({ object }: { object?: MapPoint }) {
  if (!object?.props) return null;
  const p = object.props;
  const date = p.started_at ? new Date(p.started_at).toLocaleDateString() : "";
  const meta = HAZARDS[p.hazard_type];
  const label = meta?.label ?? p.hazard_type;
  const severity = SEVERITIES[tierOf(p)].label;
  const source = SOURCE_LABELS[p.source] ?? p.source;
  const showTitle = p.title && !titleRestatesCountry(p.title, p.country);
  const heading = showTitle
    ? `<b>${meta?.emoji ?? ""} ${p.title}</b>
      <br/><span style="opacity:.7">${label}</span> · ${severity}`
    : `<b>${meta?.emoji ?? ""} ${label}</b> · ${severity}`;
  return {
    html: `${heading}
      ${p.country ? "<br/>" + p.country : ""}
      ${date ? "<br/>" + date : ""}
      ${source ? `<br/><span style="opacity:.6">Source: ${source}</span>` : ""}`,
  };
}

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
    getPosition: (d) => d.position,
    getRadius: (d) => d.radius,
    getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 170],
    getLineColor: (d) => [d.color[0], d.color[1], d.color[2], 255],
  });
}

function heatLayer(points: MapPoint[]) {
  return new HeatmapLayer<MapPoint>({
    id: "heat",
    data: points,
    getPosition: (d) => d.position,
    getWeight: (d) => d.intensity,
    radiusPixels: 45,
    intensity: 1,
    threshold: 0.05,
  });
}

export default function MapView({
  features,
  heatmap,
}: {
  features: EventFeature[];
  heatmap: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);

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

    const overlay = new MapboxOverlay({ interleaved: false, getTooltip: getTooltip as any });
    map.addControl(overlay as unknown as maplibregl.IControl);

    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // Re-render layers whenever the filtered data or view mode changes.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const points = toPoints(features);
    overlay.setProps({
      layers: [heatmap ? heatLayer(points) : scatterLayer(points)],
    });
  }, [features, heatmap]);

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
