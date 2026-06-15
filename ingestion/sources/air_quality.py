"""OpenAQ — hazardous-tier PM2.5 from ground monitoring stations.

OpenAQ v3 exposes `/parameters/{id}/latest` — the most recent reading from
every sensor for a given parameter. PM2.5 is parameter id 2. We pull the
latest page-by-page, drop anything below a hazardous-tier cutoff (mostly
wildfire smoke and severe industrial events at this threshold), and emit one
Event per (station, reading-day).

Pairs naturally with FIRMS on the map — fire upstream, hazardous-air
downstream. A read at 250+ µg/m³ basically only happens during wildfire
smoke plumes or major industrial / dust events; below that the global noise
floor is too high for a map of "extreme" events.

API: https://docs.openaq.org/   (free, key required: X-API-Key)
"""
from __future__ import annotations

import os
import sys
from datetime import datetime
from email.utils import parsedate_to_datetime

import requests

from normalize import HAZARD_AIR_QUALITY, Event, clamp01, point

LATEST_URL = "https://api.openaq.org/v3/parameters/2/latest"

_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# US EPA AQI bands for PM2.5: Very Unhealthy starts at 150.5 µg/m³;
# Hazardous at 250.5 µg/m³. 150 catches both tiers without flooding the map
# with the "Unhealthy" 55-150 layer, which is daily life in many cities.
PM25_THRESHOLD = 150.0
PM25_SATURATION = 500.0  # µg/m³ — extreme smoke plumes peak here

PAGE_SIZE = 1000
MAX_PAGES = 5  # OpenAQ has thousands of sensors; 5 pages × 1000 = 5000 is enough


def fetch(lookback_days: int | None = None) -> list[Event]:
    """Pull the latest PM2.5 reading from every sensor and emit hazardous ones.

    `lookback_days` is accepted for orchestrator symmetry but the OpenAQ
    `/latest` endpoint is inherently "right now" — there's no past-days
    parameter. Stale-reading filtering is done implicitly by the endpoint.
    """
    key = os.environ.get("OPENAQ_API_KEY")
    if not key:
        print(
            "[air_quality] OPENAQ_API_KEY not set — skipping (free key at "
            "https://openaq.org).",
            file=sys.stderr,
        )
        return []

    headers = dict(_HEADERS)
    headers["X-API-Key"] = key

    events: list[Event] = []
    seen: set[str] = set()

    for page in range(1, MAX_PAGES + 1):
        try:
            resp = requests.get(
                LATEST_URL,
                params={"limit": PAGE_SIZE, "page": page},
                timeout=60,
                headers=headers,
            )
            resp.raise_for_status()
        except requests.RequestException as exc:
            print(f"[air_quality] page {page} fetch failed: {exc}", file=sys.stderr)
            break

        body = resp.json()
        results = body.get("results", [])
        if not results:
            break

        for row in results:
            value = row.get("value")
            coords = row.get("coordinates") or {}
            lat = coords.get("latitude")
            lon = coords.get("longitude")
            if value is None or lat is None or lon is None:
                continue
            try:
                value_f = float(value)
            except (TypeError, ValueError):
                continue
            if value_f < PM25_THRESHOLD:
                continue
            sensor_id = row.get("sensorsId") or row.get("sensorId")
            location_id = row.get("locationsId") or row.get("locationId")
            ts = _parse_dt(row.get("datetime"))
            day_key = ts.date().isoformat() if ts else "now"
            event_id = f"{sensor_id or location_id}-{day_key}"
            if event_id in seen:
                continue
            seen.add(event_id)
            events.append(
                Event(
                    source="openaq",
                    source_event_id=event_id,
                    hazard_type=HAZARD_AIR_QUALITY,
                    geometry=point(lon, lat),
                    title=f"Hazardous PM2.5 ({value_f:.0f} µg/m³)",
                    severity_raw=f"PM2.5 {value_f:.0f} µg/m³",
                    intensity_norm=clamp01(
                        (value_f - PM25_THRESHOLD) / (PM25_SATURATION - PM25_THRESHOLD)
                    ),
                    started_at=ts,
                    ended_at=ts,
                    url="https://openaq.org",
                    metadata={
                        "pm25_ugm3": round(value_f, 1),
                        "sensors_id": sensor_id,
                        "locations_id": location_id,
                    },
                )
            )

        # OpenAQ paginates via `meta.found` + `meta.page`. Stop when we've
        # consumed everything they say is available.
        meta = body.get("meta") or {}
        found = meta.get("found")
        page_returned = len(results)
        if (
            page_returned < PAGE_SIZE
            or (isinstance(found, int) and page * PAGE_SIZE >= found)
        ):
            break

    return events


def _parse_dt(value):
    """OpenAQ exposes datetime as either an ISO string or a dict {utc, local}.
    Coerce both to a timezone-aware UTC datetime, or None if unparseable."""
    if value is None:
        return None
    if isinstance(value, dict):
        value = value.get("utc") or value.get("local")
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            return parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
