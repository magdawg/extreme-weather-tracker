# Spike: donation links on events — plan & status

Goal: when a user clicks an extreme-weather event on the map, surface a way
for them to **help the affected people**. Either a "View relief efforts" link
to an authoritative response page, or — better — a direct donate URL.

This doc tracks three candidate sources spiked against the live data, what
each one actually delivers, and what's left to do before any of them are
wired into the schema / API / UI.

## Implementation status (2026-06-15)

| Source | Status |
|---|---|
| IFRC GO | ✅ wired in (`ingestion/resolvers/ifrc.py`, surfaced as "Red Cross is responding" in EventDetails) |
| GlobalGiving | ✅ wired in (`ingestion/resolvers/globalgiving.py`, surfaced as "Donate via GlobalGiving" button). Requires `GLOBALGIVING_API_KEY`; skipped when unset |
| ReliefWeb | ❌ deferred — sit-rep aggregator with no donate flow; would only carry context |

The post-ingestion resolvers run as part of the standard `python run.py`
pass (after sources and before VACUUM), and can be invoked alone with
`python run.py --source donations`. They write to `event_donations`
(one-to-one with `events` via FK on `event_id`). The /events API LEFT JOINs
this table; donations data is included under `properties.donations` only
when at least one resolver matched.

## TL;DR status

| Source | What it gives | Match rate (GDACS Orange+Red, last 180d) | Donate button on the page? | API auth | Spike status |
|---|---|:---:|:---:|---|:---:|
| **ReliefWeb** | OCHA disaster index pages (sit reps, news, response coordination) | 43% (6/14, fuzzy) — 21% via exact GLIDE | ❌ informational only | Free API requires registered `appname` (since Nov 2025) | ✅ probed |
| **IFRC GO** | Red Cross emergency records with appeals, money raised, response ops | **64% (9/14)** — and every match has an active appeal | ❌ internal coordination portal, not consumer-facing | Free, no key | ✅ probed |
| **GlobalGiving** | NGO disaster-recovery projects with **real public donate URLs** | 71% surface match, **~30% genuine same-event** after filtering wrong-cyclone false positives | ✅ direct donate page on globalgiving.org | Free API requires registered key | ✅ probed |

Probes live in `/tmp/`:
- `/tmp/reliefweb_probe.py`
- `/tmp/ifrc_probe.py`
- `/tmp/globalgiving_probe.py`

None of these are wired into ingestion yet. This doc captures the design
work and findings so we can implement at speed when the time comes.

---

## The donate-button reality check

Of the three candidates, **only GlobalGiving exposes a clickable public
donate URL through a free API**. ReliefWeb and IFRC GO are both authoritative
about *which* disasters are real and *who* is responding to them, but neither
hands you a "click here to donate" link:

- **ReliefWeb pages** are situation-report aggregators. Useful context, no
  donate CTA.
- **IFRC GO pages** are an operations portal for Red Cross national societies
  and IFRC staff. They expose the appeal record (amount requested, amount
  funded, beneficiaries) but the actual consumer donation flow lives on
  `www.ifrc.org` (Cloudflare-protected, can't be linked programmatically) or
  on each national Red Cross's own site.

So the realistic UX has two paths and they're complementary, not exclusive:

1. **"View relief efforts" link** — match the event against ReliefWeb /
   IFRC GO and link to whichever has a live page. Honest framing: "the UN /
   Red Cross are coordinating response here." Implementable today against
   either source.
2. **"Donate to recovery" link** — match against GlobalGiving's
   disaster-recovery projects for a country and link directly to a vetted
   NGO's donate page. Smaller per-disaster coverage, but the click ends in a
   payment flow.

A third path that doesn't depend on any API: a `donation_url` column on
`events`, populated by hand for the few named disasters per year that warrant
it. The IFRC GO match list is the right "what's worth curating right now"
queue — see "Manual override" below.

---

## Source 1 — ReliefWeb (`reliefweb.int`)

**What it is:** UN OCHA's humanitarian information portal. Every named
disaster gets a canonical page with a stable URL like
`https://reliefweb.int/disaster/tc-2026-000050-fsm` (the slug is the GLIDE
code in lowercase).

**Why we care:** authoritative "this disaster exists, here's the response."
Best for the "View relief efforts" framing.

**API access:**
- JSON API at `api.reliefweb.int/v1/disasters` (POST query body).
- **Since November 2025**, requires a pre-approved `appname` parameter.
  Register via the Google form linked from `apidoc.reliefweb.int/parameters`.
  Free, reviewed by email — turnaround ~1 day. **Action required to ship.**
- Public RSS at `reliefweb.int/disasters/rss.xml` works without auth but is
  capped to ~20 featured items — fine for the spike, too narrow for prod.

**Matching strategy (validated in the probe):**
1. **First try exact GLIDE match.** GDACS carries a `glide` field on most
   events (~79% of Orange+Red events have one). ReliefWeb's disaster URL
   slug IS the GLIDE code. Zero false positives when this hits.
2. **Fall back to fuzzy** `(ISO3 country, hazard family, ±30 day window)`.
   GDACS gives us ISO3 in the `iso3` field plus an `affectedcountries[]`
   array — much cleaner than parsing the comma-separated `country` string.

**Important gotcha:** GDACS and ReliefWeb often issue *different* GLIDE
codes for the same physical disaster (different sequence numbers, sometimes
different type prefix — `FL` vs `FF` for flood vs flash flood). The country
ISO3 suffix always agrees; the sequence number is the wildcard. So GLIDE is
a precision shortcut, not the only signal.

**Coverage on the probe:** 6/14 (~43%) of recent GDACS Orange+Red events
matched a featured disaster. Misses were either Green-severity events (which
rarely get RW pages) or smaller events OCHA hadn't promoted.

**What to implement:**
1. Register a ReliefWeb appname.
2. Add an `ingestion/sources/reliefweb.py` style enricher (not a fresh
   hazard source — it doesn't produce events, it annotates existing ones).
3. New column on `events`: `reliefweb_url TEXT NULL`. Resolved nightly.
4. API surfaces it as `properties.reliefweb_url` in the GeoJSON.
5. UI: "View relief efforts" link in the popup when the field is set.

---

## Source 2 — IFRC GO (`go.ifrc.org`)

**What it is:** IFRC's Red Cross / Red Crescent disaster operations
platform. Canonical record per emergency with nested `appeals[]` showing
amount requested, amount funded, beneficiaries reached.

**Why we care:** the strongest "is there real money flowing for this
disaster?" signal in the open-data world. Every match in the probe had at
least one active appeal — so coverage and money-attached-ness are the same
question.

**API access:** completely open. No key, no registration.
- Events: `https://goadmin.ifrc.org/api/v2/event/`
  - Query params: `disaster_start_date__gte`, `limit`, `offset`,
    `ordering=-disaster_start_date`.
- Each event record includes `countries[]` (with `iso3`), `dtype.name`
  (drought / fire / flood / cyclone / …), `disaster_start_date`,
  `appeals[]`, and an integer `id` we use to build the public URL.
- Public URL pattern: `https://go.ifrc.org/emergencies/{event_id}`.

**Sharp edge:** the **appeal** record sometimes outlives the **event** record
in the API — so `goadmin.ifrc.org/api/v2/event/{id}` returns 404 while the
appeal is still listed. When that happens, the public `/emergencies/{id}`
page loads but renders empty (it's a JS app that fetches the event). **Only
match against the `/event/` endpoint**, never against `/appeal/.event` —
that's exactly what produced the "Nepal drought page is blank" bug during
the spike.

**Matching strategy:** `(ISO3 country, hazard family, ±45 day window)`.
GLIDE not needed — IFRC's own dtype taxonomy + ISO3 is enough.

**Hazard mapping (IFRC `dtype.name` → our taxonomy):**

| IFRC name | Our hazard |
|---|---|
| Drought | drought |
| Fire | wildfire |
| Flood, Flash Flood, Pluvial/Flash Flood | flood |
| Cyclone, Storm Surge | storm |
| Heat Wave | heat |
| Cold Wave, Earthquake, Volcanic Eruption, Epidemic, Tsunami, Population Movement | (skipped) |

**Coverage on the probe:** **9/14 (~64%)** of GDACS Orange+Red events matched
an IFRC GO emergency with a live appeal. Real campaigns with money: Cyclone
Gezani/Fytia (Madagascar, $550K raised of $5M), Afghanistan flash floods
($1M fully funded), DRC Tshopo floods ($767K funded), Mozambique floods
($1.6M of $6M), Indonesia floods ($1M funded), Chile wildfires ($424K
funded), Argentina/Uruguay drought ($62K funded).

**What to implement:**
1. Add an `ingestion/sources/ifrc.py` enricher (same shape as the ReliefWeb
   one — annotates events, doesn't create them).
2. New columns: `ifrc_url TEXT NULL`, `ifrc_appeal_funded INT NULL`,
   `ifrc_appeal_requested INT NULL`. Storing the funding numbers lets the UI
   show a "$X raised of $Y" mini-bar without re-fetching.
3. Nightly resolver run.
4. UI: "Red Cross is responding" badge with link, plus the mini-bar.

**Caveat to surface in the UI:** the IFRC GO page IS NOT a consumer donate
flow — it's an operations portal. Label honestly ("View Red Cross response")
and don't promise a donate button. If we want a donate button, pair this
with Source 3.

---

## Source 3 — GlobalGiving (`globalgiving.org`)

**What it is:** a fundraising platform that vets NGOs and aggregates their
projects, including a "Disaster Recovery" theme with active projects after
named disasters. Crucially, each project has a public donate page.

**Why we care:** the only candidate among the three that ends a click on a
real donate flow.

**API access:**
- Requires a registered `api_key`. Free, instant-ish registration at
  `https://www.globalgiving.org/aboutus/register/`. **Action required to
  ship and to finish the spike probe.**
- Endpoints (base `https://api.globalgiving.org/api/public/projectservice/`):
  - `themes/` — list all themes (find Disaster Recovery's theme ID).
  - `themes/{themeId}/projects/summary?api_key=…` — projects in a theme.
  - `countries/{iso2}/projects/summary?api_key=…` — projects in a country.
  - Page size capped at 10/request; `hasNext` + `nextProjectId` for paging.
- Project record includes `id` (we build the donate URL from a `projectLink`
  or `id` field — need to confirm the exact field name with a live key).

**Matching strategy (proposed, to be validated):**
- Use country-level endpoint per ISO2 from a GDACS event.
- Filter project list client-side to `themes[]` containing the disaster-
  recovery theme.
- Date-bracket projects to ±90 days around the event window (GG projects
  often outlast the disaster itself, so the window is wider than IFRC's).
- No GLIDE matching — GG doesn't expose one.

**Probe answers (run on 2026-06-15, 14 GDACS Orange+Red events, 180d):**
1. **Donate URL pattern:** `https://www.globalgiving.org/projects/{project.id}/`
   (the project record has `id` and `title`, no field named `projectLink`).
2. **Theme ID:** `disaster` (name `"Disaster Response"`). 28 themes total —
   easy to enumerate but the ID has stayed stable; safe to hardcode.
3. **Country coverage:** every country we tested has 100s of projects.
   Disaster-themed subset is 10–60 per country.
4. **Donate URL is on a real, clickable globalgiving.org page** — confirmed
   for several IDs (60072, 3182, 21446, 26577, 51121).

**Important caveat the probe surfaced** — the country `/projects/summary`
endpoint returns *all* disaster-themed projects for a country, sorted however,
with no filter on which specific event a project is responding to. Concrete
failure modes seen in the probe:
- A 2026 Cyclone GEZANI match returned a project named
  `"CYCLONE IDAI- MOZAMBIQUE"` — Idai was 2019. Donation would go to a
  different (likely closed) campaign.
- A 2026 Cyclone FYTIA match returned `"Cyclone Batsirai Relief Fund"` —
  Batsirai was 2022.

So the surface 71% match rate breaks into:
- **~30% genuine matches** — either event-specific projects (Guam typhoon
  recovery, Chile fire student relief) or permanent country/region funds
  ("Horn of Africa Drought and Famine Relief Fund") that route donations
  to whatever drought is current. These are good.
- **~40% wrong-event matches** — same country, same hazard family, different
  disaster. Clicking would still go to a real charity, but for a different
  event.
- **~30% misses or weak matches** — small or rich-country events.

**Recommended filters to add before treating this as production-quality:**
- Hit `/projectservice/projects/{id}/full` for each candidate to read
  `dateCreated` / `status` / `activeFlag` (not in summary). Reject projects
  whose dateCreated is more than ~12 months before the event.
- Allow an explicit "permanent country fund" allowlist (GG project IDs like
  the Horn of Africa one) as fallback when no event-specific project found.
- Optional: extract the named-storm token from GDACS (`SINLAKU`, `FYTIA`)
  and require it as a substring of `project.title + summary` for storms.

**What to implement (post-filter):**
1. `ingestion/sources/globalgiving.py` enricher with the filters above.
2. New columns: `donate_url TEXT NULL`, `donate_org TEXT NULL`,
   `donate_source TEXT NULL` (`'globalgiving' | 'manual'`).
3. UI: "Donate" button when populated. Pure pass-through to GG's URL — we
   don't proxy payments. Honest framing — e.g. "Donate via GlobalGiving"
   not "Donate to this event."

**Realistic expected coverage after filtering: ~30%.** The remaining 70% of
big events have no clean GG project, and the manual-override path is the
right answer for those.

---

## Manual override path (independent of all three sources)

For editorial picks — the named disaster that's all over the news this
week — a tiny admin step is worth more than any matcher:

- Same `donate_url` / `donate_org` / `donate_source='manual'` columns from
  Source 3, settable directly via SQL or a one-page admin UI.
- Manual entries win over automated enrichers.
- Use the IFRC GO probe output as a weekly digest: "these events have live
  appeals — consider curating".

This works on day one without depending on any API contract.

---

## Schema sketch (not yet applied)

```sql
ALTER TABLE events
  ADD COLUMN reliefweb_url          TEXT,
  ADD COLUMN ifrc_url               TEXT,
  ADD COLUMN ifrc_appeal_requested  BIGINT,
  ADD COLUMN ifrc_appeal_funded     BIGINT,
  ADD COLUMN donate_url             TEXT,
  ADD COLUMN donate_org             TEXT,
  ADD COLUMN donate_source          TEXT;  -- 'globalgiving' | 'manual'
```

Resolvers are nightly jobs that take a batch of recent events, hit the
respective API, fill in the columns, and upsert. They run **after** the main
ingestion pass so the events already exist.

The matcher logic stays out of the API and frontend — both just read the
column. This preserves the project's "everything funnels through the Event
contract" invariant (see CLAUDE.md): we're enriching an existing event with
external URLs, not branching on source.

## Hazard taxonomy stays out of the matcher table

The hazard taxonomy invariant (one taxonomy across `normalize.py`,
`api/index.py`, `web/lib/types.ts`, `web/lib/hazards.ts`) must NOT pick up
ReliefWeb / IFRC / GG-specific hazard codes. The mappings shown above stay
internal to the resolver modules. Resolvers translate the external
vocabulary down to our 11 hazard types and never the other way around.
