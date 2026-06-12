# 🌍 Extreme Weather Tracker

A live world map of extreme weather events — **storms, floods, wildfires,
extreme heat and extreme cold** — built to observe **patterns, transitions and
intensity** of extreme weather across the globe.

Everything runs on **free tiers, no credit card**.

```
Next.js + MapLibre + deck.gl   →  Vercel (Hobby)        frontend / map
        │ fetches GeoJSON
FastAPI (Python)               →  Vercel (Python funcs)  read-only API
        │ reads
Postgres + PostGIS             →  Neon (free tier)       normalized event store
        ▲ upserts every 12h
Python ETL                     →  GitHub Actions (cron)  ingestion
```

## Data sources

| Hazard | Source | Notes |
|--------|--------|-------|
| Storms (cyclones) | [GDACS](https://www.gdacs.org) `TC` | severity from alert level + alertscore |
| Floods | GDACS `FL` | |
| Wildfires | GDACS `WF` + [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) | FIRMS pixels aggregated to one event per country per day, at the fire-weighted centre |
| Drought | GDACS `DR` | bonus hazard |
| Extreme heat / cold | **Derived** from [Open-Meteo](https://open-meteo.com) | absolute-threshold heuristic over a global city grid (see caveat) |

> **Heat/cold caveat:** no provider ships a ready-made "heatwave event" feed, so
> we derive them. v1 flags days crossing an absolute temperature threshold.
> The clean upgrade (TODO in `ingestion/sources/temperature.py`) is
> percentile-vs-climatology anomaly detection.

All events are normalized into one `events` table (`db/schema.sql`) with a
unified `intensity_norm` (0–1) so the map colors/sizes every hazard consistently.

---

## 1. Database (Neon)

1. Create a free project at [neon.com](https://neon.com) → copy the connection
   string (it looks like `postgresql://…neon.tech/neondb?sslmode=require`).
2. Apply the schema (PostGIS is preinstalled on Neon):
   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   ```

## 2. Ingestion (local test, then GitHub Actions)

```bash
cd ingestion
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env        # fill in DATABASE_URL + FIRMS_MAP_KEY
python run.py                     # all sources
python run.py --source gdacs      # one source
```

Get a free FIRMS key at <https://firms.modaps.eosdis.nasa.gov/api/map_key/>.

**Schedule it free:** push to GitHub, then add repo secrets
`DATABASE_URL` and `FIRMS_MAP_KEY` (Settings → Secrets → Actions). The workflow
in `.github/workflows/ingest.yml` runs every 12h (and on-demand via "Run
workflow").

## 3. API (FastAPI)

```bash
cd api
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="postgresql://…" uvicorn index:app --reload   # http://localhost:8000
```

Endpoints:
- `GET /events?hazard=storm,flood&from=ISO&to=ISO&bbox=w,s,e,n&min_intensity=0.5` → GeoJSON
- `GET /stats` → counts + mean intensity per hazard
- `GET /` → health

## 4. Frontend (Next.js)

```bash
cd web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev                       # http://localhost:3000
```

---

## Deploy (all free)

**API** — new Vercel project, **Root Directory = `api`**, add env var
`DATABASE_URL`. `api/vercel.json` configures the Python build. You'll get a URL
like `https://your-api.vercel.app`.

**Frontend** — new Vercel project, **Root Directory = `web`**, add env var
`NEXT_PUBLIC_API_URL` = your API URL. Deploy.

**Ingestion** — already runs on GitHub Actions once secrets are set.

> ⚠️ Vercel Hobby is **non-commercial only**. Fine for a personal project.

## Repo layout

```
api/         FastAPI read API (Vercel Python functions)
db/          PostGIS schema
ingestion/   Python ETL — sources/{gdacs,firms,temperature}.py + run.py
web/         Next.js + TS + MapLibre + deck.gl
.github/     ingest.yml cron
```

## Ideas / next steps

- Cyclone **tracks** (IBTrACS history + NHC live) drawn as moving trails — best
  showcase of "transitions across the world".
- Percentile-based heat/cold anomalies (see temperature.py TODO).
- A time-lapse "play" button animating the slider.
- GloFAS flood footprints as polygons.
