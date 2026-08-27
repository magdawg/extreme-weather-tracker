"""IFRC GO resolver — link events to Red Cross / Red Crescent emergency pages.

IFRC GO is the open Red Cross emergency-operations portal. Open API, no key.
Public URL pattern: https://go.ifrc.org/emergencies/{event_id}.

What we surface to the UI: the canonical IFRC GO emergency URL + a "Red Cross
is responding" framing, with the appeal funding numbers when present. This is
NOT a consumer donate button — go.ifrc.org is a coordination platform, not a
payment flow — but it's an authoritative "the Red Cross is on the ground here"
signal and the appeal numbers give a sense of scale.

Why we hit /event/ and not /appeal/: an IFRC GO appeal record sometimes
outlives its event record, so /api/v2/event/{id} can 404 while the appeal still
shows up in /api/v2/appeal/. That's exactly the case that produced the
empty-page bug during the spike (Nepal drought — visible appeal, dead event).
By matching against /event/ we guarantee the public URL renders.

See SPIKE_DONATIONS.md for full probe notes.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta, timezone
from typing import Any

import requests

from .common import ISO3_TO_ISO2, iso_codes_for_geom
from .db import CandidateEvent

_BASE = "https://goadmin.ifrc.org/api/v2"
_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1"}

# IFRC's dtype.name vocabulary → our hazard taxonomy. Anything not listed (or
# mapped to None) is intentionally skipped — we don't surface IFRC links for
# epidemics, population movements, earthquakes, etc.
IFRC_HAZARD = {
    "Drought":              "drought",
    "Fire":                 "wildfire",
    "Flood":                "flood",
    "Flash Flood":          "flood",
    "Pluvial/Flash Flood":  "flood",
    "Cyclone":              "storm",
    "Storm Surge":          "storm",
    "Heat Wave":            "heat",
}

# How far (in days) an IFRC event can be from a GDACS event and still count as
# the same disaster. Appeals are often raised days/weeks after the disaster
# starts, so we need a generous window.
WINDOW_DAYS = 45


def fetch_events(days_back: int = 365, max_pages: int = 20) -> list[dict[str, Any]]:
    """Page through IFRC GO events newer than `days_back`. ~200/page; small
    enough that we keep the full set in memory and match in Python."""
    since = (datetime.now(timezone.utc) - timedelta(days=days_back)).date().isoformat()
    out: list[dict[str, Any]] = []
    offset = 0
    for _ in range(max_pages):
        r = requests.get(
            f"{_BASE}/event/",
            params={
                "disaster_start_date__gte": f"{since}T00:00:00Z",
                "limit": 200, "offset": offset,
                "ordering": "-disaster_start_date",
            },
            timeout=60, headers=_HEADERS,
        )
        r.raise_for_status()
        data = r.json()
        results = data.get("results") or []
        if not results:
            break
        out.extend(results)
        if not data.get("next"):
            break
        offset += 200
    return [_normalize(e) for e in out if _normalize(e)]


def _normalize(e: dict) -> dict | None:
    """Reshape an IFRC event into the bare slice the matcher needs."""
    dtype_name = (e.get("dtype") or {}).get("name") or ""
    hazard = IFRC_HAZARD.get(dtype_name)
    if not hazard:
        return None
    iso3 = {(c.get("iso3") or "").upper() for c in (e.get("countries") or [])
            if c.get("iso3")}
    appeals = e.get("appeals") or []
    return {
        "id":          e.get("id"),
        "hazard":      hazard,
        "iso3":        iso3,
        "start":       _parse(e.get("disaster_start_date")),
        "n_appeals":   len(appeals),
        "amount_req":  int(sum(a.get("amount_requested") or 0 for a in appeals)),
        "amount_fund": int(sum(a.get("amount_funded")    or 0 for a in appeals)),
        "url":         f"https://go.ifrc.org/emergencies/{e.get('id')}",
    }


def _parse(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00")[:32])
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def resolve(events: Iterable[CandidateEvent]) -> list[dict]:
    """Match candidate events against IFRC GO, return upsert rows.

    Returns a list of dicts shaped for resolvers.db.upsert_donations. Only
    events with a hit are returned — un-matched events get no row, so future
    runs will retry them.
    """
    ifrc = fetch_events()
    if not ifrc:
        return []

    # Index IFRC events by iso3 once so per-candidate matching is a dict probe.
    by_iso3: dict[str, list[dict]] = {}
    for ie in ifrc:
        for code in ie["iso3"]:
            by_iso3.setdefault(code, []).append(ie)

    rows: list[dict] = []
    for ev in events:
        iso2, iso3 = iso_codes_for_geom(ev.geom)
        if not iso3:
            continue
        candidates = by_iso3.get(iso3, [])
        if not candidates:
            continue
        best = _best_match(ev, candidates)
        if not best:
            continue
        rows.append({
            "event_id":              ev.id,
            "ifrc_url":              best["url"],
            "ifrc_appeal_requested": best["amount_req"] or None,
            "ifrc_appeal_funded":    best["amount_fund"] or None,
            # Leave the GG columns NULL — upsert COALESCEs, so a later GG run
            # won't be clobbered by this one.
            "gg_url": None, "gg_title": None, "gg_org": None,
        })
    return rows


def _best_match(ev: CandidateEvent, candidates: list[dict]) -> dict | None:
    """Pick the closest IFRC event by hazard + date window. Prefer ones with a
    live appeal — that's what the UI actually surfaces."""
    g_from = ev.started_at or datetime.now(timezone.utc)
    g_to   = ev.ended_at or g_from
    matches = []
    for ie in candidates:
        if ie["hazard"] != ev.hazard_type:
            continue
        if not ie["start"]:
            continue
        if not (g_from - timedelta(days=WINDOW_DAYS) <= ie["start"] <= g_to + timedelta(days=WINDOW_DAYS)):
            continue
        matches.append(ie)
    if not matches:
        return None
    # Prefer the one with the most funded $ — proxy for "the most established
    # response", and what we actually want to show in the UI.
    matches.sort(key=lambda m: (-m["amount_fund"], -m["n_appeals"]))
    return matches[0]


# Side-effect-free shim so the orchestrator can import a single `run(url)`.
def run(database_url: str, lookback_days: int = 180) -> int:
    # Short-lived connections only — the IFRC fetch is fast today, but the
    # pattern matches the GG resolver so the connection is never held across
    # an HTTP loop (Neon drops idle connections; see run.py).
    import db as _db
    from .db import select_candidates, upsert_donations
    conn = _db.connect(database_url)
    try:
        candidates = select_candidates(conn, lookback_days=lookback_days, missing="ifrc")
    finally:
        conn.close()
    if not candidates:
        return 0
    rows = resolve(candidates)
    conn = _db.connect(database_url)
    try:
        return upsert_donations(conn, rows)
    finally:
        conn.close()


# Helper available for ad-hoc inspection from a REPL.
__all__ = ["fetch_events", "resolve", "run", "IFRC_HAZARD", "ISO3_TO_ISO2"]
