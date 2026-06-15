"""Environment-driven config for the ingestion job."""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.environ.get("DATABASE_URL", "")
FIRMS_MAP_KEY = os.environ.get("FIRMS_MAP_KEY", "")

# Spike-source credentials. Each source short-circuits to an empty list when
# its key is missing, so missing keys never kill the run — they just skip.
OPENAQ_API_KEY = os.environ.get("OPENAQ_API_KEY", "")
GFW_API_KEY = os.environ.get("GFW_API_KEY", "")
CMEMS_USERNAME = os.environ.get("CMEMS_USERNAME", "")
CMEMS_PASSWORD = os.environ.get("CMEMS_PASSWORD", "")

# How many days back each source should pull on every run.
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "7"))

# FIRMS detections are aggregated to one event per (country, day). The grid
# below is only used internally to reverse-geocode detections to a country
# cheaply (geocode each ~1.0 deg / 110km cell once, not every raw pixel); it is
# not the output granularity, so it rarely needs changing.
FIRMS_GRID_DEG = float(os.environ.get("FIRMS_GRID_DEG", "1.0"))
# Minimum fire-pixel detections for a (country, day) to become an event — keeps
# only countries with substantial fire activity that day, dropping trivial
# one-off blips. Active fire countries see thousands per day, so this mostly
# filters the long tail.
FIRMS_MIN_DETECTIONS = int(os.environ.get("FIRMS_MIN_DETECTIONS", "200"))
FIRMS_SOURCE = os.environ.get("FIRMS_SOURCE", "VIIRS_SNPP_NRT")
# Drop low-intensity fire clusters — FIRMS is mostly small, transient hotspots
# that read as "minor" and bury the map in noise. 1/3 matches the frontend's
# minor|moderate band boundary, so only moderate+ fires are stored/shown.
FIRMS_MIN_INTENSITY = float(os.environ.get("FIRMS_MIN_INTENSITY", "0.3333"))


def require(name: str, value: str) -> str:
    if not value:
        raise SystemExit(f"Missing required env var: {name}")
    return value
