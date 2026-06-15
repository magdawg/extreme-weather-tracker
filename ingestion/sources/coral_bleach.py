"""NOAA Coral Reef Watch — satellite coral bleaching alert areas.

NOAA CRW publishes a daily global 5 km Bleaching Alert Area (BAA) product
classifying every reef-bearing cell into seven levels (No Stress → Alert Level
5). For a spike we don't ingest the full grid — most of it is ocean with no
reef. Instead we query a small curated list of major reef regions via ERDDAP
and emit one event per (reef, day) where BAA ≥ Watch.

BAA scale (CRW):
    0 = No Stress
    1 = Bleaching Watch
    2 = Bleaching Warning
    3 = Alert Level 1   (significant bleaching)
    4 = Alert Level 2   (severe bleaching / mortality likely)
    5 = Alert Level 3
    6 = Alert Level 4
    7 = Alert Level 5
We clamp 0..5+ for now (level 6/7 are recent additions) and divide by 5.

Data: NOAA CoastWatch ERDDAP `NOAA_DHW` griddap dataset.
Docs: https://coralreefwatch.noaa.gov/product/5km/
"""
from __future__ import annotations

import csv
import io
import math
import sys
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone

import requests

from normalize import HAZARD_CORAL_BLEACH, Event, clamp01, point

ERDDAP_URL = (
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/NOAA_DHW.csv"
)

_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# A small curated list of globally significant reef regions. Each is a point at
# the centre of the reef system; ERDDAP returns the BAA cell containing it.
# Spike-grade — easy to swap for a richer reef inventory later.
REEFS: list[tuple[str, str, float, float]] = [
    ("gbr-cairns", "Great Barrier Reef (Cairns sector)", -16.50, 145.95),
    ("gbr-mackay", "Great Barrier Reef (Mackay sector)", -20.27, 149.42),
    ("ningaloo", "Ningaloo Reef, Australia", -22.55, 113.83),
    ("new-caledonia", "New Caledonia Barrier Reef", -22.32, 166.45),
    ("fiji", "Fiji reefs", -17.71, 178.07),
    ("samoa", "Samoa reefs", -13.83, -171.75),
    ("kiribati-line", "Line Islands, Kiribati", -1.83, -157.40),
    ("hawaii", "Hawaiian Islands", 20.85, -156.80),
    ("palau", "Palau", 7.50, 134.55),
    ("philippines", "Philippines (Tubbataha)", 8.85, 119.92),
    ("indonesia-rajaampat", "Raja Ampat, Indonesia", -0.50, 130.50),
    ("maldives", "Maldives", 3.20, 73.20),
    ("seychelles", "Seychelles", -4.30, 55.60),
    ("red-sea-egypt", "Red Sea (Egypt)", 27.10, 33.95),
    ("zanzibar", "East African coast (Zanzibar)", -6.20, 39.40),
    ("madagascar-nw", "NW Madagascar reefs", -13.40, 48.30),
    ("caribbean-bahamas", "Caribbean (Bahamas)", 24.50, -77.50),
    ("caribbean-belize", "Mesoamerican Reef (Belize)", 17.20, -87.95),
    ("caribbean-cuba", "Cuban reefs (Jardines)", 21.50, -82.30),
    ("brazil-abrolhos", "Abrolhos Bank, Brazil", -17.95, -38.70),
    ("galapagos", "Galápagos reefs", -0.70, -90.30),
    ("florida-keys", "Florida Keys", 24.70, -81.30),
    ("bermuda", "Bermuda", 32.35, -64.75),
]

# BAA ≥ this is what we publish as an event (Watch and up — anything that
# matters for downstream reef stress). 0/no-stress days don't become events.
BAA_MIN_EMIT = 1
BAA_SATURATION = 5.0  # for the 0..1 intensity scale

# Oldest date a --backfill run reaches back to. Matches the temperature source
# (ERA5) so the heat / coral / marine-heat layers all share a window and the
# story "this is the world since the 2021 La Niña" reads coherently.
BACKFILL_FROMDATE = date(2021, 1, 1)


def fetch(lookback_days: int = 7) -> list[Event]:
    """One ERDDAP query per reef across the last lookback window."""
    today = datetime.now(timezone.utc).date()
    fromdate = today - timedelta(days=max(1, lookback_days))
    return _fetch_window(fromdate, today)


def fetch_backfill(from_year: int | None = None) -> Iterator[tuple[int, list[Event]]]:
    """Deep history pull from the CRW satellite record, yielded **one year at
    a time** so the orchestrator can upsert per year instead of buffering
    five+ years of events.

    Mirrors the temperature backfill pattern: per-year ERDDAP windows keep
    each call small (one CSV per reef-year ≈ 365 rows ≈ a few KB), and
    upserts run between years so we never hold the Neon connection idle
    through a multi-minute fetch. Upserts are idempotent — a run interrupted
    mid-history resumes safely on re-run.

    `from_year` lets a re-run skip already-stored years (e.g. backfill
    2021-24 completed, only re-run 2025-26). Defaults to BACKFILL_FROMDATE.year.
    """
    today = datetime.now(timezone.utc).date()
    start_year = from_year if from_year is not None else BACKFILL_FROMDATE.year
    for year in range(start_year, today.year + 1):
        win_from = max(BACKFILL_FROMDATE, date(year, 1, 1))
        win_to = today if year == today.year else date(year, 12, 31)
        print(f"[coral_bleach] backfilling CRW {year}…")
        yield year, _fetch_window(win_from, win_to)


def _fetch_window(fromdate: date, todate: date) -> list[Event]:
    """Per-reef ERDDAP query across [fromdate, todate]; flatten to Events."""
    events: list[Event] = []
    misses = 0
    for slug, name, lat, lon in REEFS:
        try:
            rows = _query_reef(lat, lon, fromdate, todate)
        except requests.HTTPError as exc:
            # 404 = the requested time range isn't in this ERDDAP mirror yet
            # (CRW occasionally falls back to a PacIOOS mirror that lags the
            # primary by months). Not a failure — just no data for this window.
            if exc.response is not None and exc.response.status_code == 404:
                misses += 1
                continue
            print(f"[coral_bleach] {slug} HTTP error: {exc}", file=sys.stderr)
            continue
        except requests.RequestException as exc:
            print(f"[coral_bleach] {slug} fetch failed: {exc}", file=sys.stderr)
            continue
        for day, baa in rows:
            if baa is None or baa < BAA_MIN_EMIT:
                continue
            ts = day.replace(tzinfo=timezone.utc)
            events.append(
                Event(
                    source="noaa-crw",
                    source_event_id=f"{slug}-{day.date().isoformat()}",
                    hazard_type=HAZARD_CORAL_BLEACH,
                    geometry=point(lon, lat),
                    title=f"{name}: BAA level {int(baa)}",
                    severity_raw=_baa_label(int(baa)),
                    intensity_norm=clamp01(baa / BAA_SATURATION),
                    started_at=ts,
                    ended_at=ts,
                    url="https://coralreefwatch.noaa.gov/product/5km/",
                    metadata={"reef": name, "baa": int(baa)},
                )
            )
    if misses:
        # One summary line per window instead of one URL per miss in the log.
        print(
            f"[coral_bleach] {misses}/{len(REEFS)} reefs returned no data for "
            f"{fromdate}..{todate} (likely outside the current ERDDAP mirror's "
            f"coverage)",
            file=sys.stderr,
        )
    return events


def _query_reef(lat: float, lon: float, fromdate, todate) -> list[tuple[datetime, float | None]]:
    """ERDDAP griddap CSV: one row per day in the lookback window for this cell."""
    # ERDDAP indexes use square brackets and slicing with (value) for lookup
    # by coordinate. CRW_BAA dimensions: [time][latitude][longitude].
    selector = (
        f"CRW_BAA[({fromdate.isoformat()}T12:00:00Z)"
        f":1:({todate.isoformat()}T12:00:00Z)]"
        f"[({lat})][({lon})]"
    )
    # 60 s caught two reefs mid-backfill — CRW's redirect dance to PacIOOS
    # adds latency that pushes the slow reefs past it. 120 s covers the long
    # tail without hanging a stuck run.
    resp = requests.get(
        f"{ERDDAP_URL}?{selector}",
        timeout=120,
        headers=_HEADERS,
    )
    resp.raise_for_status()
    out: list[tuple[datetime, float | None]] = []
    reader = csv.reader(io.StringIO(resp.text))
    header = next(reader, None)
    _units = next(reader, None)
    if not header:
        return out
    for row in reader:
        if len(row) < 4:
            continue
        try:
            ts = datetime.strptime(row[0][:19], "%Y-%m-%dT%H:%M:%S")
        except ValueError:
            continue
        try:
            baa = float(row[3])
            # ERDDAP CSV uses the literal "NaN" for masked/land cells.
            # `float("NaN")` parses without raising, then NaN comparisons
            # always return False — so a downstream filter like `baa < N`
            # silently lets NaN through. Reject it explicitly here.
            if math.isnan(baa):
                baa = None
        except ValueError:
            baa = None
        out.append((ts, baa))
    return out


def _baa_label(level: int) -> str:
    return {
        0: "No Stress",
        1: "Bleaching Watch",
        2: "Bleaching Warning",
        3: "Alert Level 1",
        4: "Alert Level 2",
        5: "Alert Level 3",
        6: "Alert Level 4",
        7: "Alert Level 5",
    }.get(level, f"BAA {level}")
