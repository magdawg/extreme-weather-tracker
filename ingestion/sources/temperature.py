"""Extreme heat & cold — DERIVED, because no provider ships a ready-made
"heatwave event" feed.

v1 (this file): sample a global grid of major cities via the free, key-less
Open-Meteo forecast API and flag days whose max/min crosses an absolute
extreme threshold. Intensity scales with how far past the threshold we are.

This is a deliberate heuristic. The clean upgrade (left as a TODO) is to
compare each day against that location's climatological normal (ERA5 archive)
and flag percentile anomalies instead of fixed thresholds — that captures a
"cold snap" in the tropics or a "heatwave" in the Arctic, which absolute cut-offs
miss. The rest of the pipeline doesn't change.
"""
from __future__ import annotations

from datetime import datetime, timezone

import requests

from normalize import HAZARD_COLD, HAZARD_HEAT, Event, clamp01, point

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

HEAT_THRESHOLD_C = 40.0   # daily max at/above this = extreme heat event
HEAT_SATURATION_C = 15.0  # +15C over threshold = intensity 1.0
COLD_THRESHOLD_C = -18.0  # daily min at/below this = extreme cold event
COLD_SATURATION_C = 22.0

# A spread of major population centres across every inhabited continent.
# (slug, name, lat, lon)
CITIES: list[tuple[str, str, float, float]] = [
    ("nyc", "New York", 40.71, -74.01), ("lax", "Los Angeles", 34.05, -118.24),
    ("chi", "Chicago", 41.88, -87.63), ("phx", "Phoenix", 33.45, -112.07),
    ("mex", "Mexico City", 19.43, -99.13), ("yyz", "Toronto", 43.65, -79.38),
    ("bog", "Bogota", 4.71, -74.07), ("lim", "Lima", -12.05, -77.04),
    ("sao", "Sao Paulo", -23.55, -46.63), ("bue", "Buenos Aires", -34.60, -58.38),
    ("scl", "Santiago", -33.45, -70.67), ("rio", "Rio de Janeiro", -22.91, -43.17),
    ("lon", "London", 51.51, -0.13), ("par", "Paris", 48.86, 2.35),
    ("mad", "Madrid", 40.42, -3.70), ("rom", "Rome", 41.90, 12.50),
    ("ber", "Berlin", 52.52, 13.40), ("mos", "Moscow", 55.76, 37.62),
    ("ist", "Istanbul", 41.01, 28.98), ("ath", "Athens", 37.98, 23.73),
    ("cai", "Cairo", 30.04, 31.24), ("lag", "Lagos", 6.52, 3.38),
    ("nbo", "Nairobi", -1.29, 36.82), ("jnb", "Johannesburg", -26.20, 28.05),
    ("cpt", "Cape Town", -33.93, 18.42), ("kha", "Khartoum", 15.50, 32.56),
    ("rik", "Riyadh", 24.71, 46.68), ("dxb", "Dubai", 25.20, 55.27),
    ("teh", "Tehran", 35.69, 51.39), ("bgw", "Baghdad", 33.32, 44.36),
    ("del", "Delhi", 28.61, 77.21), ("bom", "Mumbai", 19.08, 72.88),
    ("kol", "Kolkata", 22.57, 88.36), ("dac", "Dhaka", 23.81, 90.41),
    ("kar", "Karachi", 24.86, 67.01), ("bkk", "Bangkok", 13.76, 100.50),
    ("sin", "Singapore", 1.35, 103.82), ("jkt", "Jakarta", -6.21, 106.85),
    ("hkg", "Hong Kong", 22.32, 114.17), ("sha", "Shanghai", 31.23, 121.47),
    ("bej", "Beijing", 39.90, 116.41), ("tyo", "Tokyo", 35.68, 139.69),
    ("seo", "Seoul", 37.57, 126.98), ("mnl", "Manila", 14.60, 120.98),
    ("syd", "Sydney", -33.87, 151.21), ("mel", "Melbourne", -37.81, 144.96),
    ("per", "Perth", -31.95, 115.86), ("akl", "Auckland", -36.85, 174.76),
    ("anc", "Anchorage", 61.22, -149.90), ("rek", "Reykjavik", 64.15, -21.94),
    ("nsk", "Norilsk", 69.35, 88.20), ("yak", "Yakutsk", 62.04, 129.73),
]


def fetch(lookback_days: int = 7) -> list[Event]:
    events: list[Event] = []
    for slug, name, lat, lon in CITIES:
        try:
            daily = _forecast(lat, lon)
        except requests.RequestException:
            continue
        events.extend(_classify(slug, name, lat, lon, daily))
    return events


def _forecast(lat: float, lon: float) -> dict:
    resp = requests.get(
        FORECAST_URL,
        params={
            "latitude": lat,
            "longitude": lon,
            "daily": "temperature_2m_max,temperature_2m_min",
            "forecast_days": 7,
            "timezone": "UTC",
        },
        timeout=60,
        headers={"User-Agent": "extreme-weather-tracker/0.1"},
    )
    resp.raise_for_status()
    return resp.json().get("daily", {})


def _classify(slug: str, name: str, lat: float, lon: float, daily: dict) -> list[Event]:
    out: list[Event] = []
    dates = daily.get("time", [])
    tmax = daily.get("temperature_2m_max", [])
    tmin = daily.get("temperature_2m_min", [])
    for i, date in enumerate(dates):
        day = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        hi = tmax[i] if i < len(tmax) else None
        lo = tmin[i] if i < len(tmin) else None

        if hi is not None and hi >= HEAT_THRESHOLD_C:
            out.append(
                Event(
                    source="open-meteo",
                    source_event_id=f"{slug}-{date}-heat",
                    hazard_type=HAZARD_HEAT,
                    geometry=point(lon, lat),
                    title=f"Extreme heat in {name} ({hi:.0f}°C)",
                    severity_raw=f"{hi:.0f}°C max",
                    intensity_norm=clamp01((hi - HEAT_THRESHOLD_C) / HEAT_SATURATION_C),
                    started_at=day,
                    ended_at=day,
                    metadata={"city": name, "tmax_c": hi},
                )
            )
        if lo is not None and lo <= COLD_THRESHOLD_C:
            out.append(
                Event(
                    source="open-meteo",
                    source_event_id=f"{slug}-{date}-cold",
                    hazard_type=HAZARD_COLD,
                    geometry=point(lon, lat),
                    title=f"Extreme cold in {name} ({lo:.0f}°C)",
                    severity_raw=f"{lo:.0f}°C min",
                    intensity_norm=clamp01((COLD_THRESHOLD_C - lo) / COLD_SATURATION_C),
                    started_at=day,
                    ended_at=day,
                    metadata={"city": name, "tmin_c": lo},
                )
            )
    return out
