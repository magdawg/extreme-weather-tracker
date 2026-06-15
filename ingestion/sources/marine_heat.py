"""NOAA OISST — derived marine heatwave (MHW) cells.

The textbook MHW definition (Hobday 2016) is "SST above the local 90th
percentile of climatology for ≥5 consecutive days". Computing that properly
needs a long climatological baseline per pixel — too heavy for a spike.

Pragmatic stand-in: sample NOAA OISST v2.1 SST anomaly (already on a fixed
1971-2000 baseline) on a sparse global ocean grid, and flag cells where the
anomaly today exceeds a strong-MHW threshold. One event per (cell, day).

This is the marine-temperature analogue of the terrestrial heat source in
`temperature.py` — same threshold-and-clamp pattern, ocean grid instead of
land cities. The clean upgrade is the percentile method on a per-cell
climatology, mirroring the same TODO documented in temperature.py.

ERDDAP dataset: `ncdcOisst21Agg_LonPM180` at NOAA CoastWatch.
Field used:    `anom` (SST anomaly, °C, 1971-2000 baseline).
Docs: https://psl.noaa.gov/marine-heatwaves/
"""
from __future__ import annotations

import csv
import io
import sys
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone

import requests

from normalize import HAZARD_MARINE_HEAT, Event, clamp01, point

ERDDAP_URL = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg_LonPM180.csv"

_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# OISST grid is 0.25°; stride 40 gives a 10° sample — coarse but sufficient
# to surface the basin-scale marine heatwaves (e.g. NE Pacific blob, NW
# Atlantic) that drive most public attention.
STRIDE = 40

# °C anomaly above which we treat the cell as in a strong marine heatwave.
# Hobday Category I starts at the 90th-percentile threshold which globally
# averages ~1°C; 2°C reliably picks out Category II+ events without flooding
# the map with thin-edge cells. Tunable via env later if needed.
MHW_THRESHOLD_C = 2.0
MHW_SATURATION_C = 5.0  # +5°C anomaly = intensity 1.0

# Oldest date a --backfill run reaches back to. Matches temperature (ERA5) and
# coral_bleach so the heat / coral / marine-heat layers share a 2021-onwards
# story window.
BACKFILL_FROMDATE = date(2021, 1, 1)


def fetch(lookback_days: int = 3) -> list[Event]:
    """Sample SST anomaly on the OISST grid for the last few days; emit one
    event per (cell, day) where anom ≥ threshold. OISST lags real time by
    1-2 days, so a 3-day window catches the latest available daily field."""
    today = datetime.now(timezone.utc).date()
    fromdate = today - timedelta(days=max(1, lookback_days))
    try:
        rows = _query(fromdate, today)
    except requests.RequestException as exc:
        print(f"[marine_heat] ERDDAP fetch failed: {exc}", file=sys.stderr)
        return []
    return _rows_to_events(rows)


def fetch_backfill(from_year: int | None = None) -> Iterator[tuple[int, list[Event]]]:
    """Deep history pull from NOAA OISST v2.1, yielded **one year at a time**.

    Mirrors temperature/coral_bleach: per-year batches with monthly inner
    chunks (so each ERDDAP CSV stays small — a full year cube at stride 40
    would be ~5M cells in one response, monthly is a manageable ~14k). Per-
    year upsert means we never hold a Neon connection idle through the full
    multi-year fetch. Upserts are idempotent, so a run interrupted mid-history
    resumes safely.

    `from_year` lets a re-run skip already-stored years (e.g. backfill
    2021-24 completed, only re-run 2025-26). Defaults to BACKFILL_FROMDATE.year.
    """
    today = datetime.now(timezone.utc).date()
    start_year = from_year if from_year is not None else BACKFILL_FROMDATE.year
    for year in range(start_year, today.year + 1):
        win_from = max(BACKFILL_FROMDATE, date(year, 1, 1))
        # OISST lags real time by 1-2 days; clamp to today for the current
        # year and to year-end for past years.
        win_to = today if year == today.year else date(year, 12, 31)
        print(f"[marine_heat] backfilling OISST {year}…")
        events: list[Event] = []
        for m_from, m_to in _month_windows(win_from, win_to):
            try:
                rows = _query(m_from, m_to)
            except requests.RequestException as exc:
                print(
                    f"[marine_heat] {m_from}..{m_to} ERDDAP fetch failed: {exc}",
                    file=sys.stderr,
                )
                continue
            events.extend(_rows_to_events(rows))
        yield year, events


def _rows_to_events(rows) -> list[Event]:
    events: list[Event] = []
    for ts, lat, lon, anom in rows:
        if anom is None or anom < MHW_THRESHOLD_C:
            continue
        day_key = ts.date().isoformat()
        # 1° rounded cell-id so the same cell on the same day re-upserts
        # cleanly (ERDDAP may return slightly drifting coordinates).
        cell = f"{round(lat):+03d}_{round(lon):+04d}"
        events.append(
            Event(
                source="noaa-oisst",
                source_event_id=f"{cell}-{day_key}",
                hazard_type=HAZARD_MARINE_HEAT,
                geometry=point(lon, lat),
                title=f"Marine heatwave: SST +{anom:.1f}°C above baseline",
                severity_raw=f"anom {anom:+.2f}°C",
                intensity_norm=clamp01((anom - MHW_THRESHOLD_C) / (MHW_SATURATION_C - MHW_THRESHOLD_C)),
                started_at=ts,
                ended_at=ts,
                url="https://psl.noaa.gov/marine-heatwaves/",
                metadata={"sst_anom_c": round(anom, 2), "cell": cell},
            )
        )
    return events


def _month_windows(start: date, end: date) -> list[tuple[date, date]]:
    """Split [start, end] into per-month windows so each ERDDAP call stays
    small. End boundary is inclusive (ERDDAP slices by value, not index)."""
    windows: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        if cursor.month == 12:
            nxt = date(cursor.year + 1, 1, 1)
        else:
            nxt = date(cursor.year, cursor.month + 1, 1)
        windows.append((cursor, min(nxt - timedelta(days=1), end)))
        cursor = nxt
    return windows


def _query(fromdate, todate) -> list[tuple[datetime, float, float, float | None]]:
    """One stride-sampled ERDDAP CSV call covering the lookback window."""
    selector = (
        f"anom"
        f"[({fromdate.isoformat()}T12:00:00Z):1:({todate.isoformat()}T12:00:00Z)]"
        f"[(0.0):1:(0.0)]"  # zlev is always 0
        f"[(-60):{STRIDE}:(60)]"  # skip polar caps — OISST coverage gets sketchy
        f"[(-180):{STRIDE}:(180)]"
    )
    resp = requests.get(f"{ERDDAP_URL}?{selector}", timeout=120, headers=_HEADERS)
    resp.raise_for_status()
    out: list[tuple[datetime, float, float, float | None]] = []
    reader = csv.reader(io.StringIO(resp.text))
    header = next(reader, None)
    _units = next(reader, None)
    if not header:
        return out
    # Column layout: time, zlev, latitude, longitude, anom
    for row in reader:
        if len(row) < 5:
            continue
        try:
            ts = datetime.strptime(row[0][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
            lat = float(row[2])
            lon = float(row[3])
        except (ValueError, IndexError):
            continue
        try:
            anom = float(row[4])
        except ValueError:
            anom = None  # land / NaN
        out.append((ts, lat, lon, anom))
    return out
