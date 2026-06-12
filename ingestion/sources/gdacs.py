"""GDACS — Global Disaster Alert and Coordination System (UN/EC).

Multi-hazard backbone. We keep the hazards the project cares about and drop
earthquakes/volcanoes.

GDACS exposes two complementary GeoJSON feeds with the same feature shape:
  - SEARCH returns the historical catalogue. It silently defaults to
    Orange/Red only, so we pass alertlevel=Green;Orange;Red explicitly —
    otherwise closed Green events (the majority) are unreachable.
  - MAP returns currently-active events of *all* severities, including Green.
We fetch both and merge, deduping by source_event_id, so the map shows both
historical events and anything happening right now.

SEARCH returns results newest-first and is hard-capped by pagination, so a
single wide query silently drops the *oldest* events once the page budget is
spent (the bug that motivated chunked backfill). We avoid the cap by querying
SEARCH in **monthly windows, one hazard type at a time**:
  - `todate`/`fromdate` bound each window so no window holds more than a few
    hundred events — well under any practical page count (wildfires, the
    busiest type, peak around ~250/month).
  - `eventlist=<TYPE>` restricts to a single type, so we never burn pages on
    the high-volume earthquake/volcano events we discard anyway.
Routine 12h runs only window the last `lookback_days`; `backfill=True` walks
every month back to BACKFILL_FROMDATE. Upserts are idempotent, so a backfill
can be re-run safely.

Docs / Swagger: https://www.gdacs.org/gdacsapi/swagger/index.html
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

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

# Oldest month a --backfill run reaches back to. GDACS holds events older than
# this, but 2021 is as far back as the project cares to store.
BACKFILL_FROMDATE = date(2021, 1, 1)

# Per-(type, month) page safety cap. Real volume never approaches this (busiest
# is ~250 wildfires/month ≈ 3 pages); it only guards against a runaway loop.
MAX_PAGES_PER_WINDOW = 50

_PAGE_SIZE = 100

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


def fetch(lookback_days: int = 7, backfill: bool = False) -> list[Event]:
    # Merge the significant historical catalogue (SEARCH) with the currently
    # active all-severity feed (MAP), deduping by source_event_id.
    today = datetime.now(timezone.utc).date()
    fromdate = BACKFILL_FROMDATE if backfill else today - timedelta(days=lookback_days)

    by_id: dict[str, Event] = {}
    for feat in _fetch_search(fromdate, today) + _fetch_map():
        ev = _to_event(feat)
        if ev:
            by_id.setdefault(ev.source_event_id, ev)
    return list(by_id.values())


def _month_windows(start: date, end: date) -> list[tuple[date, date]]:
    """Split [start, end] into [first-of-month, first-of-next-month] windows,
    clamped to the requested bounds. Windows may overlap an event's active
    span; dedup by source_event_id absorbs the duplicates."""
    windows: list[tuple[date, date]] = []
    cursor = date(start.year, start.month, 1)
    while cursor <= end:
        nxt = date(cursor.year + 1, 1, 1) if cursor.month == 12 else date(cursor.year, cursor.month + 1, 1)
        windows.append((max(cursor, start), min(nxt, end)))
        cursor = nxt
    return windows


def _fetch_search(fromdate: date, todate: date) -> list[dict]:
    """Chunked SEARCH: one paginated query per (hazard type, month window)."""
    features: list[dict] = []
    windows = _month_windows(fromdate, todate)
    seen_year: int | None = None
    for win_start, win_end in windows:
        if len(windows) > 12 and win_start.year != seen_year:
            # Progress for long backfills; routine runs span a single window.
            seen_year = win_start.year
            print(f"[gdacs] backfilling SEARCH {win_start.year}…")
        for etype in TYPE_MAP:  # only the hazards we keep — skips EQ/VO volume
            features.extend(_fetch_search_window(etype, win_start, win_end))
    return features


def _fetch_search_window(etype: str, fromdate: date, todate: date) -> list[dict]:
    """Page through one (type, window) slice of SEARCH until exhausted."""
    features: list[dict] = []
    for page in range(1, MAX_PAGES_PER_WINDOW + 1):
        resp = requests.get(
            SEARCH_URL,
            params={
                "pagesize": _PAGE_SIZE,
                "pagenumber": page,
                "alertlevel": "Green;Orange;Red",
                "eventlist": etype,
                "fromdate": fromdate.isoformat(),
                "todate": todate.isoformat(),
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
        if len(page_features) < _PAGE_SIZE:
            break  # short page → last page for this window
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
