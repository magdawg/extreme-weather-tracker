"""Thin Postgres layer: connect + idempotent upsert of canonical events."""
from __future__ import annotations

import json
from collections.abc import Iterable

import psycopg2
import psycopg2.extras

from normalize import Event

UPSERT_SQL = """
INSERT INTO events (
    source, source_event_id, hazard_type, title, severity_raw,
    intensity_norm, geom, started_at, ended_at, country, url, metadata
) VALUES (
    %(source)s, %(source_event_id)s, %(hazard_type)s, %(title)s, %(severity_raw)s,
    %(intensity_norm)s, ST_SetSRID(ST_GeomFromGeoJSON(%(geom)s), 4326),
    %(started_at)s, %(ended_at)s, %(country)s, %(url)s, %(metadata)s::jsonb
)
ON CONFLICT (source, source_event_id, hazard_type) DO UPDATE SET
    title          = EXCLUDED.title,
    severity_raw   = EXCLUDED.severity_raw,
    intensity_norm = EXCLUDED.intensity_norm,
    geom           = EXCLUDED.geom,
    started_at     = EXCLUDED.started_at,
    ended_at       = EXCLUDED.ended_at,
    country        = EXCLUDED.country,
    url            = EXCLUDED.url,
    metadata       = EXCLUDED.metadata,
    ingested_at    = now();
"""


def connect(database_url: str):
    # Keepalives stop Neon (serverless) from silently dropping the socket while
    # a connection is briefly idle between batches. Connections should still be
    # short-lived — never held open across a long fetch (see run.py).
    return psycopg2.connect(
        database_url,
        keepalives=1,
        keepalives_idle=30,
        keepalives_interval=10,
        keepalives_count=5,
    )


def vacuum_analyze(conn, table: str = "events") -> None:
    """Reclaim dead tuples and refresh planner stats on `table`.

    Run after a batch of upserts so the next reader doesn't pay hint-bit
    dirtying on every page (seen as `dirtied=N` in EXPLAIN BUFFERS) and the
    planner has fresh row-count stats. VACUUM must run outside a transaction,
    so we flip the connection to autocommit for this one statement.
    """
    prev = conn.autocommit
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(f"VACUUM (ANALYZE) {table}")
    finally:
        conn.autocommit = prev


def upsert_events(conn, events: Iterable[Event]) -> int:
    rows = [
        {
            "source": e.source,
            "source_event_id": e.source_event_id,
            "hazard_type": e.hazard_type,
            "title": e.title,
            "severity_raw": e.severity_raw,
            "intensity_norm": e.intensity_norm,
            "geom": json.dumps(e.geometry),
            "started_at": e.started_at,
            "ended_at": e.ended_at,
            "country": e.country,
            "url": e.url,
            "metadata": json.dumps(e.metadata),
        }
        for e in events
    ]
    if not rows:
        return 0
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, UPSERT_SQL, rows, page_size=200)
    conn.commit()
    return len(rows)
