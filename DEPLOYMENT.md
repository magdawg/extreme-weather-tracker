# Deployment

How to host Extreme Weather Tracker end-to-end on **free tiers, no credit card**.
For architecture and local-dev commands see [`AGENTS.md`](./AGENTS.md) and
[`ARCHITECTURE.md`](./ARCHITECTURE.md); this doc is the hosting walkthrough only.

## What gets hosted where

Four independent layers, each on its own free tier. Deploy them in this order —
each step depends on the one before it.

```
1. Database    Postgres + PostGIS   →  Neon (free tier)       the store
2. Ingestion   Python ETL           →  GitHub Actions (cron)  fills the store every 12h
3. API         FastAPI (read-only)  →  Vercel (Python funcs)  reads the store
4. Frontend    Next.js + deck.gl    →  Vercel (Hobby)         the map, calls the API
```

You will collect three secrets along the way and wire them between layers:

| Secret | Produced by | Consumed by |
|--------|-------------|-------------|
| `DATABASE_URL` | Neon (step 1) | Ingestion (2) + API (3) |
| `FIRMS_MAP_KEY` | NASA FIRMS (step 2) | Ingestion (2) |
| `NEXT_PUBLIC_API_URL` | Vercel API deploy (step 3) | Frontend (4) |

> ⚠️ **Vercel Hobby is non-commercial only.** Fine for a personal project; you
> need a paid plan for anything commercial.

---

## Prerequisites

- A **GitHub account** with this repo pushed to it (ingestion runs from GitHub
  Actions, and Vercel deploys from the repo).
- A free **[Neon](https://neon.com)** account.
- A free **[Vercel](https://vercel.com)** account (sign in with GitHub).
- A free **[NASA FIRMS map key](https://firms.modaps.eosdis.nasa.gov/api/map_key/)**.
- `psql` locally (to apply the schema) and Python 3.12 (to smoke-test ingestion
  before you schedule it).

---

## 1. Database — Neon

1. Create a free project at **[neon.com](https://neon.com)**.
2. Copy the **connection string** from the dashboard. It looks like:
   ```
   postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require
   ```
   Keep the `?sslmode=require` — the API and ingestion both expect SSL.
3. Apply the schema (PostGIS is preinstalled on Neon, no extension install
   needed):
   ```bash
   psql "postgresql://…neon.tech/neondb?sslmode=require" -f db/schema.sql
   ```

This `DATABASE_URL` is reused in steps 2 and 3.

**Free-tier note:** Neon's free storage is ~0.5 GB. The ingestion pipeline is
deliberately built to stay under it (FIRMS fires are grid-binned to one event
per country per day, never raw pixels). Don't change that without watching
storage.

---

## 2. Ingestion — GitHub Actions cron

The store is empty until ingestion runs. First verify it works locally, then let
GitHub Actions run it on a schedule.

### 2a. Smoke-test locally (recommended before scheduling)

```bash
cd ingestion
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env          # fill in DATABASE_URL + FIRMS_MAP_KEY
python run.py                       # all sources
```

Run it **twice** and confirm row counts upsert rather than duplicate — that's
the idempotency guarantee the 12h cron relies on. One failing source won't abort
the run (`run.py` catches per-source), so check the logs for partial failures.

### 2b. Schedule it on GitHub Actions

The workflow at [`.github/workflows/ingest.yml`](./.github/workflows/ingest.yml)
already runs every 12 hours (`cron: "0 */12 * * *"`) and exposes a manual **Run
workflow** button. It needs two repo secrets:

1. Push the repo to GitHub if you haven't.
2. Go to **Settings → Secrets and variables → Actions → New repository secret**
   and add:
   - `DATABASE_URL` — the Neon string from step 1.
   - `FIRMS_MAP_KEY` — your NASA FIRMS key.
3. Trigger the first run manually: **Actions → Ingest extreme weather data → Run
   workflow**. Watch it succeed, then confirm rows landed in Neon.

After this the map will have data within one run; the cron keeps it fresh.

---

## 3. API — Vercel (Python serverless)

Deploy the read-only FastAPI service. [`api/vercel.json`](./api/vercel.json)
already configures the `@vercel/python` build and routes everything to
`index.py`.

1. In Vercel, **Add New → Project** and import this GitHub repo.
2. Set **Root Directory = `api`**. (Vercel will use `api/vercel.json` and
   `api/requirements.txt` automatically.)
3. Add an environment variable:
   - `DATABASE_URL` = the Neon string from step 1.
4. Deploy. You'll get a URL like `https://your-api.vercel.app`.
5. Verify:
   - `https://your-api.vercel.app/` → health check
   - `https://your-api.vercel.app/stats` → per-hazard counts (non-empty if step 2 ran)
   - `https://your-api.vercel.app/events?limit=10` → a GeoJSON FeatureCollection

Note the API URL **without a trailing slash** — the frontend needs it next.

> 🔒 **Tighten CORS before sharing.** The API ships with `CORS = *`, which is
> fine for a private Hobby project but open to the world. Restrict it to your
> frontend's Vercel domain in `api/index.py` before any real deployment.

---

## 4. Frontend — Vercel (Next.js)

1. In Vercel, **Add New → Project** and import the **same repo again** (a second
   Vercel project).
2. Set **Root Directory = `web`**. Vercel detects Next.js automatically.
3. Add an environment variable:
   - `NEXT_PUBLIC_API_URL` = your API URL from step 3, **no trailing slash**
     (e.g. `https://your-api.vercel.app`).
4. Deploy. You'll get a URL like `https://your-app.vercel.app` — that's the live
   map.

> `NEXT_PUBLIC_API_URL` is baked in at **build time** (it's a `NEXT_PUBLIC_`
> var). If you change the API URL later, **redeploy** the frontend so the new
> value is compiled in.

---

## Verifying the full deployment

1. Open the frontend URL → the map loads (it's client-only via `next/dynamic`,
   so give WebGL a moment).
2. Dots appear for storms/floods/wildfires/heat/cold/drought. If the map is
   empty, the API has no data — re-check step 2 (did the Action run? did rows
   land in Neon?).
3. The hazard, severity, and time filters respond instantly (all filtering is
   client-side; no per-interaction API calls).
4. Browser devtools **Network** tab shows a single successful request to
   `NEXT_PUBLIC_API_URL/events`.

---

## Updating after the first deploy

- **Code changes** → push to GitHub. Both Vercel projects auto-deploy from the
  branch you connected.
- **Schema changes** (`db/schema.sql`) → re-run `psql … -f db/schema.sql`
  against Neon. There is no migration tool; the schema is applied directly.
- **New data source / hazard** → see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Most
  source additions need no API/frontend change; a new `hazard_type` must be
  added in all three taxonomy locations (see `AGENTS.md` → "the one invariant").
- **Changed the API URL** → update `NEXT_PUBLIC_API_URL` in the frontend Vercel
  project and **redeploy** (build-time var).

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Map loads but no dots | Store is empty | Run the GitHub Action (step 2b); confirm rows in Neon |
| Frontend can't reach API (CORS / network error) | `NEXT_PUBLIC_API_URL` wrong, has a trailing slash, or stale | Fix the env var and **redeploy** the frontend |
| API returns 500 | `DATABASE_URL` missing/wrong on the API project, or schema not applied | Re-check the API env var and that step 1 ran |
| API cold-start slow on first hit | Vercel serverless cold start + connection pool warm-up | Expected; subsequent requests reuse the warm pool |
| Ingestion Action fails | Missing/expired secret, or a provider was down | Check the Action logs; one failing source doesn't abort the run, but a bad `DATABASE_URL`/`FIRMS_MAP_KEY` will |
| Neon storage near the limit | FIRMS aggregation changed, or too much history | Keep FIRMS grid-binned; don't store raw detections |

---

## Free-tier limits at a glance

- **Neon**: ~0.5 GB storage; project may auto-suspend when idle (wakes on the
  next query — first request after idle is slower).
- **Vercel Hobby**: non-commercial only; serverless functions cold-start.
- **GitHub Actions**: generous free minutes for public repos; the 12h cron uses
  a few minutes per run.
- **NASA FIRMS** and **GDACS/Open-Meteo**: free public APIs; FIRMS requires the
  free map key, the others need no auth.
