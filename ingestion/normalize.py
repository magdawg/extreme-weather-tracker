"""Canonical event model shared by every source.

Each source module fetches its own data and emits a list of `Event`. The
normalizer's job is to map wildly different provider formats onto one shape so
the DB, API and map never special-case a provider.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

# Hazard taxonomy used across the whole app.
# When you add a hazard, also update: api/index.py (VALID_HAZARDS),
# web/lib/types.ts (HazardType), web/lib/hazards.ts (HAZARDS, HAZARD_ORDER).
HAZARD_STORM = "storm"
HAZARD_FLOOD = "flood"
HAZARD_WILDFIRE = "wildfire"
HAZARD_HEAT = "heat"
HAZARD_DROUGHT = "drought"
# Spike-era additions (ocean / biosphere / secondary impact).
HAZARD_CORAL_BLEACH = "coral_bleach"   # NOAA Coral Reef Watch BAA level
HAZARD_MARINE_HEAT = "marine_heat"     # OISST-derived marine heatwave
HAZARD_SWELL = "swell"                 # extreme significant wave height
HAZARD_MORTALITY = "mortality"         # GBIF clustered die-off signal
HAZARD_DEFORESTATION = "deforestation" # GFW integrated alerts
HAZARD_AIR_QUALITY = "air_quality"     # OpenAQ hazardous-tier PM2.5


@dataclass
class Event:
    source: str
    source_event_id: str
    hazard_type: str
    geometry: dict[str, Any]        # GeoJSON geometry dict (Point/Polygon)
    title: str | None = None
    severity_raw: str | None = None
    intensity_norm: float | None = None   # 0..1
    started_at: datetime | None = None
    ended_at: datetime | None = None
    country: str | None = None
    url: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.intensity_norm is not None:
            self.intensity_norm = clamp01(self.intensity_norm)


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


# GDACS alert colours -> unified intensity. Values are the MIDPOINT of each
# band on the 0..3 GDACS score scale (Green 0–1, Orange 1–2, Red 2–3),
# normalized to 0..1: 0.5/3, 1.5/3, 2.5/3. Midpoints (not band edges) keep a
# colour-only event representative for dot size/opacity.
GDACS_ALERT_INTENSITY = {"green": 0.17, "orange": 0.5, "red": 0.83}


def gdacs_intensity(alert_level: str | None, alert_score: float | None) -> float:
    """Prefer the continuous alertscore (0..3); fall back to the colour midpoint."""
    if alert_score is not None:
        return clamp01(alert_score / 3.0)
    if alert_level:
        return GDACS_ALERT_INTENSITY.get(alert_level.strip().lower(), 0.17)
    return 0.17


def point(lon: float, lat: float) -> dict[str, Any]:
    return {"type": "Point", "coordinates": [float(lon), float(lat)]}
