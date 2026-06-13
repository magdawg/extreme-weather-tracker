"""ENSO (El Niño–Southern Oscillation) state — NOAA CPC Oceanic Niño Index.

This is the one piece of data in the pipeline that is *not* an `Event`: ENSO is
a single global climate index, not a located hazard, so it gets its own tiny
table (`enso_oni`) and never goes through `normalize.Event` / the events upsert.
We keep it here because it's still "ingestion": a scheduled pull from a public,
free, no-key source that the API then serves alongside the events.

The ONI is the standard ENSO yardstick: a 3-month running mean of sea-surface
temperature anomalies in the Niño-3.4 region. NOAA CPC publishes the full series
back to 1950 as a fixed-width ASCII table, one row per overlapping season:

    SEAS  YR   TOTAL   ANOM
    DJF  1950  24.72  -1.53
    ...
    MAM  2026  28.06   0.48

El Niño is conventionally ≥ +0.5 °C, La Niña ≤ −0.5 °C, neutral in between
(the formal definition also requires 5 consecutive seasons past the threshold;
per-season classification is what we surface for display).

We also pull a *second*, companion product: the monthly Niño-3.4 SST anomaly.
The ONI's newest season is structurally ~1–1.5 months behind "now" because it's
a 3-month running mean centred on the middle month. The monthly anomaly has no
such centring lag, so it's the freshest read on the Pacific — at the cost of
being noisier and sitting on a *fixed* 1991–2020 base period rather than the
ONI's sliding 30-year base. It is therefore supplementary context, never a
drop-in ONI value, and we never use it to classify the El Niño / La Niña phase.
"""
from __future__ import annotations

from dataclasses import dataclass

import requests

# Public NOAA CPC product, no API key. Fixed-width ASCII, updated monthly.
ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"

# Companion monthly Niño-3.4 SST anomaly (ERSSTv5, 1991–2020 base). Same host,
# no key. Columns: YR MON NINO1+2 ANOM NINO3 ANOM NINO4 ANOM NINO3.4 ANOM.
NINO34_MONTHLY_URL = (
    "https://www.cpc.ncep.noaa.gov/data/indices/ersst5.nino.mth.91-20.ascii"
)

# El Niño / La Niña thresholds on the ONI scale (°C). Mirrored in the frontend
# (web/lib/enso.ts) and the API (/enso) — keep them identical if you change them.
EL_NINO_THRESHOLD = 0.5
LA_NINA_THRESHOLD = -0.5


@dataclass
class OniReading:
    year: int          # year of the season's centre month
    season: str        # 'DJF' | 'JFM' | … | 'NDJ'
    total: float | None  # 3-month mean SST (°C)
    anom: float        # ONI anomaly — the headline value


def fetch(timeout: int = 30) -> list[OniReading]:
    """Pull and parse the full ONI series. Returns one reading per season."""
    resp = requests.get(ONI_URL, timeout=timeout)
    resp.raise_for_status()
    return _parse(resp.text)


def _parse(text: str) -> list[OniReading]:
    readings: list[OniReading] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 4:
            continue
        season, year, total, anom = parts
        # Skip the header row ("SEAS YR TOTAL ANOM") and any stray non-data line.
        if not year.isdigit():
            continue
        try:
            readings.append(
                OniReading(
                    year=int(year),
                    season=season,
                    total=float(total),
                    anom=float(anom),
                )
            )
        except ValueError:
            continue
    return readings


UPSERT_SQL = """
INSERT INTO enso_oni (year, season, total, anom)
VALUES (%(year)s, %(season)s, %(total)s, %(anom)s)
ON CONFLICT (year, season) DO UPDATE SET
    total       = EXCLUDED.total,
    anom        = EXCLUDED.anom,
    ingested_at = now();
"""


def upsert(conn, readings: list[OniReading]) -> int:
    """Idempotent upsert into enso_oni. Safe to re-run every 12h — the ASCII
    file only revises the tail, so re-ingesting the whole series is cheap and
    self-healing."""
    import psycopg2.extras

    rows = [
        {"year": r.year, "season": r.season, "total": r.total, "anom": r.anom}
        for r in readings
    ]
    if not rows:
        return 0
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, UPSERT_SQL, rows, page_size=200)
    conn.commit()
    return len(rows)


# --- Monthly Niño-3.4 (the fresher, supplementary companion to the ONI) ------


@dataclass
class Nino34Monthly:
    year: int
    month: int           # 1..12
    sst: float | None    # monthly mean Niño-3.4 SST (°C)
    anom: float          # monthly SST anomaly (°C), 1991–2020 base


def fetch_nino34_monthly(timeout: int = 30) -> list[Nino34Monthly]:
    """Pull and parse the monthly Niño-3.4 series. One reading per month."""
    resp = requests.get(NINO34_MONTHLY_URL, timeout=timeout)
    resp.raise_for_status()
    return _parse_nino34(resp.text)


def _parse_nino34(text: str) -> list[Nino34Monthly]:
    readings: list[Nino34Monthly] = []
    for line in text.splitlines():
        parts = line.split()
        # Ten whitespace-separated columns per data row; the Niño-3.4 SST and
        # anomaly are the last pair (positions 8 and 9).
        if len(parts) != 10:
            continue
        # Skip the "YR MON …" header and any stray non-data line.
        if not parts[0].isdigit():
            continue
        try:
            readings.append(
                Nino34Monthly(
                    year=int(parts[0]),
                    month=int(parts[1]),
                    sst=float(parts[8]),
                    anom=float(parts[9]),
                )
            )
        except ValueError:
            continue
    return readings


UPSERT_NINO34_SQL = """
INSERT INTO enso_nino34 (year, month, sst, anom)
VALUES (%(year)s, %(month)s, %(sst)s, %(anom)s)
ON CONFLICT (year, month) DO UPDATE SET
    sst         = EXCLUDED.sst,
    anom        = EXCLUDED.anom,
    ingested_at = now();
"""


def upsert_nino34(conn, readings: list[Nino34Monthly]) -> int:
    """Idempotent upsert into enso_nino34. Same self-healing whole-series re-pull
    as the ONI: the ASCII file only revises its tail, so re-ingesting is cheap."""
    import psycopg2.extras

    rows = [
        {"year": r.year, "month": r.month, "sst": r.sst, "anom": r.anom}
        for r in readings
    ]
    if not rows:
        return 0
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, UPSERT_NINO34_SQL, rows, page_size=200)
    conn.commit()
    return len(rows)
