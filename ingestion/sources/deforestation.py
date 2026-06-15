"""GFW — integrated deforestation alerts (GLAD-L + GLAD-S2 + RADD + DIST-ALERT).

The GFW Data API exposes daily aggregated alert counts at GADM admin levels
0 (country) / 1 (state) / 2 (district). We query the country-level (`iso`)
view, which is one row per (country, day, confidence) — a tractable shape for
the spike and a good visual analogue to FIRMS, which also collapses to
country-day.

Each (country, day) cluster becomes one event placed at a hardcoded centroid
for the country (only the top forest-loss countries actually carry alerts, so
the lookup table is small). Intensity scales with alert area.

API: https://data-api.globalforestwatch.org/dataset/
Dataset: gadm__integrated_alerts__iso_daily_alerts (latest version)
Auth: a (free) `GFW_API_KEY` is honoured if set, otherwise we call anonymously
(public datasets allow that with stricter rate limits).
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

import requests

from normalize import HAZARD_DEFORESTATION, Event, clamp01, point

DATASET = "gadm__integrated_alerts__iso_daily_alerts"
DATASET_QUERY_URL = f"https://data-api.globalforestwatch.org/dataset/{DATASET}/latest/query"

_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# Min alert hectares for a (country, day) to become an event — drops the
# long tail of background noise that would clutter the map. 100 ha ≈ a real
# active-clearing footprint, not a single noisy pixel.
MIN_ALERT_HA = 100.0

# Hectares above which we cap intensity at 1.0. Tuned to peak Amazon arc
# clearing days, where a single ADM0 row can carry 50k+ ha.
ALERT_HA_SATURATION = 50_000.0

# Centroid lookup for the countries that actually drive global forest loss.
# Pre-resolved here so we don't carry a country shapefile in the spike. ISO3
# matches what the GFW iso_daily_alerts dataset emits.
COUNTRY_CENTROIDS: dict[str, tuple[str, float, float]] = {
    "BRA": ("Brazil", -10.0, -55.0),
    "IDN": ("Indonesia", -2.5, 118.0),
    "COD": ("DR Congo", -2.9, 23.6),
    "BOL": ("Bolivia", -16.0, -64.5),
    "PER": ("Peru", -9.2, -75.0),
    "COL": ("Colombia", 3.0, -73.0),
    "AGO": ("Angola", -12.5, 18.0),
    "ZMB": ("Zambia", -13.5, 27.5),
    "MOZ": ("Mozambique", -18.5, 35.5),
    "MDG": ("Madagascar", -19.0, 46.6),
    "MEX": ("Mexico", 22.5, -100.0),
    "VEN": ("Venezuela", 6.5, -66.0),
    "PRY": ("Paraguay", -23.0, -58.5),
    "CMR": ("Cameroon", 5.7, 12.0),
    "GAB": ("Gabon", -0.6, 11.6),
    "COG": ("Republic of Congo", -1.0, 15.0),
    "CAF": ("Central African Republic", 6.6, 20.9),
    "GHA": ("Ghana", 7.9, -1.0),
    "CIV": ("Côte d'Ivoire", 7.5, -5.5),
    "MYS": ("Malaysia", 4.2, 109.5),
    "PNG": ("Papua New Guinea", -6.5, 144.0),
    "PHL": ("Philippines", 12.5, 122.0),
    "LAO": ("Laos", 18.0, 105.0),
    "KHM": ("Cambodia", 12.5, 105.0),
    "MMR": ("Myanmar", 22.0, 96.0),
    "IND": ("India", 22.5, 78.0),
    "VNM": ("Vietnam", 16.0, 107.5),
    "THA": ("Thailand", 15.5, 101.0),
    "AUS": ("Australia", -25.0, 134.0),
    "USA": ("United States", 38.0, -97.0),
    "CAN": ("Canada", 56.0, -98.0),
    "RUS": ("Russia", 61.0, 100.0),
    "ARG": ("Argentina", -34.0, -64.0),
    "CHL": ("Chile", -35.0, -71.5),
    "GUY": ("Guyana", 4.5, -58.9),
    "SUR": ("Suriname", 4.0, -56.0),
    "ECU": ("Ecuador", -1.5, -78.0),
    "NIC": ("Nicaragua", 12.9, -85.2),
    "HND": ("Honduras", 15.0, -86.5),
    "GTM": ("Guatemala", 15.5, -90.3),
}


def fetch(lookback_days: int = 7) -> list[Event]:
    today = datetime.now(timezone.utc).date()
    fromdate = today - timedelta(days=max(1, lookback_days))

    sql = (
        "SELECT iso, alert__date, confidence__cat, "
        "       SUM(alert_area__ha) AS alert_area_ha, "
        "       SUM(alert__count)   AS alert_count "
        f"FROM {DATASET} "
        f"WHERE alert__date >= '{fromdate.isoformat()}' "
        f"  AND alert__date <= '{today.isoformat()}' "
        "GROUP BY iso, alert__date, confidence__cat "
        "ORDER BY alert__date DESC"
    )

    headers = dict(_HEADERS)
    api_key = os.environ.get("GFW_API_KEY")
    if api_key:
        headers["x-api-key"] = api_key

    try:
        resp = requests.get(
            DATASET_QUERY_URL,
            params={"sql": sql},
            timeout=120,
            headers=headers,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"[deforestation] GFW Data API query failed: {exc}", file=sys.stderr)
        return []

    body = resp.json()
    rows = body.get("data") or body.get("results") or []

    # Aggregate confidence categories so each (country, day) is ONE event.
    buckets: dict[tuple[str, str], dict] = {}
    for row in rows:
        iso = row.get("iso")
        day_str = row.get("alert__date")
        if not iso or not day_str:
            continue
        area = float(row.get("alert_area_ha") or 0.0)
        count = int(row.get("alert_count") or 0)
        if iso not in COUNTRY_CENTROIDS:
            continue  # outside our top-forest-loss list; skip for the spike
        b = buckets.setdefault((iso, day_str), {"area": 0.0, "count": 0, "confs": set()})
        b["area"] += area
        b["count"] += count
        if row.get("confidence__cat"):
            b["confs"].add(row["confidence__cat"])

    events: list[Event] = []
    for (iso, day_str), b in buckets.items():
        if b["area"] < MIN_ALERT_HA:
            continue
        name, lat, lon = COUNTRY_CENTROIDS[iso]
        try:
            day = datetime.strptime(day_str[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        events.append(
            Event(
                source="gfw",
                source_event_id=f"{iso}-{day_str[:10]}",
                hazard_type=HAZARD_DEFORESTATION,
                geometry=point(lon, lat),
                title=f"Deforestation alerts in {name} ({b['area']:.0f} ha)",
                severity_raw=f"{b['count']} alerts / {b['area']:.0f} ha",
                intensity_norm=clamp01(b["area"] / ALERT_HA_SATURATION),
                started_at=day,
                ended_at=day,
                country=name,
                url="https://www.globalforestwatch.org/",
                metadata={
                    "iso": iso,
                    "alert_area_ha": round(b["area"], 1),
                    "alert_count": b["count"],
                    "confidence_cats": sorted(b["confs"]),
                },
            )
        )
    return events
