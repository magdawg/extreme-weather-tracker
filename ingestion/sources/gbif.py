"""GBIF — mass-mortality / die-off signal from biodiversity occurrences.

GBIF doesn't ship a "mortality event" feed. We synthesize one by querying its
occurrence search for recent records whose free-text fields mention mortality
keywords ("mortality", "die-off", "stranding", "mass death", etc.), and then
spatially binning matches so a cluster of records in one place collapses into
a single Event.

The same pattern works for HPAI (avian flu) seabird die-offs, marine-mammal
strandings, and coral mortality — the keyword set is the knob. Each match has
real lat/lon (we require `hasCoordinate=true`) and a real `eventDate`, so the
resulting cluster has a defensible centre and timestamp.

This is intentionally a thin spike. The clean upgrade is per-taxon climatology
(record density today vs the long-term baseline at this cell) to surface
anomalies rather than text matches, mirroring the heat percentile TODO.

API: https://api.gbif.org/v1/occurrence/search   (open, no key)
Field ref: https://techdocs.gbif.org/en/openapi/v1/occurrence
"""
from __future__ import annotations

import math
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import requests

from normalize import HAZARD_MORTALITY, Event, clamp01, point

SEARCH_URL = "https://api.gbif.org/v1/occurrence/search"

_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# GBIF `q` is OR-style across these terms via the `|` token in their parser.
# We run one query per term so we can attribute the trigger keyword to each
# cluster (useful for explaining what was found).
KEYWORDS = (
    "mortality",
    "die-off",
    "stranding",
    "mass death",
    "fish kill",
    "bleached",
)

# Spatial binning: ~1° cells (≈110 km) so a regional die-off (e.g. an HPAI
# event along a coastline) collapses into one cluster rather than a swarm.
GRID_DEG = 1.0

# Minimum records in a (cell, week) cluster before we emit it. Single sightings
# aren't a "mass" event, and GBIF's text matches do include benign references
# (a paper title containing "mortality"). 3 is the sweet spot for the spike.
MIN_RECORDS = 3

# Cluster intensity saturates at this many records — the busiest HPAI seabird
# events we've seen run 50–200 records per locality per week.
RECORDS_SATURATION = 50

PAGE_SIZE = 300


def fetch(lookback_days: int = 30) -> list[Event]:
    """Sweep the last lookback window once per keyword, then bin + threshold."""
    today = datetime.now(timezone.utc).date()
    fromdate = today - timedelta(days=max(7, lookback_days))

    # bucket: (gx, gy, week_iso) -> aggregate
    buckets: dict[tuple[int, int, str], dict] = defaultdict(_new_bucket)
    keyword_for_bucket: dict[tuple[int, int, str], str] = {}

    for kw in KEYWORDS:
        try:
            records = _search_paged(kw, fromdate, today)
        except requests.RequestException as exc:
            print(f"[gbif] '{kw}' fetch failed: {exc}", file=sys.stderr)
            continue
        for rec in records:
            lat = rec.get("decimalLatitude")
            lon = rec.get("decimalLongitude")
            event_date = rec.get("eventDate")
            if lat is None or lon is None or not event_date:
                continue
            day = _parse_event_date(event_date)
            if not day:
                continue
            gx = int(math.floor(float(lon) / GRID_DEG))
            gy = int(math.floor(float(lat) / GRID_DEG))
            week = day.strftime("%G-W%V")
            key = (gx, gy, week)
            b = buckets[key]
            b["count"] += 1
            b["lon_sum"] += float(lon)
            b["lat_sum"] += float(lat)
            b["taxa"].add(rec.get("scientificName") or "")
            country = rec.get("country")
            if country:
                b["countries"][country] = b["countries"].get(country, 0) + 1
            b["first"] = day if b["first"] is None else min(b["first"], day)
            b["last"] = day if b["last"] is None else max(b["last"], day)
            keyword_for_bucket.setdefault(key, kw)

    events: list[Event] = []
    for key, b in buckets.items():
        if b["count"] < MIN_RECORDS:
            continue
        gx, gy, week = key
        lon = b["lon_sum"] / b["count"]
        lat = b["lat_sum"] / b["count"]
        # Pick the modal country among matched records as a label hint.
        country = max(b["countries"].items(), key=lambda kv: kv[1])[0] if b["countries"] else None
        kw = keyword_for_bucket.get(key, "")
        events.append(
            Event(
                source="gbif",
                source_event_id=f"{gx}_{gy}_{week}",
                hazard_type=HAZARD_MORTALITY,
                geometry=point(lon, lat),
                title=f"Mortality cluster: {b['count']} records ({kw})",
                severity_raw=f"{b['count']} occurrences in {week}",
                intensity_norm=clamp01(math.log1p(b["count"]) / math.log1p(RECORDS_SATURATION)),
                started_at=b["first"].replace(tzinfo=timezone.utc) if b["first"] else None,
                ended_at=b["last"].replace(tzinfo=timezone.utc) if b["last"] else None,
                country=country,
                url=f"https://www.gbif.org/occurrence/search?q={kw}",
                metadata={
                    "keyword": kw,
                    "records": b["count"],
                    "taxa_sample": sorted(t for t in b["taxa"] if t)[:5],
                    "iso_week": week,
                },
            )
        )
    return events


def _new_bucket() -> dict:
    return {
        "count": 0,
        "lon_sum": 0.0,
        "lat_sum": 0.0,
        "taxa": set(),
        "countries": {},
        "first": None,
        "last": None,
    }


def _search_paged(keyword: str, fromdate, todate) -> list[dict]:
    """Paginate GBIF occurrence/search until exhausted or 10 pages — whichever
    comes first. 10 × 300 = 3000 records per keyword is enough for the spike's
    weekly window; raise if you grow this to a real monitor."""
    out: list[dict] = []
    for page in range(10):
        params = {
            "q": keyword,
            "hasCoordinate": "true",
            "hasGeospatialIssue": "false",
            "eventDate": f"{fromdate.isoformat()},{todate.isoformat()}",
            "limit": PAGE_SIZE,
            "offset": page * PAGE_SIZE,
        }
        resp = requests.get(SEARCH_URL, params=params, timeout=60, headers=_HEADERS)
        resp.raise_for_status()
        body = resp.json()
        results = body.get("results", [])
        out.extend(results)
        if body.get("endOfRecords", True) or len(results) < PAGE_SIZE:
            break
    return out


def _parse_event_date(value):
    """GBIF eventDate is sometimes a range ("2026-05-02/2026-05-09") — take
    the start. Always returns a `date` (or None if unparseable)."""
    if not isinstance(value, str):
        return None
    first = value.split("/")[0][:10]
    try:
        return datetime.strptime(first, "%Y-%m-%d").date()
    except ValueError:
        return None
