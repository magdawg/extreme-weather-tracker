"""Extreme heat — DERIVED, because no provider ships a ready-made
"heatwave event" feed.

v1 (this file): sample the world's top ~1000 cities by population via the
free, key-less Open-Meteo APIs and flag days whose max crosses an absolute
extreme threshold. Intensity scales with how far past the threshold we are.
Two endpoints, same shape: `forecast` for routine 7-day pulls, `archive`
(ERA5 reanalysis) for `--backfill` history back to 2021.

Both endpoints are queried in **multi-point batches** (comma-separated lat/lon
in one request, response is a list in input order). That cuts the call count
from N cities to N/BATCH_SIZE per query — keeping the per-run footprint well
inside Open-Meteo's free-tier rate limit that bit us during the initial
single-call-per-city backfill.

The city list comes from the bundled `geonamescache` dataset (no network),
sorted by population — so the global coverage tracks where people actually
live rather than a curator's hand-picked list.

This is a deliberate heuristic. The clean upgrade (left as a TODO) is to
compare each day against that location's climatological normal (ERA5 archive)
and flag percentile anomalies instead of fixed thresholds — that captures a
"heatwave" in the Arctic, which absolute cut-offs miss. The rest of the
pipeline doesn't change.
"""
from __future__ import annotations

import sys
import time
from collections import Counter
from collections.abc import Iterator
from datetime import date, datetime, timezone
from functools import lru_cache

import requests
from geonamescache import GeonamesCache

from normalize import HAZARD_HEAT, Event, clamp01, point

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

HEAT_THRESHOLD_C = 42.0   # daily max at/above this = extreme heat event
HEAT_SATURATION_C = 15.0  # +15C over threshold = intensity 1.0

# How many of the world's most-populous cities to sample. 1000 covers every
# major population centre globally while keeping per-run API call count well
# under Open-Meteo's free-tier daily budget.
TOP_CITIES = 1000

# Cap per country so the sample isn't dominated by a few huge-population
# countries (uncapped, the top-1000 is 25% China and 10% India — leaving most
# of the world's heat-affected places unsampled). 30 keeps substantial coverage
# of populous countries while making room for ~200 more countries.
MAX_CITIES_PER_COUNTRY = 30

# Locations per multi-point call. 100 × 365 days ≈ 700 KB / 4 s in practice
# (probed against the live API). Bigger batches work but the marginal call-count
# savings shrink past 100, and one transient failure costs more cities.
BATCH_SIZE = 100

# Backoff schedule for Open-Meteo's 429s. Their free tier rate-limits on
# sliding per-minute/hour/day windows and the response has no Retry-After
# header, so we use a fixed escalation. Total worst-case wait per stuck batch
# ≈ 8.5 min before giving up — long enough to clear a per-minute or per-hour
# window dip, short enough to fail loudly on a daily-quota wall.
_RATE_LIMIT_BACKOFF_S = (30, 60, 120, 300)

# Polite pause between successful batches. Cheap insurance against bursting
# Open-Meteo's per-minute quota during a long sweep — adds <5 min to a full
# 60-batch backfill, prevents most 429s in the first place.
_INTER_BATCH_SLEEP_S = 3

# Oldest date a --backfill run reaches back to. Matches GDACS for consistency.
BACKFILL_FROMDATE = date(2021, 1, 1)

_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# (slug, name, lat, lon) — what the rest of the file passes around.
City = tuple[str, str, float, float]


@lru_cache(maxsize=1)
def _cities(n: int = TOP_CITIES) -> list[City]:
    """Top-n cities worldwide by population from the bundled GeoNames dataset,
    capped at MAX_CITIES_PER_COUNTRY per country so a few huge nations don't
    crowd out everyone else.

    Returns (slug, name, lat, lon). Slug is the GeoNames id — stable across
    runs, globally unique, and decoupled from name collisions (which matter
    once you go past one or two cities per country).
    """
    ordered = sorted(
        GeonamesCache().get_cities().values(),
        key=lambda c: -int(c.get("population", 0) or 0),
    )
    by_country: dict[str, int] = {}
    picked: list[City] = []
    for c in ordered:
        cc = c.get("countrycode", "")
        if by_country.get(cc, 0) >= MAX_CITIES_PER_COUNTRY:
            continue
        by_country[cc] = by_country.get(cc, 0) + 1
        picked.append(
            (str(c["geonameid"]), c["name"], float(c["latitude"]), float(c["longitude"]))
        )
        if len(picked) >= n:
            break
    return picked


def fetch(lookback_days: int = 7) -> list[Event]:
    """Routine 7-day forecast sweep across the top-N cities, batched."""
    events: list[Event] = []
    errors: Counter[str] = Counter()
    batches = list(_chunked(_cities(), BATCH_SIZE))
    for i, batch in enumerate(batches):
        try:
            dailies = _forecast_batch(batch)
        except requests.HTTPError as exc:
            errors[str(exc.response.status_code)] += len(batch)
            continue
        except requests.RequestException:
            errors["network"] += len(batch)
            continue
        for (slug, name, lat, lon), daily in zip(batch, dailies):
            events.extend(_classify(slug, name, lat, lon, daily))
        if i < len(batches) - 1:
            time.sleep(_INTER_BATCH_SLEEP_S)
    if errors:
        print(f"[temperature] forecast errors {dict(errors)}", file=sys.stderr)
    return events


def fetch_backfill(from_year: int | None = None) -> Iterator[tuple[int, list[Event]]]:
    """Deep history pull from Open-Meteo's ERA5 archive, yielded **one year at
    a time** so the orchestrator can upsert per year instead of buffering
    five+ years of events.

    Same reason as GDACS: holding the DB connection idle through the
    ~minutes-long fetch of a year would let Neon drop the socket and kill the
    final write. Upserts are idempotent, so a run interrupted mid-history just
    resumes on re-run.

    `from_year` lets a re-run skip already-stored years (e.g. backfill 2021-24
    completed, only re-run 2025-26). Defaults to BACKFILL_FROMDATE.year.
    """
    today = datetime.now(timezone.utc).date()
    cities = _cities()
    start_year = from_year if from_year is not None else BACKFILL_FROMDATE.year
    for year in range(start_year, today.year + 1):
        win_from = max(BACKFILL_FROMDATE, date(year, 1, 1))
        # For the current (partial) year, clamp end to today; ERA5 lags ~5
        # days behind real time, so any "future" days return null and are
        # safely dropped by _classify.
        win_to = today if year == today.year else date(year, 12, 31)
        print(f"[temperature] backfilling archive {year}…")
        events: list[Event] = []
        # Track failure modes so a year that returns 0 events is never silent
        # again — the original swallowed-error bug emptied 2025/2026 with no
        # signal. Tallied by HTTP status (or 'network') and reported at end.
        # Counts cities lost, not requests, so a 100-city batch failure shows
        # up as "100" rather than "1".
        errors: Counter[str] = Counter()
        batches = list(_chunked(cities, BATCH_SIZE))
        for i, batch in enumerate(batches):
            try:
                dailies = _archive_batch(batch, win_from, win_to)
            except requests.HTTPError as exc:
                errors[str(exc.response.status_code)] += len(batch)
                continue
            except requests.RequestException:
                errors["network"] += len(batch)
                continue
            for (slug, name, lat, lon), daily in zip(batch, dailies):
                events.extend(_classify(slug, name, lat, lon, daily))
            if i < len(batches) - 1:
                time.sleep(_INTER_BATCH_SLEEP_S)
        if errors:
            print(f"[temperature] {year}: errors {dict(errors)}", file=sys.stderr)
        yield year, events


def _chunked(seq: list[City], size: int) -> Iterator[list[City]]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def _forecast_batch(batch: list[City]) -> list[dict]:
    return _post_process_batch(
        _get_with_backoff(
            FORECAST_URL,
            {
                "latitude": ",".join(str(c[2]) for c in batch),
                "longitude": ",".join(str(c[3]) for c in batch),
                "daily": "temperature_2m_max",
                "forecast_days": 7,
                "timezone": "UTC",
            },
            timeout=120,
        ),
        len(batch),
    )


def _archive_batch(batch: list[City], start: date, end: date) -> list[dict]:
    """Multi-point ERA5 archive call. Returns one `daily` dict per input city,
    in the same order — Open-Meteo preserves coordinate order in the response."""
    return _post_process_batch(
        _get_with_backoff(
            ARCHIVE_URL,
            {
                "latitude": ",".join(str(c[2]) for c in batch),
                "longitude": ",".join(str(c[3]) for c in batch),
                "daily": "temperature_2m_max",
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "timezone": "UTC",
            },
            timeout=300,
        ),
        len(batch),
    )


def _get_with_backoff(url: str, params: dict, timeout: int) -> requests.Response:
    """GET that retries on 429 (rate-limited) using the fixed backoff schedule.
    Non-429 responses pass through immediately (caller calls raise_for_status).
    After the last retry, the 429 response itself is returned so the caller
    raises and the per-year error counter logs it."""
    for attempt, wait in enumerate(_RATE_LIMIT_BACKOFF_S):
        resp = requests.get(url, params=params, timeout=timeout, headers=_HEADERS)
        if resp.status_code != 429:
            return resp
        print(
            f"[temperature] 429 from Open-Meteo — backing off {wait}s "
            f"(attempt {attempt + 1}/{len(_RATE_LIMIT_BACKOFF_S)})",
            file=sys.stderr,
        )
        time.sleep(wait)
    return requests.get(url, params=params, timeout=timeout, headers=_HEADERS)


def _post_process_batch(resp: requests.Response, expected: int) -> list[dict]:
    """Open-Meteo returns a list for multi-coord requests, but a single dict
    when only one coord is passed (which happens for the trailing batch when
    len(cities) isn't a multiple of BATCH_SIZE). Normalize to always-a-list,
    then defensively pad/trim to `expected` length so a malformed response
    can't silently misalign with the input cities by position."""
    resp.raise_for_status()
    body = resp.json()
    items = body if isinstance(body, list) else [body]
    dailies = [item.get("daily", {}) for item in items]
    if len(dailies) < expected:
        dailies.extend({} for _ in range(expected - len(dailies)))
    return dailies[:expected]


def _classify(slug: str, name: str, lat: float, lon: float, daily: dict) -> list[Event]:
    out: list[Event] = []
    dates = daily.get("time", [])
    tmax = daily.get("temperature_2m_max", [])
    for i, date_str in enumerate(dates):
        day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        hi = tmax[i] if i < len(tmax) else None

        if hi is not None and hi >= HEAT_THRESHOLD_C:
            out.append(
                Event(
                    source="open-meteo",
                    source_event_id=f"{slug}-{date_str}-heat",
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
    return out
