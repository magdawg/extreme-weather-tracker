"""Ingestion orchestrator — run by GitHub Actions every 12h (or locally).

    python run.py                       # all sources, routine recent window
    python run.py --source gdacs firms
    python run.py --source gdacs --backfill   # one-shot GDACS history back to 2021
"""
from __future__ import annotations

import argparse
import sys
import time

import config
import db
from sources import firms, gdacs, temperature


def run_gdacs(backfill: bool = False) -> list:
    return gdacs.fetch(lookback_days=config.LOOKBACK_DAYS, backfill=backfill)


def run_firms(backfill: bool = False) -> list:
    key = config.require("FIRMS_MAP_KEY", config.FIRMS_MAP_KEY)
    return firms.fetch(
        map_key=key,
        source=config.FIRMS_SOURCE,
        lookback_days=config.LOOKBACK_DAYS,
        grid_deg=config.FIRMS_GRID_DEG,
        min_detections=config.FIRMS_MIN_DETECTIONS,
        min_intensity=config.FIRMS_MIN_INTENSITY,
    )


def run_temperature(backfill: bool = False) -> list:
    return temperature.fetch(lookback_days=config.LOOKBACK_DAYS)


SOURCES = {
    "gdacs": run_gdacs,
    "firms": run_firms,
    "temperature": run_temperature,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Extreme weather ingestion")
    parser.add_argument("--source", nargs="*", choices=list(SOURCES), help="subset of sources")
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="GDACS only: one-shot deep history pull back to 2021 (idempotent). "
        "Other sources ignore it.",
    )
    args = parser.parse_args()

    config.require("DATABASE_URL", config.DATABASE_URL)
    selected = args.source or list(SOURCES)

    conn = db.connect(config.DATABASE_URL)
    total = 0
    try:
        for name in selected:
            started = time.time()
            try:
                events = SOURCES[name](backfill=args.backfill)
                n = db.upsert_events(conn, events)
                total += n
                print(f"[{name}] upserted {n} events in {time.time() - started:.1f}s")
            except Exception as exc:  # one source failing shouldn't kill the run
                print(f"[{name}] FAILED: {exc}", file=sys.stderr)
    finally:
        conn.close()

    print(f"Done. {total} events upserted across {len(selected)} source(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
