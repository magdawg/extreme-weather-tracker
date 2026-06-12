import type { FeatureCollection, HazardStat } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function fetchEvents(params?: {
  from?: string;
  to?: string;
  limit?: number;
}): Promise<FeatureCollection> {
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  q.set("limit", String(params?.limit ?? 50000));

  const res = await fetch(`${API_URL}/events?${q.toString()}`);
  if (!res.ok) throw new Error(`API /events ${res.status}`);
  return res.json();
}

export async function fetchStats(): Promise<{ by_hazard: HazardStat[] }> {
  const res = await fetch(`${API_URL}/stats`);
  if (!res.ok) throw new Error(`API /stats ${res.status}`);
  return res.json();
}

/** Pull a [lon, lat] out of any GeoJSON geometry (centroid-ish for polygons). */
export function toLngLat(geometry: {
  type: string;
  coordinates: any;
}): [number, number] | null {
  const c = geometry.coordinates;
  if (geometry.type === "Point") return [c[0], c[1]];
  if (geometry.type === "Polygon") return [c[0][0][0], c[0][0][1]];
  if (geometry.type === "MultiPolygon") return [c[0][0][0][0], c[0][0][0][1]];
  if (geometry.type === "LineString") return [c[0][0], c[0][1]];
  return null;
}
