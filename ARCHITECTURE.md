# Architecture

How the pieces fit, why the boundaries are where they are, and the two models
(event normalization + intensity) that everything depends on. For commands and
conventions see [`AGENTS.md`](./AGENTS.md).

## Data flow

```
 External providers                Ingestion (Python, 12h cron)         Store            Read path
 ─────────────────                 ────────────────────────────         ─────            ─────────
 GDACS GeoJSON   ─┐
 NASA FIRMS CSV  ─┼─►  sources/*.fetch() ─► list[Event] ─► db.upsert ─►  Postgres  ─►  api/index.py ─►  web/
 Open-Meteo JSON ─┘     (normalize)         (normalize.py)  (ON CONFLICT) + PostGIS    (FastAPI, GeoJSON)  (deck.gl map)
```

- **Pull, not push.** Each source module owns its provider quirks and returns a
  list of already-normalized `Event`s. The orchestrator (`run.py`) just loops
  over selected sources and upserts.
- **Stateless read API.** Every `/events` request is one Postgres read, which is
  why it runs fine as a Vercel Python serverless function. A tiny connection
  pool (`SimpleConnectionPool(1, 4)`) is reused across warm invocations.
- **Dumb, fast frontend.** The map fetches once (up to ~15k features), then does
  all hazard/severity/time filtering **client-side** in `web/app/page.tsx`. No
  per-interaction round-trips. This is deliberate: the dataset is small enough
  to hold in memory, and it keeps the API and the free DB idle.

## The event model (the contract)

Defined once in `ingestion/normalize.py` as the `Event` dataclass, persisted by
`db/schema.sql` as the `events` table, and re-typed for the client in
`web/lib/types.ts`. These three representations describe the same thing and must
stay aligned.

| Field             | Meaning                                                       |
|-------------------|---------------------------------------------------------------|
| `source`          | `'gdacs' \| 'firms' \| 'open-meteo'` — provenance             |
| `source_event_id` | **stable** id within that source (drives idempotent upsert)   |
| `hazard_type`     | fixed taxonomy: storm/flood/wildfire/heat/cold/drought        |
| `geometry`        | GeoJSON geometry dict (Point or Polygon), SRID 4326           |
| `title`           | human label for the tooltip                                   |
| `severity_raw`    | the source's own label (e.g. GDACS `Orange`, `FRP 42 MW`)     |
| `intensity_norm`  | unified `0..1` float — the cross-hazard comparability key     |
| `started_at` / `ended_at` | event time window (TIMESTAMPTZ, UTC)                  |
| `country`, `url`  | optional context                                              |
| `metadata`        | JSONB escape hatch for source-specific extras                 |

**Idempotency** comes from `UNIQUE (source, source_event_id, hazard_type)` plus
`ON CONFLICT … DO UPDATE` in `ingestion/db.py`. Re-running ingestion refreshes
rows in place instead of duplicating them — essential for a 12h cron with
overlapping `LOOKBACK_DAYS` windows.

The `metadata` JSONB column is the pressure valve: source-specific fields
(FRP, detection counts, GDACS episode ids, city names) live there so the
columns stay universal and the schema never needs a migration to onboard a new
source.

## The intensity model

`intensity_norm ∈ [0,1]` is what lets the map size and color **every hazard on
one scale**. Each source derives it differently, but the output is always
clamped (`clamp01`) and comparable:

- **GDACS** (`normalize.gdacs_intensity`): prefer the continuous `alertscore`
  (0–3) → `score/3`. Fall back to the alert **colour midpoint** on that same
  0–3 band — Green `0.5/3≈0.17`, Orange `1.5/3=0.5`, Red `2.5/3≈0.83`.
  Midpoints (not edges) keep a colour-only event representative for dot size.
- **FIRMS** (`sources/firms.py`): detections are aggregated to **one event per
  (country, day)**, placed at the FRP-weighted centre of that country's fires
  that day. Country comes from offline reverse-geocoding (`reverse_geocode`); a
  coarse ~1° grid (`FIRMS_GRID_DEG`) is used only to geocode each cell once
  rather than every raw pixel. Country-days below `FIRMS_MIN_DETECTIONS` or
  `FIRMS_MIN_INTENSITY` are dropped as noise. Intensity blends mean fire
  radiative power and detection count —
  `0.6·(mean_FRP/200) + 0.4·(log1p(count)/log1p(200))`, clamped.
- **Open-Meteo heat/cold** (`sources/temperature.py`): distance past an absolute
  threshold over a saturation span — heat `(tmax−40)/15`, cold `(−18−tmin)/22`,
  clamped.

### Severity tiers (frontend)

`web/lib/severity.ts` collapses `intensity_norm` into three display tiers
(minor/moderate/severe) that line up with the GDACS 0–3 colour bands. If a
source gave an authoritative colour in `severity_raw` (GDACS Green/Orange/Red),
that wins; otherwise intensity is bucketed by thirds. This keeps the severity
filter meaningful across sources that don't share GDACS's colour scheme.

## Why these boundaries

- **Ingestion ≠ API ≠ frontend** are separate deployables on separate free
  tiers (GitHub Actions / Vercel Python / Vercel). A failure or quota hit in one
  doesn't take down the others, and each can be developed in isolation.
- **One table, no joins.** The normalized model means analytics, the map, and
  the API never special-case a provider — the cost is pushing normalization
  into the source modules, which is exactly where provider knowledge belongs.
- **Everything free-tier.** Design constraints (grid-binning FIRMS, ~15k feature
  cap, client-side filtering, no raw-detection storage) all trace back to
  staying inside Neon's 0.5 GB and Vercel Hobby limits.

## Known limitations / upgrade paths

- **Heat/cold are heuristic**, sampled over a fixed ~52-city grid with absolute
  thresholds. Upgrade: percentile-vs-climatology anomalies from the ERA5 archive
  (TODO in `temperature.py`) — captures a "cold snap" in the tropics that a
  fixed cutoff misses. Pipeline unchanged.
- **No cyclone tracks** yet — points only. IBTrACS history + NHC live tracks
  drawn as trails would best show "transitions across the world".
- **No flood footprints** — GDACS gives a point; GloFAS polygons would be richer.
- **CORS is wide open** and the API has no auth/rate limiting — acceptable for a
  personal Hobby deployment only.
