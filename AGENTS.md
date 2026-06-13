# AGENTS.md

Canonical guide for AI agents and human contributors working in this repo.
Tool-agnostic; `CLAUDE.md` adds Claude Code-specific notes and defers here for
everything substantive. Read this first.

## What this is

A live world map of extreme weather events — **storms, floods, wildfires,
extreme heat, drought** — built to show **patterns, transitions
and intensity** across the globe. Everything runs on **free tiers, no credit
card**.

```
Next.js + MapLibre + deck.gl   →  Vercel (Hobby)        frontend / map      (web/)
        │ fetches GeoJSON
FastAPI (Python)               →  Vercel (Python funcs)  read-only API       (api/)
        │ reads
Postgres + PostGIS             →  Neon (free tier)       normalized store    (db/)
        ▲ upserts every 12h
Python ETL                     →  GitHub Actions (cron)  ingestion           (ingestion/)
```

## The one invariant that matters

Every data source, no matter how different its raw format, is mapped onto a
**single normalized `Event`** (`ingestion/normalize.py`) and stored in **one
`events` table** (`db/schema.sql`). The DB, API, and map **never special-case a
provider**. Two consequences you must preserve:

1. **`hazard_type`** is from a fixed taxonomy: `storm | flood | wildfire | heat
   | drought`. This enum is duplicated in three places that must stay in
   sync — keep them identical:
   - `ingestion/normalize.py` (`HAZARD_*` constants)
   - `api/index.py` (`VALID_HAZARDS`)
   - `web/lib/types.ts` (`HazardType`) + `web/lib/hazards.ts` (`HAZARDS`, `HAZARD_ORDER`)
2. **`intensity_norm`** is a unified `0..1` float so the map colors/sizes every
   hazard consistently. Anything you emit must be clamped to `[0,1]` (the
   `Event` dataclass does this in `__post_init__` via `clamp01`). See
   `ARCHITECTURE.md` for the per-source intensity formulas.

If you add a hazard type, update all three locations plus the map metadata
(color/emoji/label) in `web/lib/hazards.ts`, or it will silently disappear from
the UI and be rejected by the API filter.

**The one sanctioned exception:** ENSO (El Niño / La Niña) is a single *global*
index, not a located hazard, so forcing it into the `Event` model would be
wrong. It lives in its own `enso_oni` table, its own ingestion module
(`ingestion/enso.py`, run via `--source enso`), and its own `/enso` endpoint —
and the events pipeline never sees it. If you need other global, non-located
context layers, follow this pattern rather than bending the `Event` contract.

A second, frontend-only variant of the same principle: the El Niño
**teleconnection overlay** (`web/lib/teleconnections.ts`) is a hand-authored
static GeoJSON of *expected* impact zones (wetter / drier / hotter / stormier),
toggled on the map alongside the live hazards. It's reference/forecast context,
not observed events, so it lives entirely in the web layer and never touches the
DB or the `Event` model.

## Repo layout

```
api/         FastAPI read-only API (Vercel Python functions)
  index.py        all endpoints: GET / , /events , /stats
  vercel.json     @vercel/python build config
  requirements.txt
db/
  schema.sql      the single `events` table + PostGIS + indexes; plus `enso_oni`
                  (the global ENSO/El Niño index — deliberately NOT an event)
ingestion/   Python ETL — run by GitHub Actions every 12h or locally
  run.py          orchestrator; --source picks a subset
  config.py       env-driven config (thresholds, grid size, lookback)
  normalize.py    the canonical Event dataclass + intensity helpers  ← the contract
  db.py           connect + idempotent upsert (ON CONFLICT)
  sources/        one module per provider: gdacs, firms, temperature
  requirements.txt
web/         Next.js 14 (App Router) + MapLibre + deck.gl, TypeScript + Tailwind
  app/            layout.tsx, page.tsx (all client state lives here), globals.css
  components/     MapView, HazardFilter, SeverityFilter, TimeSlider, WindowSelect, Legend, StatsPanel
  lib/            api.ts (fetch), types.ts (Event shapes), hazards.ts (taxonomy+colors), severity.ts (tiers)
.github/workflows/ingest.yml   the 12h cron
```

## Setup & commands

Each layer is independent. There is **no root-level toolchain** — `cd` into the
layer you're working on.

### Database (once)
```bash
psql "$DATABASE_URL" -f db/schema.sql      # PostGIS is preinstalled on Neon
```

### Ingestion
```bash
cd ingestion
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env                 # fill DATABASE_URL + FIRMS_MAP_KEY
python run.py                              # all sources + the ENSO index
python run.py --source gdacs               # one source (also: firms, temperature)
python run.py --source enso                # just the ENSO/ONI index (writes enso_oni)
```
Free FIRMS key: <https://firms.modaps.eosdis.nasa.gov/api/map_key/>.

### API
```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="postgresql://…" uvicorn index:app --reload    # http://localhost:8000
```
Endpoints:
- `GET /` → health
- `GET /events?hazard=storm,flood&from=ISO&to=ISO&bbox=w,s,e,n&min_intensity=0.5&limit=5000` → GeoJSON FeatureCollection
- `GET /stats` → per-hazard counts + mean intensity (powers the right panel)
- `GET /enso` → `{current, series}` Oceanic Niño Index (El Niño / La Niña);
  global climate context, **not** events — powers the ENSO strip + time-slider band

### Frontend
```bash
cd web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev        # http://localhost:3000
npm run build      # production build / typecheck
npm run lint       # next lint
```

## Conventions

- **Python**: 3.12, `from __future__ import annotations` at the top of every
  module, type hints throughout, stdlib-style modules (no framework beyond
  FastAPI/requests/psycopg2). Module-level docstrings explain *why* a source
  works the way it does — keep that habit.
- **TypeScript**: `strict` mode. Path alias `@/*` → `web/*`. All map/filter
  state lives in `web/app/page.tsx`; components are presentational and receive
  props. Tailwind for styling, no CSS modules.
- **No secrets in code.** Everything sensitive comes from env
  (`DATABASE_URL`, `FIRMS_MAP_KEY`). `.env` and `.env.local` are gitignored;
  `.env.example` documents the contract.
- **Idempotency**: ingestion runs every 12h and must be safe to re-run. The
  `UNIQUE (source, source_event_id, hazard_type)` constraint + `ON CONFLICT …
  DO UPDATE` upsert is what makes that work. A new source must produce a
  **stable** `source_event_id`.

## Adding a new data source

This is the primary way the project grows — see `CONTRIBUTING.md` for the full
step-by-step. In short: add `ingestion/sources/<name>.py` exposing
`fetch(...) -> list[Event]`, register it in `run.py`'s `SOURCES` dict, and emit
normalized `Event`s with a stable id and clamped intensity. No schema, API, or
frontend change is needed unless you introduce a new `hazard_type`.

## Gotchas (read before debugging)

- **GDACS returns its most-recent events per hazard, which can be months old.**
  The frontend deliberately fetches everything and derives the time-slider
  domain from the data (`[oldest event, now]`) rather than assuming "now". Don't
  "fix" this by hard-filtering to recent dates.
- **FIRMS is millions of pixels.** We aggregate detections to **one event per
  (country, day)** — placed at the FRP-weighted centre of that country's fires —
  to stay inside Neon's free 0.5 GB and keep the map readable. Don't store raw
  detections. Country comes from offline reverse-geocoding (`reverse_geocode`); a
  coarse ~1° grid (`FIRMS_GRID_DEG`) only exists to geocode each cell once rather
  than every pixel. Quiet country-days are dropped via `FIRMS_MIN_DETECTIONS` /
  `FIRMS_MIN_INTENSITY`.
- **Heat is *derived*, not a real feed.** `temperature.py` flags an absolute
  threshold over a fixed city grid — a documented heuristic. The clean upgrade
  (percentile-vs-climatology) is a TODO in that file; the rest of the pipeline
  doesn't change.
- **The map is client-only.** `MapView` is loaded via `next/dynamic` with
  `{ ssr: false }` because deck.gl/maplibre touch `window`/WebGL. Keep it that
  way.
- **maplibre container sizing**: the inner div needs explicit `h-full w-full`
  (not `inset-0`) — maplibre forces `position: relative` on its container, which
  would override `absolute inset-0` and collapse it to zero height. See the
  comment in `MapView.tsx`.
- **One failing source must not kill the run.** `run.py` wraps each source in
  try/except and continues. Preserve that.
- **CORS is `*`** in the API — fine for a Hobby project; tighten to your Vercel
  domain before any real deployment.

## Deploy (all free)

- **API**: new Vercel project, Root Directory = `api`, env `DATABASE_URL`.
- **Frontend**: new Vercel project, Root Directory = `web`, env
  `NEXT_PUBLIC_API_URL` = the API URL (no trailing slash).
- **Ingestion**: GitHub Actions runs `.github/workflows/ingest.yml` every 12h
  once repo secrets `DATABASE_URL` and `FIRMS_MAP_KEY` are set
  (Settings → Secrets → Actions). Also runnable on-demand via "Run workflow".
- Vercel Hobby is **non-commercial only**.

## See also

- `ARCHITECTURE.md` — data flow, the event model, and intensity-normalization rationale.
- `CONTRIBUTING.md` — step-by-step "add a data source" + dev workflow.
- `README.md` — user-facing setup/deploy walkthrough.
