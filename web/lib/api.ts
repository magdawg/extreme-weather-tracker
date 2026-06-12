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

/** A fixed 2-year slice of the timeline, used to load events in cacheable chunks. */
export interface TimeChunk {
  fromMs: number; // [from, to) half-open, by started_at
  toMs: number;
  from: string; // ISO, sent to the API — must be stable across users/loads
  to: string; //   so Vercel's CDN cache key is shared (no MISS storms)
}

// First year of data (GDACS backfill floor). Chunk boundaries are anchored here
// and stepped by 2 years so every client requests the *same* URLs — that's what
// lets each chunk cache independently on Vercel's edge.
export const DATA_START_YEAR = 2021;

/**
 * Split the timeline into fixed 2-year chunks from {@link DATA_START_YEAR} up to
 * the year containing `nowMs`, newest first. Boundaries are calendar dates in
 * UTC (never "now"), so the resulting `/events?from=…&to=…` URLs are identical
 * for everyone and stay cacheable. The newest chunk is smallest, so loading it
 * first gives a fast first paint.
 */
export function timeChunks(nowMs: number): TimeChunk[] {
  const endYear = new Date(nowMs).getUTCFullYear();
  const chunks: TimeChunk[] = [];
  for (let y = DATA_START_YEAR; y <= endYear; y += 2) {
    const fromMs = Date.UTC(y, 0, 1);
    const toMs = Date.UTC(y + 2, 0, 1);
    chunks.push({
      fromMs,
      toMs,
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    });
  }
  return chunks.reverse(); // newest chunk first
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
