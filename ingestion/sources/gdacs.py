"""GDACS — Global Disaster Alert and Coordination System (UN/EC).

Multi-hazard backbone. We keep the hazards the project cares about and drop
earthquakes/volcanoes.

GDACS exposes two complementary GeoJSON feeds with the same feature shape:
  - SEARCH returns the historical catalogue. It silently defaults to
    Orange/Red only, so we pass alertlevel=Green;Orange;Red explicitly —
    otherwise closed Green events (the majority) are unreachable.
  - MAP returns currently-active events of *all* severities, including Green.
We fetch both and merge, deduping by source_event_id, so the map shows both
historical events back to SEARCH_FROMDATE and anything happening right now.

Docs / Swagger: https://www.gdacs.org/gdacsapi/swagger/index.html
"""
from __future__ import annotations

from datetime import datetime, timezone

import requests

from normalize import (
    HAZARD_DROUGHT,
    HAZARD_FLOOD,
    HAZARD_STORM,
    HAZARD_WILDFIRE,
    Event,
    gdacs_intensity,
)

SEARCH_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
MAP_URL = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/MAP"

# Cap how far back we backfill from SEARCH. With Greens included the catalogue
# stretches back many years; we only need recent-ish events on the map.
SEARCH_FROMDATE = "2024-01-01"

_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# GDACS event type code -> our hazard taxonomy. (EQ/VO intentionally excluded.)
TYPE_MAP = {
    "TC": HAZARD_STORM,     # tropical cyclone
    "FL": HAZARD_FLOOD,
    "WF": HAZARD_WILDFIRE,
    "DR": HAZARD_DROUGHT,
}


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(value[:26], fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def fetch(lookback_days: int = 7) -> list[Event]:
    # Merge the significant historical catalogue (SEARCH) with the currently
    # active all-severity feed (MAP), deduping by source_event_id.
    by_id: dict[str, Event] = {}
    for feat in _fetch_search() + _fetch_map():
        ev = _to_event(feat)
        if ev:
            by_id.setdefault(ev.source_event_id, ev)
    return list(by_id.values())


def _fetch_search() -> list[dict]:
    """Page through SEARCH (100 per page) until empty."""
    features: list[dict] = []
    for page in range(1, 51):
        resp = requests.get(
            SEARCH_URL,
            params={
                "pagesize": 100,
                "pagenumber": page,
                "alertlevel": "Green;Orange;Red",
                "fromdate": SEARCH_FROMDATE,
            },
            timeout=60,
            headers=_HEADERS,
        )
        resp.raise_for_status()
        # GDACS returns 204 No Content (empty body) once results run out.
        if resp.status_code == 204 or not resp.text.strip():
            break
        try:
            page_features = resp.json().get("features", [])
        except ValueError:
            break
        if not page_features:
            break
        features.extend(page_features)
    return features


def _fetch_map() -> list[dict]:
    """MAP returns all currently-active events in one (unpaginated) call."""
    resp = requests.get(MAP_URL, timeout=60, headers=_HEADERS)
    resp.raise_for_status()
    if resp.status_code == 204 or not resp.text.strip():
        return []
    try:
        return resp.json().get("features", [])
    except ValueError:
        return []


def _to_event(feat: dict) -> Event | None:
    props = feat.get("properties", {})
    geom = feat.get("geometry")
    if not geom:
        return None

    etype = props.get("eventtype")
    hazard = TYPE_MAP.get(etype)
    if hazard is None:
        return None  # earthquake/volcano/etc.

    event_id = str(props.get("eventid"))
    alert_level = props.get("alertlevel")
    try:
        alert_score = float(props.get("alertscore")) if props.get("alertscore") is not None else None
    except (TypeError, ValueError):
        alert_score = None

    return Event(
        source="gdacs",
        source_event_id=f"{etype}-{event_id}",
        hazard_type=hazard,
        geometry=geom,
        title=props.get("name") or props.get("htmldescription") or props.get("description"),
        severity_raw=alert_level,
        intensity_norm=gdacs_intensity(alert_level, alert_score),
        started_at=_parse_dt(props.get("fromdate")),
        ended_at=_parse_dt(props.get("todate")),
        country=props.get("country"),
        url=props.get("url", {}).get("report") if isinstance(props.get("url"), dict) else props.get("link"),
        metadata={
            "eventtype": etype,
            "alertscore": alert_score,
            "episodeid": props.get("episodeid"),
            "severity": props.get("severitydata", {}).get("severitytext")
            if isinstance(props.get("severitydata"), dict)
            else None,
        },
    )
