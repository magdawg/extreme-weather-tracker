"""NASA FIRMS — near-real-time active fire detections (VIIRS).

The raw feed is millions of pixel detections, which would blow Neon's free
0.5GB — and plotting even grid-binned cells tiles whole countries with dots. So
we aggregate to ONE wildfire event per (country, day): every detection in a
country on a given UTC day collapses into a single point at the fire-radiative-
power-weighted centre of that day's fires, with intensity derived from FRP and
detection count. This keeps row counts low and the map readable.

Detections are first binned into a coarse grid purely so we can reverse-geocode
each cell once (offline) instead of geocoding millions of raw points; the grid
is an implementation detail, not the output granularity.

API: https://firms.modaps.eosdis.nasa.gov/api/area/  (free MAP_KEY required)
"""
from __future__ import annotations

import csv
import io
import math
from collections import defaultdict
from datetime import datetime, timezone

import requests
import reverse_geocode

from normalize import HAZARD_WILDFIRE, Event, clamp01, point

AREA_URL = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/world/{days}"

# FRP (MW) at/above which a cluster is treated as maximum intensity.
FRP_SATURATION = 200.0


def fetch(map_key: str, source: str, lookback_days: int, grid_deg: float, min_detections: int, min_intensity: float = 0.0) -> list[Event]:
    days = max(1, min(lookback_days, 5))  # FIRMS area API caps the day range at 5
    url = AREA_URL.format(key=map_key, source=source, days=days)
    resp = requests.get(url, timeout=120, headers={"User-Agent": "extreme-weather-tracker/0.1"})
    resp.raise_for_status()

    cells = _bin_detections(resp.text, grid_deg)
    country_of = _geocode_cells(cells, grid_deg)

    # Merge cells into one bucket per (country, day).
    groups: dict[tuple[str, str], dict] = defaultdict(_new_group)
    for (gx, gy, day), agg in cells.items():
        cc, name = country_of.get((gx, gy), (None, None))
        if not cc:
            continue  # over water / unresolved — nothing meaningful to label
        g = groups[(cc, day)]
        g["country"] = name
        g["count"] += agg["count"]
        g["frp_sum"] += agg["frp_sum"]
        g["frp_max"] = max(g["frp_max"], agg["frp_max"])
        g["wlon"] += agg["wlon"]
        g["wlat"] += agg["wlat"]
        g["lon_sum"] += agg["lon_sum"]
        g["lat_sum"] += agg["lat_sum"]
        if agg["first"]:
            g["first"] = agg["first"] if g["first"] is None else min(g["first"], agg["first"])
        if agg["last"]:
            g["last"] = agg["last"] if g["last"] is None else max(g["last"], agg["last"])

    events: list[Event] = []
    for (cc, day), g in groups.items():
        if g["count"] < min_detections:
            continue
        mean_frp = g["frp_sum"] / g["count"]
        # Blend count and FRP into a 0..1 intensity.
        intensity = clamp01(0.6 * (mean_frp / FRP_SATURATION) + 0.4 * (math.log1p(g["count"]) / math.log1p(200)))
        if intensity < min_intensity:
            continue  # skip minor activity that would just be map noise
        # Place the dot where the fire energy is, not at the country's centroid.
        if g["frp_sum"] > 0:
            lon, lat = g["wlon"] / g["frp_sum"], g["wlat"] / g["frp_sum"]
        else:
            lon, lat = g["lon_sum"] / g["count"], g["lat_sum"] / g["count"]
        events.append(
            Event(
                source="firms",
                source_event_id=f"{source}-{cc}-{day}",
                hazard_type=HAZARD_WILDFIRE,
                geometry=point(lon, lat),
                title=f"Active fires in {g['country']} ({g['count']} detections)",
                severity_raw=f"FRP {mean_frp:.0f} MW",
                intensity_norm=intensity,
                started_at=g["first"],
                ended_at=g["last"],
                country=g["country"],
                metadata={
                    "detections": g["count"],
                    "mean_frp_mw": round(mean_frp, 1),
                    "max_frp_mw": round(g["frp_max"], 1),
                    "satellite_source": source,
                    "date": day,
                },
            )
        )
    return events


def _new_group() -> dict:
    return {
        "country": None,
        "count": 0,
        "frp_sum": 0.0,
        "frp_max": 0.0,
        "wlon": 0.0,
        "wlat": 0.0,
        "lon_sum": 0.0,
        "lat_sum": 0.0,
        "first": None,
        "last": None,
    }


def _geocode_cells(cells: dict, grid_deg: float) -> dict[tuple[int, int], tuple[str | None, str | None]]:
    """Reverse-geocode each distinct grid cell centre once (offline, no network).
    GDACS hands us a country directly; FIRMS only has coordinates, so we resolve
    them here to label both sources' events the same way."""
    cell_xy = sorted({(gx, gy) for (gx, gy, _day) in cells})
    if not cell_xy:
        return {}
    coords = [((gy + 0.5) * grid_deg, (gx + 0.5) * grid_deg) for gx, gy in cell_xy]  # (lat, lon)
    hits = reverse_geocode.search(coords)
    return {
        xy: (hit.get("country_code"), hit.get("country"))
        for xy, hit in zip(cell_xy, hits)
    }


def _bin_detections(csv_text: str, grid_deg: float) -> dict[tuple[int, int, str], dict]:
    """Bin raw detections by (grid cell, UTC day), accumulating FRP-weighted
    position so a later step can place each country-day at its fire centre."""
    cells: dict[tuple[int, int, str], dict] = defaultdict(
        lambda: {
            "count": 0, "frp_sum": 0.0, "frp_max": 0.0,
            "wlon": 0.0, "wlat": 0.0, "lon_sum": 0.0, "lat_sum": 0.0,
            "first": None, "last": None,
        }
    )
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        day = (row.get("acq_date") or "").strip()
        if not day:
            continue  # a detection with no date can't be placed in a day bucket
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
        except (KeyError, ValueError):
            continue
        gx = int(math.floor(lon / grid_deg))
        gy = int(math.floor(lat / grid_deg))
        frp = _safe_float(row.get("frp"))
        when = _parse_acq(day, row.get("acq_time"))

        cell = cells[(gx, gy, day)]
        cell["count"] += 1
        cell["frp_sum"] += frp
        cell["frp_max"] = max(cell["frp_max"], frp)
        cell["wlon"] += lon * frp
        cell["wlat"] += lat * frp
        cell["lon_sum"] += lon
        cell["lat_sum"] += lat
        if when:
            cell["first"] = when if cell["first"] is None else min(cell["first"], when)
            cell["last"] = when if cell["last"] is None else max(cell["last"], when)
    return cells


def _safe_float(value: str | None) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _parse_acq(date_str: str | None, time_str: str | None) -> datetime | None:
    if not date_str:
        return None
    try:
        hh, mm = 0, 0
        if time_str:
            t = time_str.zfill(4)
            hh, mm = int(t[:2]), int(t[2:4])
        return datetime.strptime(date_str, "%Y-%m-%d").replace(
            hour=hh, minute=mm, tzinfo=timezone.utc
        )
    except ValueError:
        return None
