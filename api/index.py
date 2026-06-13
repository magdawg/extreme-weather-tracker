"""Read-only GeoJSON API over the events table.

Stateless: every request is a Postgres read, so it runs fine as a Vercel
Python serverless function. Run locally with:

    uvicorn index:app --reload   # from the api/ directory
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Optional

import psycopg2
import psycopg2.pool
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

DATABASE_URL = os.environ.get("DATABASE_URL", "")

VALID_HAZARDS = {"storm", "flood", "wildfire", "heat", "drought"}

# NOAA CPC's 12 overlapping 3-month ENSO seasons, in calendar order. The index
# (1-based) is also the season's *centre* month — DJF is centred on Jan, NDJ on
# Dec — which is how we place each ONI reading on a real timeline.
ENSO_SEASONS = [
    "DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ",
    "JJA", "JAS", "ASO", "SON", "OND", "NDJ",
]
_SEASON_MONTH = {s: i + 1 for i, s in enumerate(ENSO_SEASONS)}

# El Niño ≥ +0.5, La Niña ≤ −0.5 (°C ONI). Mirrored in ingestion/enso.py and
# web/lib/enso.ts — keep all three in sync.
EL_NINO_THRESHOLD = 0.5
LA_NINA_THRESHOLD = -0.5


def enso_phase(anom: float) -> str:
    if anom >= EL_NINO_THRESHOLD:
        return "el-nino"
    if anom <= LA_NINA_THRESHOLD:
        return "la-nina"
    return "neutral"

app = FastAPI(title="Extreme Weather Tracker API", version="0.1.0")

# Hobby project: allow any origin. Tighten to your Vercel domain in prod.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# Compress responses at the origin. This is what makes /events cacheable on
# Vercel's CDN: the edge evaluates the 10 MB cache-size limit against the
# *uncompressed* origin body, so a 14 MB JSON payload is silently never cached.
# Gzipping in the function drops the origin body to ~1 MB, well under the limit,
# and also cuts transfer time. (Added after CORS so it wraps the final
# response and gzips it with the CORS headers already in place.)
app.add_middleware(GZipMiddleware, minimum_size=500)

# A tiny connection pool survives across warm serverless invocations.
_pool: Optional[psycopg2.pool.SimpleConnectionPool] = None


def get_pool() -> psycopg2.pool.SimpleConnectionPool:
    global _pool
    if _pool is None:
        if not DATABASE_URL:
            raise HTTPException(500, "DATABASE_URL is not configured")
        _pool = psycopg2.pool.SimpleConnectionPool(1, 4, dsn=DATABASE_URL)
    return _pool


def query(sql: str, params: tuple):
    pool = get_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row)) for row in cur.fetchall()]
    except Exception:
        # Roll back so a failed statement (e.g. a table that doesn't exist yet)
        # doesn't return a connection to the pool stuck in an aborted txn.
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


@app.get("/")
def health():
    return {"status": "ok", "service": "extreme-weather-tracker"}


@app.get("/events")
def events(
    response: Response,
    hazard: Optional[str] = Query(None, description="comma-separated hazard types"),
    from_: Optional[datetime] = Query(None, alias="from"),
    to: Optional[datetime] = Query(None),
    bbox: Optional[str] = Query(None, description="west,south,east,north"),
    min_intensity: float = Query(0.0, ge=0.0, le=1.0),
    limit: int = Query(50000, ge=1, le=50000),
):
    """Return matching events as a GeoJSON FeatureCollection."""
    # Ingestion runs every 12h, so the dataset changes slowly. Let Vercel's
    # edge cache the response for 10 min (s-maxage), and serve stale up to
    # 1h while it revalidates. Browsers get a short 60s cache so reloads
    # within the same session are instant without going to the network.
    response.headers["Cache-Control"] = (
        "public, max-age=60, s-maxage=600, stale-while-revalidate=3600"
    )

    where = ["geom IS NOT NULL", "intensity_norm >= %s"]
    params: list = [min_intensity]

    if hazard:
        hazards = [h.strip() for h in hazard.split(",") if h.strip() in VALID_HAZARDS]
        if hazards:
            where.append("hazard_type = ANY(%s)")
            params.append(hazards)
    if from_:
        where.append("COALESCE(ended_at, started_at) >= %s")
        params.append(from_)
    if to:
        where.append("started_at <= %s")
        params.append(to)
    if bbox:
        try:
            w, s, e, n = (float(x) for x in bbox.split(","))
        except ValueError:
            raise HTTPException(400, "bbox must be 'west,south,east,north'")
        where.append("geom && ST_MakeEnvelope(%s,%s,%s,%s,4326)")
        params.extend([w, s, e, n])

    params.append(limit)
    # Order by recency so that any truncation drops the oldest events
    # deterministically (predictable for the time slider). We omit unused
    # columns (id, ended_at, metadata) to keep the payload small — the map
    # only needs what the tooltip and filters read. `url` is included so the
    # detail panel can link to the provider's report page for the specific
    # event (currently only populated by GDACS).
    sql = f"""
        SELECT source, hazard_type, title, severity_raw, intensity_norm,
               started_at, country, url,
               ST_AsGeoJSON(geom) AS geojson
        FROM events
        WHERE {' AND '.join(where)}
        ORDER BY started_at DESC NULLS LAST
        LIMIT %s
    """
    rows = query(sql, tuple(params))

    features = [
        {
            "type": "Feature",
            "geometry": json.loads(r["geojson"]),
            "properties": {
                "source": r["source"],
                "hazard_type": r["hazard_type"],
                "title": r["title"],
                "severity_raw": r["severity_raw"],
                "intensity_norm": r["intensity_norm"],
                "started_at": r["started_at"].isoformat() if r["started_at"] else None,
                "country": r["country"],
                "url": r["url"],
            },
        }
        for r in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@app.get("/enso")
def enso(response: Response):
    """The ENSO (El Niño / La Niña) state as the Oceanic Niño Index series.

    Returns the full ONI history plus a `current` summary. ENSO is a single
    global index, not a located hazard, so it has its own table and endpoint —
    the events pipeline never special-cases it. Each season is placed on the
    timeline at its centre month so the frontend can align it with the events.
    """
    response.headers["Cache-Control"] = (
        "public, max-age=60, s-maxage=600, stale-while-revalidate=3600"
    )
    rows = query("SELECT year, season, anom FROM enso_oni", ())

    # Order by real calendar time (year, then season position), dropping any row
    # whose season label we don't recognise.
    points = sorted(
        (
            {
                "date": f"{r['year']:04d}-{_SEASON_MONTH[r['season']]:02d}-01",
                "anom": float(r["anom"]),
                "season": r["season"],
                "year": r["year"],
            }
            for r in rows
            if r["season"] in _SEASON_MONTH
        ),
        key=lambda p: p["date"],
    )

    series = [{"date": p["date"], "anom": p["anom"]} for p in points]
    current = None
    if points:
        latest = points[-1]
        current = {
            "season": latest["season"],
            "year": latest["year"],
            "date": latest["date"],
            "anom": latest["anom"],
            "phase": enso_phase(latest["anom"]),
        }

    return {"current": current, "series": series, "monthly": _enso_monthly()}


def _enso_monthly() -> Optional[dict]:
    """The fresher, supplementary monthly Niño-3.4 SST anomaly.

    Distinct from the ONI: a single calendar-month anomaly on a fixed 1991–2020
    base, with no 3-month centring lag — so it's the most current read, but not a
    drop-in ONI value and never used to classify the phase. We return only a
    short recent tail (nothing plots the full history) plus the latest reading.
    Guarded: if the table isn't migrated yet, the ONI still serves.
    """
    try:
        rows = query("SELECT year, month, anom FROM enso_nino34", ())
    except Exception:
        return None

    points = sorted(
        (
            {
                "date": f"{r['year']:04d}-{r['month']:02d}-01",
                "anom": float(r["anom"]),
                "year": r["year"],
                "month": r["month"],
            }
            for r in rows
            if 1 <= r["month"] <= 12
        ),
        key=lambda p: p["date"],
    )
    if not points:
        return None

    recent = points[-24:]
    latest = points[-1]
    return {
        "current": {
            "year": latest["year"],
            "month": latest["month"],
            "date": latest["date"],
            "anom": latest["anom"],
        },
        "series": [{"date": p["date"], "anom": p["anom"]} for p in recent],
    }


@app.get("/stats")
def stats(response: Response):
    """Counts and mean intensity per hazard — powers the 'scale of the problem' panel."""
    response.headers["Cache-Control"] = (
        "public, max-age=60, s-maxage=600, stale-while-revalidate=3600"
    )
    rows = query(
        """
        SELECT hazard_type,
               COUNT(*)            AS count,
               AVG(intensity_norm) AS mean_intensity,
               MAX(started_at)     AS latest
        FROM events
        GROUP BY hazard_type
        ORDER BY count DESC
        """,
        (),
    )
    return {
        "by_hazard": [
            {
                "hazard_type": r["hazard_type"],
                "count": r["count"],
                "mean_intensity": float(r["mean_intensity"]) if r["mean_intensity"] is not None else None,
                "latest": r["latest"].isoformat() if r["latest"] else None,
            }
            for r in rows
        ]
    }
