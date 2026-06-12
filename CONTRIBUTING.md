# Contributing

The project is built to grow mainly by **adding data sources**. This guide is
the playbook for that and for the everyday dev workflow. For architecture see
[`ARCHITECTURE.md`](./ARCHITECTURE.md); for conventions and commands see
[`AGENTS.md`](./AGENTS.md).

## Dev workflow

Each layer is independent — set up only the one you're touching.

```bash
# ingestion
cd ingestion && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cp ../.env.example ../.env   # fill it in

# api
cd api && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL=… uvicorn index:app --reload

# web
cd web && npm install && npm run dev
```

There is no automated test suite yet. **Verify by running the layer you
changed**, and state what you verified (and what you didn't) in your PR.

## Adding a new data source — step by step

You almost never need to touch the DB, API, or frontend. The work is one new
module plus one line of registration.

### 1. Create `ingestion/sources/<name>.py`

Expose a single `fetch(...) -> list[Event]`. Inside it:
fetch the provider's data, then map each record onto an `Event`
(from `normalize`). Use the existing sources as templates:

- `gdacs.py` — paginated GeoJSON, multi-hazard, has a built-in severity.
- `firms.py` — high-volume CSV that must be **aggregated** before storing.
- `temperature.py` — a **derived** signal computed from raw measurements.

Minimum viable source:

```python
"""<Provider> — one line on what it gives us and any caveat."""
from __future__ import annotations

import requests
from normalize import HAZARD_FLOOD, Event, clamp01, point

def fetch(lookback_days: int = 7) -> list[Event]:
    resp = requests.get(URL, timeout=60,
                        headers={"User-Agent": "extreme-weather-tracker/0.1"})
    resp.raise_for_status()
    events: list[Event] = []
    for rec in resp.json()["items"]:
        events.append(Event(
            source="<name>",
            source_event_id=stable_id(rec),        # MUST be stable across runs
            hazard_type=HAZARD_FLOOD,               # from the fixed taxonomy
            geometry=point(rec["lon"], rec["lat"]), # GeoJSON dict, SRID 4326
            title=rec.get("name"),
            severity_raw=rec.get("level"),          # the provider's own label
            intensity_norm=clamp01(rec["score"] / MAX_SCORE),  # → 0..1
            started_at=parse_dt(rec.get("from")),   # TIMESTAMPTZ, UTC
            ended_at=parse_dt(rec.get("to")),
            country=rec.get("country"),
            url=rec.get("link"),
            metadata={"anything": "source-specific goes in JSONB"},
        ))
    return events
```

Hard requirements:

- **`source_event_id` must be stable** — the same real-world event must produce
  the same id on every run, or the 12h cron will create duplicates instead of
  upserting. (FIRMS, which has no provider id, synthesizes one from
  `source-countrycode-date`; do something equivalent if your provider lacks ids.)
- **`hazard_type` must be one of** `storm | flood | wildfire | heat | drought`.
  Adding a *new* hazard means more work — see below.
- **`intensity_norm` must be `0..1`** and comparable in spirit to the other
  sources (see `ARCHITECTURE.md` → intensity model). Always `clamp01`.
- **Geometry is GeoJSON, SRID 4326** (`[lon, lat]` order). Use the `point()`
  helper for points.
- **Respect free-tier limits.** If the provider emits huge volumes (à la
  FIRMS), aggregate/grid-bin before emitting, and push tuning knobs into
  `config.py`.
- **Fail loudly but locally.** Let `fetch` raise on real errors — `run.py`
  catches per-source so one bad provider won't abort the others.

### 2. Register it in `ingestion/run.py`

```python
from sources import firms, gdacs, temperature, yournew

def run_yournew() -> list:
    return yournew.fetch(lookback_days=config.LOOKBACK_DAYS)

SOURCES = {
    "gdacs": run_gdacs,
    "firms": run_firms,
    "temperature": run_temperature,
    "yournew": run_yournew,          # ← add here
}
```

If it needs a secret/threshold, add it to `config.py` (env-driven, with a
default) and document it in `.env.example` — and add the secret to the GitHub
Actions workflow env in `.github/workflows/ingest.yml` if the cron needs it.

### 3. Test idempotency

```bash
python run.py --source yournew      # run once — note the count
python run.py --source yournew      # run again — row count in DB must NOT grow
```

That's it. The API and map pick it up automatically because they read the
generic `events` table.

## Adding a new hazard type (the bigger change)

A new `hazard_type` must be added in **all** of these or it will be filtered out
silently:

1. `ingestion/normalize.py` — add a `HAZARD_*` constant.
2. `api/index.py` — add it to `VALID_HAZARDS`.
3. `web/lib/types.ts` — add it to the `HazardType` union.
4. `web/lib/hazards.ts` — add a `HAZARDS` entry (label, hex, rgb, emoji) and to
   `HAZARD_ORDER`.

No DB migration is needed — `hazard_type` is just text.

## Pull request checklist

- [ ] Ran the affected layer locally and described what you verified.
- [ ] New/changed ingestion is **idempotent** (ran twice, no duplicate rows).
- [ ] `intensity_norm` is clamped to `[0,1]`; `source_event_id` is stable.
- [ ] Hazard taxonomy stays in sync across the three places (if touched).
- [ ] `npm run build` + `npm run lint` pass (if `web/` touched).
- [ ] New env vars added to `.env.example` (and the workflow, if the cron needs them).
- [ ] No secrets committed.
