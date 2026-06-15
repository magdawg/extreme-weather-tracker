"""Open-Meteo Marine — extreme ocean swells.

Sample significant wave height (Hs) at a curated list of open-ocean / coastal
points and flag readings above a swell threshold. One event per (point, day)
where the daily max Hs exceeds the threshold; intensity scales with how far
past the threshold we are. Same fixed-threshold heuristic as the terrestrial
heat source — the clean upgrade is a percentile-vs-climatology anomaly per
point. The rest of the pipeline doesn't change.

Why a fixed point list instead of a global grid: free-tier Open-Meteo can't
serve a hemispheric grid in one routine sweep, and ~40 well-placed coastal /
exposed-headland points cover the storm tracks people actually see (NW Pacific
typhoon corridor, North Atlantic storm belt, Southern Ocean swell window,
hurricane fetches into the Caribbean and Bay of Bengal, etc.).

API: https://open-meteo.com/en/docs/marine-weather-api  (free, no key)
"""
from __future__ import annotations

import sys
import time
from datetime import datetime, timezone

import requests

from normalize import HAZARD_SWELL, Event, clamp01, point

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"

_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# Hs at/above which we treat the day as an extreme swell event. ~6 m is the
# WMO "very rough sea / phenomenal sea" boundary and is genuinely rare —
# regular storms peak around 4 m, the things that destroy harbours sit
# above 6 m.
SWELL_THRESHOLD_M = 6.0
SWELL_SATURATION_M = 14.0  # 14 m ≈ recorded rogue wave territory → intensity 1.0

# Coastal / open-ocean sample points where dangerous swell shows up.
# Mix of named breaks, headlands, and shipping lanes. Spike-grade — easy to
# enrich later. Format: (slug, name, lat, lon).
POINTS: list[tuple[str, str, float, float]] = [
    ("nw-pacific-honshu", "NW Pacific (off Honshu)", 36.0, 142.5),
    ("nw-pacific-philippines", "NW Pacific (E of Luzon)", 17.5, 124.5),
    ("south-china-sea", "South China Sea", 18.0, 115.0),
    ("se-asia-bay-of-bengal", "Bay of Bengal", 17.0, 88.0),
    ("arabian-sea", "Arabian Sea", 14.0, 65.0),
    ("se-indian-ocean", "SE Indian Ocean (S of WA)", -40.0, 110.0),
    ("southern-ocean-50s", "Southern Ocean 50°S", -50.0, 80.0),
    ("southern-ocean-drake", "Drake Passage", -57.0, -65.0),
    ("se-pacific-chile", "SE Pacific (off Chile)", -40.0, -78.0),
    ("ne-pacific-aleutians", "NE Pacific (Aleutians)", 53.0, -170.0),
    ("ne-pacific-mendocino", "NE Pacific (Mendocino fetch)", 40.5, -130.0),
    ("hawaii-north-shore", "Hawaii (N shore swell window)", 22.0, -158.5),
    ("baja-pacific", "Baja Pacific", 24.0, -116.0),
    ("gulf-of-mexico", "Gulf of Mexico", 25.0, -88.0),
    ("caribbean-east", "Eastern Caribbean", 16.0, -62.0),
    ("nw-atlantic-gulf-stream", "NW Atlantic (Gulf Stream)", 38.0, -68.0),
    ("ne-atlantic-iceland", "NE Atlantic (S of Iceland)", 60.0, -22.0),
    ("ne-atlantic-biscay", "Bay of Biscay", 45.5, -7.0),
    ("ne-atlantic-portugal", "Atlantic Portugal (Nazaré fetch)", 39.5, -10.5),
    ("ireland-west", "West Ireland (Mullaghmore)", 54.3, -10.5),
    ("uk-scotland", "Scotland N coast", 58.5, -4.0),
    ("norway-sea", "Norwegian Sea", 65.0, 2.0),
    ("mediterranean-sicily", "Central Mediterranean", 37.0, 14.0),
    ("south-atlantic-namibia", "S Atlantic (off Namibia)", -25.0, 11.0),
    ("south-atlantic-cape", "Cape Point swell window", -36.0, 18.0),
    ("sw-indian-reunion", "SW Indian Ocean (Mascarenes)", -22.0, 56.0),
    ("madagascar-east", "Madagascar east coast", -18.0, 50.5),
    ("brazil-northeast", "NE Brazil", -8.0, -33.0),
    ("brazil-rio", "Brazil (off Rio)", -25.0, -42.0),
    ("argentina-pampas", "Argentine shelf", -42.0, -58.0),
    ("falklands", "Falklands shelf", -52.0, -56.0),
    ("nz-south-island", "Tasman Sea (NZ west)", -43.0, 168.0),
    ("nz-east-cape", "NZ east cape swell", -38.0, 179.0),
    ("e-australia", "East Australia (off Sydney)", -34.0, 152.0),
    ("se-australia-bass", "Bass Strait", -40.0, 145.0),
    ("indonesia-mentawai", "Mentawai window, Sumatra", -2.5, 99.0),
    ("china-east", "East China Sea", 30.0, 125.0),
    ("japan-sea", "Sea of Japan", 39.0, 134.0),
    ("kuril-pacific", "Kuril Islands Pacific side", 47.0, 154.0),
    ("alaska-gulf", "Gulf of Alaska", 56.0, -148.0),
]


def fetch(lookback_days: int = 3) -> list[Event]:
    """Pull recent-window daily-max Hs at each sample point. We use the
    multi-coord call (one HTTP round-trip total) like temperature does."""
    if not POINTS:
        return []
    params = {
        "latitude": ",".join(str(p[2]) for p in POINTS),
        "longitude": ",".join(str(p[3]) for p in POINTS),
        "daily": "wave_height_max",
        "past_days": max(0, min(lookback_days, 7)),
        "forecast_days": 3,
        "timezone": "UTC",
    }
    try:
        resp = requests.get(MARINE_URL, params=params, timeout=120, headers=_HEADERS)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"[swell] marine API fetch failed: {exc}", file=sys.stderr)
        return []
    body = resp.json()
    # Multi-coord response is a list; single-coord response is a dict — same
    # quirk as the temperature batch endpoint.
    items = body if isinstance(body, list) else [body]
    events: list[Event] = []
    for (slug, name, lat, lon), item in zip(POINTS, items):
        daily = item.get("daily") or {}
        for day_str, hs in zip(daily.get("time", []), daily.get("wave_height_max", [])):
            if hs is None or hs < SWELL_THRESHOLD_M:
                continue
            try:
                day = datetime.strptime(day_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            events.append(
                Event(
                    source="open-meteo-marine",
                    source_event_id=f"{slug}-{day_str}-swell",
                    hazard_type=HAZARD_SWELL,
                    geometry=point(lon, lat),
                    title=f"Extreme swell at {name} ({hs:.1f} m)",
                    severity_raw=f"Hs {hs:.1f} m",
                    intensity_norm=clamp01(
                        (hs - SWELL_THRESHOLD_M) / (SWELL_SATURATION_M - SWELL_THRESHOLD_M)
                    ),
                    started_at=day,
                    ended_at=day,
                    metadata={"point": name, "hs_m": round(hs, 2)},
                )
            )
    # Open-Meteo's free tier asks for polite spacing; nothing to do here since
    # we make one call per run, but keep the helper for symmetry with
    # temperature.py if/when this grows into a batched sweep.
    _ = time.time
    return events
