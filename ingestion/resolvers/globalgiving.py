"""GlobalGiving resolver — link events to a vetted NGO project with a real
donate URL on globalgiving.org.

Why this exists separately from IFRC GO: GlobalGiving is the only candidate
among our three (RW / IFRC / GG) that ends a click on an actual payment flow.
IFRC GO pages are operations portals, ReliefWeb pages are sit-rep archives.
For a true "Donate" button in the UI we need a GG project URL.

The matching strategy (validated in the spike, see SPIKE_DONATIONS.md):
  1. Per ISO2 country, pull all disaster-themed projects (cap at the page
     budget — GG paginates 10 per call).
  2. For each candidate event, score each disaster project on whether its
     title / summary mentions the hazard family or a hazard synonym.
  3. Require score ≥ 2 ("hazard word present"). This is what filters out the
     biggest failure mode the spike surfaced: a 2026 cyclone matching a 2019
     Cyclone-Idai relief project just because they share country + theme.

Even with the score filter, ~30% of strong matches are wrong-event noise.
The UI framing must reflect that — "Donate to disaster recovery in {country}
via GlobalGiving" is honest, "Donate to this event" overpromises.
"""
from __future__ import annotations

import os
import sys
from collections.abc import Iterable
from typing import Any

import requests

from .common import iso_codes_for_geom
from .db import CandidateEvent

_BASE = "https://api.globalgiving.org/api/public/projectservice"
_HEADERS = {"User-Agent": "extreme-weather-tracker/0.1",
            "Accept": "application/json"}

# How many country-summary pages to pull at most (10 projects per page).
# 10 pages = 100 projects per country, which catches the disaster subset in
# every country tested in the spike. Raising it past 10 mostly burns HTTP time
# on irrelevant projects; lower it via env if your run is rate-limited.
MAX_PAGES_PER_COUNTRY = int(os.environ.get("GG_MAX_PAGES_PER_COUNTRY", "10"))

# Stop paging a country once we've seen this many consecutive pages with no
# disaster-themed project — protects big countries where disaster projects
# cluster at the start of the list from paying for irrelevant downstream pages.
DRY_PAGES_BEFORE_STOP = 3

# Stable theme id for "Disaster Response" — confirmed against the live themes
# endpoint. The list is small (28 themes) and stable, so we hardcode rather
# than rediscover on every run.
DISASTER_THEME_ID = "disaster"

# Hazard-family keywords that must appear in a project's title or summary for
# the match to count as event-specific. Lowercased substring match.
HAZARD_KEYWORDS = {
    "storm":    ("storm", "cyclone", "typhoon", "hurricane"),
    "flood":    ("flood",),
    "wildfire": ("fire", "wildfire", "fuego", "incendio"),
    "drought":  ("drought", "sequía", "famine"),
    "heat":     ("heatwave", "heat wave"),
}


def _get(path: str, key: str, **params) -> dict:
    params["api_key"] = key
    r = requests.get(f"{_BASE}{path}", params=params, timeout=60, headers=_HEADERS)
    r.raise_for_status()
    return r.json()


def fetch_country_projects(iso2: str, api_key: str) -> list[dict]:
    """Page through projects in a country and extract project records only.

    The response embeds organization records that look project-shaped to a
    naive walker — we discriminate by signature (orgs have `name`, projects
    have `title`).

    Stops early when we've seen `DRY_PAGES_BEFORE_STOP` consecutive pages with
    no disaster-themed project. That covers the common case where a country
    has 600 projects but only the first 30-ish are disaster-themed, without
    paying for the remaining 570 across the wire.
    """
    out: list[dict] = []
    next_id: int | None = None
    dry_streak = 0
    for _page_idx in range(MAX_PAGES_PER_COUNTRY):
        params = {"nextProjectId": next_id} if next_id is not None else {}
        try:
            data = _get(f"/countries/{iso2}/projects/summary", api_key, **params)
        except requests.HTTPError:
            break
        page, has_next, nxt = [], False, None

        def walk(obj, parent_key=None):
            nonlocal has_next, nxt
            if isinstance(obj, dict):
                if "hasNext" in obj:
                    has_next = bool(obj["hasNext"])
                if "nextProjectId" in obj:
                    nxt = obj["nextProjectId"]
                # A project has `title` (orgs have `name`); never descend into
                # the org block that sits inside each project.
                if obj.get("title") and parent_key != "organization":
                    page.append(obj)
                    return
                for k, v in obj.items():
                    walk(v, parent_key=k)
            elif isinstance(obj, list):
                for v in obj:
                    walk(v, parent_key=parent_key)

        walk(data)
        out.extend(page)
        if any(project_is_disaster(p) for p in page):
            dry_streak = 0
        else:
            dry_streak += 1
            if dry_streak >= DRY_PAGES_BEFORE_STOP:
                break
        if not has_next or nxt is None or nxt == next_id:
            break
        next_id = nxt
    return out


def project_is_disaster(p: dict) -> bool:
    """A project belongs to the Disaster Response theme. The themes array is
    nested as p.themes.theme[]."""
    themes = p.get("themes") or {}
    if isinstance(themes, dict):
        themes = themes.get("theme") or []
    if not isinstance(themes, list):
        return False
    for t in themes:
        if isinstance(t, dict) and t.get("id") == DISASTER_THEME_ID:
            return True
    return False


def score_project(ev: CandidateEvent, p: dict) -> int:
    """How event-relevant is this project? Higher is better. Score >= 2 means
    a hazard keyword is in the project text — the filter that kicks out
    same-country-but-different-event matches."""
    text = " ".join(filter(None, [
        p.get("title") or "",
        p.get("summary") or "",
    ])).lower()
    score = 0
    if ev.hazard_type in text:
        score += 2
    for w in HAZARD_KEYWORDS.get(ev.hazard_type, ()):
        if w in text:
            score += 1
    if ev.started_at:
        # A project that mentions a year close to the event is more likely to
        # be that specific event's response, not a years-old campaign.
        for yr in (ev.started_at.year, ev.started_at.year - 1):
            if str(yr) in text:
                score += 1
    return score


def resolve(events: Iterable[CandidateEvent], api_key: str,
            log: bool = True) -> list[dict]:
    """Match candidate events against GlobalGiving, return upsert rows.

    Progress is printed to stderr per country (one log line per country fetch)
    so a slow run looks like progress, not a hang. Pass log=False from tests.
    """
    if not api_key:
        return []

    # Resolve every candidate's iso2 up front, then iterate countries (not
    # candidates) so we know the total country count for progress.
    by_iso2: dict[str, list[CandidateEvent]] = {}
    for ev in events:
        iso2, _ = iso_codes_for_geom(ev.geom)
        if iso2:
            by_iso2.setdefault(iso2, []).append(ev)
    total = len(by_iso2)
    if log:
        print(f"[gg] {total} unique countries to scan from {len(list(events) if False else by_iso2)} resolved iso2s",
              file=sys.stderr)

    rows: list[dict] = []
    for i, (iso2, country_events) in enumerate(by_iso2.items(), 1):
        try:
            projects = fetch_country_projects(iso2, api_key)
        except Exception as exc:
            if log:
                print(f"[gg] [{i}/{total}] {iso2}: fetch failed ({exc})", file=sys.stderr)
            continue
        disaster_projects = [p for p in projects if project_is_disaster(p)]
        matched_here = 0
        for ev in country_events:
            if not disaster_projects:
                continue
            scored = sorted(((score_project(ev, p), p) for p in disaster_projects),
                            key=lambda x: -x[0])
            top_score, top = scored[0]
            # Require an actual hazard match — the spike showed this filter is
            # the difference between "real same-event match" and "wrong campaign
            # in the same country". Score < 2 ≈ "just any disaster project here".
            if top_score < 2:
                continue
            pid = top.get("id")
            if not pid:
                continue
            org_name = (top.get("organization") or {}).get("name")
            rows.append({
                "event_id":              ev.id,
                "ifrc_url": None, "ifrc_appeal_requested": None, "ifrc_appeal_funded": None,
                "gg_url":   f"https://www.globalgiving.org/projects/{pid}/",
                "gg_title": top.get("title"),
                "gg_org":   org_name,
            })
            matched_here += 1
        if log:
            print(f"[gg] [{i}/{total}] {iso2}: {len(projects)} projects, "
                  f"{len(disaster_projects)} disaster-themed, "
                  f"{matched_here}/{len(country_events)} events matched",
                  file=sys.stderr)
    return rows


def run(database_url: str, api_key: str | None = None, lookback_days: int = 180) -> int:
    # Short-lived connections only — the GG resolve loop pages through ~136
    # countries over many minutes, and Neon drops idle connections well before
    # that. Open → select → close, run the HTTP loop with no connection held,
    # then open → upsert → close. (Matches the `_upsert` pattern in run.py.)
    import db as _db
    from .db import select_candidates, upsert_donations
    api_key = api_key or os.environ.get("GLOBALGIVING_API_KEY", "")
    if not api_key:
        return 0
    conn = _db.connect(database_url)
    try:
        # `missing="gg"` covers the back-to-back-with-IFRC case: events IFRC just
        # touched (resolved_at fresh) but whose gg_url is still NULL still come
        # back as candidates here. Without this, GG silently skips everything
        # IFRC matched in the same pass.
        candidates = select_candidates(conn, lookback_days=lookback_days, missing="gg")
    finally:
        conn.close()
    if not candidates:
        return 0
    rows = resolve(candidates, api_key=api_key)
    conn = _db.connect(database_url)
    try:
        return upsert_donations(conn, rows)
    finally:
        conn.close()


__all__ = ["fetch_country_projects", "resolve", "run",
           "DISASTER_THEME_ID", "HAZARD_KEYWORDS"]
