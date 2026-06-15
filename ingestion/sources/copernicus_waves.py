"""Copernicus Marine — global wave forecast (CMEMS).

The heavier-grade alternative to Open-Meteo Marine: 1/12° global wave
analysis & forecast from Météo-France's WAVERYS system, distributed by the
Copernicus Marine Service. Better resolution than the Open-Meteo product and
better coverage of localized storm fetches.

The catch: CMEMS requires a (free) account. Without `CMEMS_USERNAME` /
`CMEMS_PASSWORD` env vars the source short-circuits to an empty list so the
rest of the ingestion still runs — same pattern FIRMS uses for its map key.

How the spike works when creds ARE set:
    1. Lazy-import the `copernicusmarine` toolbox (so missing creds don't
       force every user to install it).
    2. Use `copernicusmarine.subset()` to pull a coarse global subset of
       Hs from `cmems_mod_glo_wav_anfc_0.083deg_PT3H-i` over the recent
       window, downsampled by stride.
    3. Threshold + clamp into `swell` events using the same scale as
       `swell.py` so the two sources are directly comparable on the map.

Datasets: https://data.marine.copernicus.eu
Toolbox docs: https://help.marine.copernicus.eu/en/articles/7949409
Account signup: https://data.marine.copernicus.eu/register
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

from normalize import HAZARD_SWELL, Event, clamp01, point

# Reuse the same thresholds as swell.py so OpenMeteo vs Copernicus events
# read the same on the map. If you tune the Open-Meteo scale, tune this too.
SWELL_THRESHOLD_M = 6.0
SWELL_SATURATION_M = 14.0

# Stride applied to the native 0.083° (~10 km) grid. Stride 60 ≈ 5°, keeping
# event volume comparable to OISST/MHW and well inside Neon free.
STRIDE = 60

DATASET_ID = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
VARIABLE = "VHM0"  # significant wave height of combined wind and swell, m


def fetch(lookback_days: int = 2) -> list[Event]:
    """Returns extreme-swell Events from the Copernicus global wave product.

    No CMEMS creds → returns [] with a stderr note. Don't treat empty as
    failure; it just means the user opted out.
    """
    user = os.environ.get("CMEMS_USERNAME")
    pwd = os.environ.get("CMEMS_PASSWORD")
    if not user or not pwd:
        print(
            "[copernicus_waves] CMEMS_USERNAME / CMEMS_PASSWORD not set — "
            "skipping (this source is opt-in).",
            file=sys.stderr,
        )
        return []

    try:
        # Lazy import: only fails for users who opted in but didn't install
        # the toolbox. The error message is short and actionable.
        import copernicusmarine  # type: ignore
    except ImportError:
        print(
            "[copernicus_waves] `copernicusmarine` package not installed. "
            "Run `pip install copernicusmarine` and re-run.",
            file=sys.stderr,
        )
        return []

    # Authenticate. The toolbox caches creds after first login, so passing
    # them per-call is idempotent and works in a headless CI run too.
    try:
        copernicusmarine.login(  # type: ignore[attr-defined]
            username=user, password=pwd, configuration_file_directory=None, force_overwrite=True
        )
    except Exception as exc:
        print(f"[copernicus_waves] login failed: {exc}", file=sys.stderr)
        return []

    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=max(1, lookback_days))

    try:
        ds = copernicusmarine.open_dataset(  # type: ignore[attr-defined]
            dataset_id=DATASET_ID,
            variables=[VARIABLE],
            start_datetime=start.isoformat() + "T00:00:00",
            end_datetime=today.isoformat() + "T23:59:59",
        )
    except Exception as exc:
        print(f"[copernicus_waves] open_dataset failed: {exc}", file=sys.stderr)
        return []

    # Daily max over time + stride downsample. xarray comes in transitively
    # with copernicusmarine.
    try:
        daily_max = ds[VARIABLE].resample(time="1D").max()
        # Stride sample to keep volumes manageable. The dataset uses
        # `latitude`/`longitude` dim names.
        sampled = daily_max.isel(
            latitude=slice(None, None, STRIDE),
            longitude=slice(None, None, STRIDE),
        )
    except Exception as exc:
        print(f"[copernicus_waves] resample/stride failed: {exc}", file=sys.stderr)
        return []

    events: list[Event] = []
    # Iterate the (time, lat, lon) -> Hs cube. xarray's .to_dataframe gives
    # the cleanest path; we deliberately keep this loop simple since stride
    # already collapsed volume.
    try:
        df = sampled.to_dataframe().dropna().reset_index()
    except Exception as exc:
        print(f"[copernicus_waves] to_dataframe failed: {exc}", file=sys.stderr)
        return []

    for row in df.itertuples(index=False):
        hs = float(getattr(row, VARIABLE))
        if hs < SWELL_THRESHOLD_M:
            continue
        ts = getattr(row, "time")
        lat = float(getattr(row, "latitude"))
        lon = float(getattr(row, "longitude"))
        # Normalize ts (xarray gives numpy.datetime64) to tz-aware UTC.
        try:
            day = ts.to_pydatetime().replace(tzinfo=timezone.utc)
        except AttributeError:
            day = datetime.fromisoformat(str(ts)[:19]).replace(tzinfo=timezone.utc)
        cell = f"{round(lat):+03d}_{round(lon):+04d}"
        events.append(
            Event(
                source="copernicus-marine",
                source_event_id=f"{cell}-{day.date().isoformat()}-swell",
                hazard_type=HAZARD_SWELL,
                geometry=point(lon, lat),
                title=f"Extreme swell ({hs:.1f} m, Copernicus)",
                severity_raw=f"Hs {hs:.1f} m",
                intensity_norm=clamp01(
                    (hs - SWELL_THRESHOLD_M) / (SWELL_SATURATION_M - SWELL_THRESHOLD_M)
                ),
                started_at=day,
                ended_at=day,
                url="https://data.marine.copernicus.eu",
                metadata={"hs_m": round(hs, 2), "cell": cell, "dataset": DATASET_ID},
            )
        )
    return events
