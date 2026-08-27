"""DB-side helpers for the donation resolvers — candidate selection and upsert."""
from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

import psycopg2.extras

# Only resolve hazards plausibly tied to a relief campaign. Marine / biosphere /
# air-quality events have no Red Cross or GlobalGiving counterpart.
RESOLVABLE_HAZARDS = ("storm", "flood", "wildfire", "drought", "heat")

# Re-resolve recent events at most once per `STALE_DAYS` even when the row
# already exists — appeals get launched, funded, and closed over time.
STALE_DAYS = 14


@dataclass
class CandidateEvent:
    id: int
    hazard_type: str
    started_at: datetime | None
    ended_at: datetime | None
    geom: dict           # parsed from ST_AsGeoJSON
    country: str | None  # source-reported country string


# Per-resolver column whose NULL-ness signals "this resolver hasn't run here yet".
# Whitelisted (not user input) so it's safe to interpolate into the SQL.
_MISSING_COLUMN = {"ifrc": "ifrc_url", "gg": "gg_url"}


def _build_candidates_sql(missing: str | None) -> str:
    """Candidates are recent + right-hazard, AND either
      - never resolved (no row in event_donations), OR
      - the specific resolver's column is NULL (the OTHER resolver ran but this
        one didn't yet — important when both run back-to-back in one pass), OR
      - last resolved long enough ago to be considered stale.
    Pass `missing=None` to use the resolver-agnostic gate (cron-style "redo
    everything older than STALE_DAYS")."""
    if missing is None:
        per_resolver = ""
    else:
        col = _MISSING_COLUMN[missing]
        per_resolver = f"OR d.{col} IS NULL "
    return f"""
        SELECT e.id, e.hazard_type, e.started_at, e.ended_at, e.country,
               ST_AsGeoJSON(e.geom) AS geom_json
        FROM events e
        LEFT JOIN event_donations d ON d.event_id = e.id
        WHERE e.hazard_type = ANY(%s)
          AND e.started_at >= now() - %s * INTERVAL '1 day'
          AND (d.event_id IS NULL
               {per_resolver}
               OR d.resolved_at < now() - {STALE_DAYS} * INTERVAL '1 day')
        ORDER BY e.started_at DESC
        LIMIT %s
    """


def select_candidates(conn, lookback_days: int = 180, limit: int = 5000,
                       missing: str | None = None) -> list[CandidateEvent]:
    """Events worth (re)resolving. `missing` is a resolver key (`'ifrc'` /
    `'gg'`) that adds an extra gate: events missing THAT resolver's column
    are also returned, even if a different resolver just touched them and
    bumped resolved_at. This is what lets IFRC and GG run back-to-back in one
    orchestrator pass without GG silently skipping every event IFRC matched."""
    sql = _build_candidates_sql(missing)
    with conn.cursor() as cur:
        cur.execute(sql, (list(RESOLVABLE_HAZARDS), lookback_days, limit))
        rows = cur.fetchall()
    out = []
    for (eid, hz, started, ended, country, geom_json) in rows:
        try:
            geom = json.loads(geom_json) if geom_json else None
        except (TypeError, ValueError):
            geom = None
        out.append(CandidateEvent(
            id=eid, hazard_type=hz, started_at=started, ended_at=ended,
            geom=geom or {}, country=country,
        ))
    return out


UPSERT_SQL = """
INSERT INTO event_donations (
    event_id,
    ifrc_url, ifrc_appeal_requested, ifrc_appeal_funded,
    gg_url, gg_title, gg_org,
    resolved_at
) VALUES (
    %(event_id)s,
    %(ifrc_url)s, %(ifrc_appeal_requested)s, %(ifrc_appeal_funded)s,
    %(gg_url)s, %(gg_title)s, %(gg_org)s,
    now()
)
ON CONFLICT (event_id) DO UPDATE SET
    ifrc_url              = COALESCE(EXCLUDED.ifrc_url,              event_donations.ifrc_url),
    ifrc_appeal_requested = COALESCE(EXCLUDED.ifrc_appeal_requested, event_donations.ifrc_appeal_requested),
    ifrc_appeal_funded    = COALESCE(EXCLUDED.ifrc_appeal_funded,    event_donations.ifrc_appeal_funded),
    gg_url                = COALESCE(EXCLUDED.gg_url,                event_donations.gg_url),
    gg_title              = COALESCE(EXCLUDED.gg_title,              event_donations.gg_title),
    gg_org                = COALESCE(EXCLUDED.gg_org,                event_donations.gg_org),
    resolved_at           = now();
"""


def upsert_donations(conn, rows: Iterable[dict]) -> int:
    """Upsert one row per event. NULL fields don't overwrite existing values —
    each resolver fills only its own columns, so running just IFRC doesn't
    clobber a GlobalGiving link already there (and vice versa).
    """
    rows = list(rows)
    if not rows:
        return 0
    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, UPSERT_SQL, rows, page_size=200)
    conn.commit()
    return len(rows)
