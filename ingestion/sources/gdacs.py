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
Routine 12h runs (`fetch`) only window the last `lookback_days`. Deep history
comes from `fetch_backfill`, which walks back to BACKFILL_FROMDATE and yields
one year at a time so the orchestrator can upsert incrementally rather than
buffer years of events (and hold the DB connection idle) — see its docstring.
Upserts are idempotent, so a backfill can be re-run or resumed safely.

Docs / Swagger: https://www.gdacs.org/gdacsapi/swagger/index.html
"""
from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone

import requests
import reverse_geocode

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

# Oldest month a --backfill run reaches back to. Set to 2015 to span the strong
# 2015-16 El Niño (the start of the ENSO window the timeline strip visualizes);
# the catalogue itself goes back to 1985-01-01 (eventid=1), but 2015 is as far
# back as the project cares to store. CAUTION: GDACS's detection of low-severity
# (Green) events ramps up across this window — ~100 floods/yr in 2015 vs ~600 in
# 2023 — so raw event *counts* are not comparable across ENSO phases (the 2015-16
# El Niño looks artificially quiet). Compare Orange/Red intensity, which is flat
# back to the 1990s. See EM-DAT's "exclude pre-2000 / low-impact" guidance.
BACKFILL_FROMDATE = date(2015, 1, 1)

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


def _clean_title(name: str | None) -> str | None:
    """GDACS auto-generates names like "Flood in Australia, Serbia" — purely the
    hazard word + its (often wrong) country list, which the map already renders
    from hazard_type + country. Those add nothing and parrot GDACS's bogus
    geography, so drop them; the frontend falls back to the hazard label. Names
    that carry real information (e.g. "Tropical Cyclone CHIDO-25") have no " in "
    and are kept."""
    if not name:
        return None
    return None if " in " in name.lower() else name


def _repr_latlon(geom: dict) -> tuple[float, float] | None:
    """A single (lat, lon) representative point for reverse geocoding. GDACS
    geteventlist returns Point geometry; handle the common cases defensively."""
    coords = geom.get("coordinates")
    gtype = geom.get("type")
    try:
        if gtype == "Point":
            lon, lat = coords[0], coords[1]
        elif gtype in ("Polygon", "MultiPolygon"):
            ring = coords[0][0] if gtype == "MultiPolygon" else coords[0]
            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
        else:
            return None
        return float(lat), float(lon)
    except (TypeError, IndexError, ValueError, ZeroDivisionError):
        return None


def _verify_countries(events: list[Event]) -> list[Event]:
    """Replace GDACS's self-reported country with the country the *localized*
    event's point actually falls in (offline reverse geocode, same lookup FIRMS
    uses). For floods/wildfires/droughts GDACS's list is unreliable — it tags
    physically impossible countries (a Lisbon flood as "Portugal, United
    Kingdom"; a Balkans flood as "Australia, Serbia"). Such an event sits at one
    point and can only be in one country, so the point is both cleaner and more
    correct. The original GDACS string is kept in metadata for traceability.

    Storms are exempt: a tropical cyclone genuinely tracks across multiple
    countries, so GDACS's multi-country list (e.g. "Philippines, China, Japan")
    is real information that a single point would wrongly collapse."""
    pts: list[tuple[float, float]] = []
    idx: list[int] = []
    for i, ev in enumerate(events):
        if ev.hazard_type == HAZARD_STORM:
            continue
        ll = _repr_latlon(ev.geometry)
        if ll:
            pts.append(ll)
            idx.append(i)
    if not pts:
        return events
    for i, hit in zip(idx, reverse_geocode.search(pts)):
        country = hit.get("country")
        if country:
            events[i].metadata["gdacs_country"] = events[i].country
            events[i].country = country
    return events


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
    return _verify_countries(list(by_id.values()))


def fetch_backfill() -> Iterator[tuple[int, list[Event]]]:
    """Deep history pull, yielded **one year at a time** instead of returned as
    one giant list.

    The orchestrator upserts each year as it arrives, so we never buffer five
    years of events in memory and — critically — never hold the DB connection
    open and idle through the ~minutes-long fetch of a year (Neon drops idle
    connections, which used to kill the whole backfill at the final write).
    Upserts are idempotent, so a run interrupted mid-history just resumes.
    """
    today = datetime.now(timezone.utc).date()
    for year in range(BACKFILL_FROMDATE.year, today.year + 1):
        win_from = max(BACKFILL_FROMDATE, date(year, 1, 1))
        # Mirror _month_windows' exclusive-end semantics: through first-of-next-
        # year, clamped to today for the current (partial) year.
        win_to = today if year == today.year else date(year + 1, 1, 1)
        print(f"[gdacs] backfilling SEARCH {year}…")
        by_id: dict[str, Event] = {}
        for feat in _fetch_search(win_from, win_to):
            ev = _to_event(feat)
            if ev:
                by_id.setdefault(ev.source_event_id, ev)
        yield year, _verify_countries(list(by_id.values()))


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
    """Chunked SEARCH: one paginated query per (hazard type, month window).

    Backfill drives this one year at a time via fetch_backfill(); routine runs
    pass a single recent window.
    """
    features: list[dict] = []
    for win_start, win_end in _month_windows(fromdate, todate):
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
    """MAP returns all currently-active events. GDACS now requires exactly one
    `eventtype` per call (a bare or multi-value request 400s), so we fetch
    once per hazard type and merge."""
    features: list[dict] = []
    for etype in TYPE_MAP:
        resp = requests.get(MAP_URL, params={"eventtype": etype}, timeout=60, headers=_HEADERS)
        resp.raise_for_status()
        if resp.status_code == 204 or not resp.text.strip():
            continue
        try:
            features.extend(resp.json().get("features", []))
        except ValueError:
            continue
    return features


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
        title=_clean_title(props.get("name") or props.get("htmldescription") or props.get("description")),
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
