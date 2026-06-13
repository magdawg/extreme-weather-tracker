"""Ingestion orchestrator — run by GitHub Actions every 12h (or locally).

    python run.py                                    # all sources, routine recent window
    python run.py --source gdacs firms
    python run.py --source gdacs --backfill          # one-shot GDACS history back to 2015
    python run.py --source temperature --backfill    # one-shot ERA5 heat history back to 2021
"""
from __future__ import annotations

import argparse
import sys
import time

import config
import db
import enso
from sources import firms, gdacs, temperature


def run_gdacs() -> list:
    return gdacs.fetch(lookback_days=config.LOOKBACK_DAYS)


def _upsert(events: list) -> int:
    """Open a short-lived connection, write, close. Never hold a connection
    across a fetch — Neon drops idle connections."""
    conn = db.connect(config.DATABASE_URL)
    try:
        return db.upsert_events(conn, events)
    finally:
        conn.close()


def run_gdacs_backfill() -> int:
    """Stream the deep-history pull year by year, upserting each as it lands so
    a multi-year run never buffers everything or holds the connection idle."""
    total = 0
    for year, events in gdacs.fetch_backfill():
        n = _upsert(events)
        total += n
        print(f"[gdacs] {year}: upserted {n} events ({total} so far)")
    return total


def run_temperature_backfill(from_year: int | None = None) -> int:
    """Same streaming pattern as GDACS: yield + upsert one year at a time so a
    multi-year ERA5 sweep never buffers everything or holds the connection idle.

    `from_year` lets a re-run resume from the first missing year instead of
    redoing every year — see fetch_backfill's docstring.
    """
    total = 0
    for year, events in temperature.fetch_backfill(from_year=from_year):
        n = _upsert(events)
        total += n
        print(f"[temperature] {year}: upserted {n} events ({total} so far)")
    return total


def run_firms() -> list:
    key = config.require("FIRMS_MAP_KEY", config.FIRMS_MAP_KEY)
    return firms.fetch(
        map_key=key,
        source=config.FIRMS_SOURCE,
        lookback_days=config.LOOKBACK_DAYS,
        grid_deg=config.FIRMS_GRID_DEG,
        min_detections=config.FIRMS_MIN_DETECTIONS,
        min_intensity=config.FIRMS_MIN_INTENSITY,
    )


def run_temperature() -> list:
    return temperature.fetch(lookback_days=config.LOOKBACK_DAYS)


SOURCES = {
    "gdacs": run_gdacs,
    "firms": run_firms,
    "temperature": run_temperature,
}

# ENSO is not an Event source — it writes its own enso_oni table, not events —
# so it lives outside SOURCES and runs as a separate step. It's selectable via
# `--source enso` and is included in a full (no --source) run.
def run_enso() -> int:
    # Pull both ENSO products — the smoothed ONI (enso_oni) and the fresher
    # monthly Niño-3.4 anomaly (enso_nino34) — and write them in one connection.
    # Fetch before connecting so we never hold a Neon connection across HTTP.
    oni = enso.fetch()
    nino34 = enso.fetch_nino34_monthly()
    conn = db.connect(config.DATABASE_URL)
    try:
        return enso.upsert(conn, oni) + enso.upsert_nino34(conn, nino34)
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Extreme weather ingestion")
    parser.add_argument(
        "--source",
        nargs="*",
        choices=list(SOURCES) + ["enso"],
        help="subset of sources (also: 'enso' for the ENSO/ONI climate index)",
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="GDACS (back to 2015) and temperature (back to 2021): one-shot "
        "deep history pull (idempotent). Other sources ignore it.",
    )
    parser.add_argument(
        "--from-year",
        type=int,
        default=None,
        help="Temperature backfill: re-run from this year forward instead of "
        "BACKFILL_FROMDATE (e.g. --from-year 2025 to resume after a partial run).",
    )
    args = parser.parse_args()

    config.require("DATABASE_URL", config.DATABASE_URL)
    selected = args.source or list(SOURCES) + ["enso"]

    total = 0
    for name in selected:
        started = time.time()
        try:
            if name == "enso":
                # Not an Event source: writes enso_oni and returns a row count.
                n = run_enso()
                print(f"[enso] upserted {n} ONI + monthly Niño-3.4 rows in {time.time() - started:.1f}s")
                continue
            if name == "gdacs" and args.backfill:
                # Streams + writes per year; connects per batch internally.
                n = run_gdacs_backfill()
            elif name == "temperature" and args.backfill:
                n = run_temperature_backfill(from_year=args.from_year)
            else:
                events = SOURCES[name]()
                n = _upsert(events)
            total += n
            print(f"[{name}] upserted {n} events in {time.time() - started:.1f}s")
        except Exception as exc:  # one source failing shouldn't kill the run
            print(f"[{name}] FAILED: {exc}", file=sys.stderr)

    # Reclaim dead tuples + refresh stats once at the end so readers don't pay
    # hint-bit dirtying on the pages we just wrote. Best-effort: a VACUUM
    # failure shouldn't mask a successful ingestion.
    if total > 0:
        try:
            conn = db.connect(config.DATABASE_URL)
            try:
                db.vacuum_analyze(conn, "events")
                print("[vacuum] VACUUM (ANALYZE) events")
            finally:
                conn.close()
        except Exception as exc:
            print(f"[vacuum] FAILED: {exc}", file=sys.stderr)

    print(f"Done. {total} events upserted across {len(selected)} source(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
