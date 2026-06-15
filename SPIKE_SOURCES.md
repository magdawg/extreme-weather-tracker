# Spike sources — plan & status

Six new hazard types were spiked alongside the existing five
(`storm | flood | wildfire | heat | drought`) to extend the tracker into the
**ocean**, **biosphere**, and **secondary impact** axes. The ingestion code
is in place for all of them; the **UI exposes only coral bleaching** while we
backfill and quality-check the rest.

This doc is the running plan: what's done, what's next, and what each source
still needs before it goes live in the UI.

## TL;DR status

| Hazard | Source module | Spiked | Backfilled | UI |
|---|---|:---:|:---:|:---:|
| `coral_bleach` | `noaa-crw` | ✅ | ✅ 2021–2025 (11k events) | ✅ visible |
| `marine_heat` | `noaa-oisst` | ✅ | ⏳ next | hidden |
| `swell` | `open-meteo-marine` | ✅ | ❌ | hidden |
| `swell` (Copernicus) | `copernicus-marine` | ✅ stub | ❌ | hidden |
| `mortality` | `gbif` | ✅ | ❌ | hidden |
| `deforestation` | `gfw` | ✅ | ❌ | hidden |
| `air_quality` | `openaq` | ✅ | ❌ | hidden |

**Gating mechanism:** a hazard is hidden by omitting it from `HAZARD_ORDER`
in `web/lib/hazards.ts` and its source from `SOURCE_ORDER` in
`web/lib/sources.ts`. The full `HAZARDS` / `SOURCES` metadata maps stay
populated, so an event of a hidden hazard still renders with the correct
color, label, and icon if anything forces it through (nothing does today —
the default `active` set is built from the trimmed order array). To
re-expose a source, uncomment its line in both files. No code change needed
in components.

---

## Shared considerations

**Taxonomy invariant.** The hazard list lives in **four** places — they must
stay identical:
- `ingestion/normalize.py` (`HAZARD_*` constants)
- `api/index.py` (`VALID_HAZARDS`)
- `web/lib/types.ts` (`HazardType` union)
- `web/lib/hazards.ts` (`HAZARDS` map — note: NOT `HAZARD_ORDER`; that's the
  UI-visibility gate)

If any of those drift, the API will 400 the hazard, the frontend won't type-
check the event, or the map won't have a color for it. See `AGENTS.md` →
"The one invariant".

**Storage budget.** Neon free tier is 0.5 GB. The `events` table averages
~1 KB/row. Rough per-source projections (5+ year backfill):

| Source | Est. events 2021→ | Notes |
|---|---:|---|
| `coral_bleach` | ~11k | actual, observed |
| `marine_heat` | ~150–250k | biggest by far; tunable via `MHW_THRESHOLD_C` |
| `swell` | ~5k | 40 sample points × ~125 daily exceedances/year |
| `mortality` | ~3–10k | text-keyword spike, low recall |
| `deforestation` | ~50k | one (country, day) per top forest-loss country |
| `air_quality` | ~10–30k/run | latest-only API; no backfill possible |

Combined headroom is fine, but `marine_heat` is the one to watch. Bumping
its threshold from +2 °C to +2.5 °C roughly halves volume.

**Backfill pattern.** Every backfill source uses the same idempotent,
stream-per-year shape that GDACS/temperature already use:

```
fetch_backfill(from_year=None) -> Iterator[(year, list[Event])]
```

The orchestrator (`run.py`) upserts each year as it lands so the DB
connection is never held idle through a multi-minute fetch (Neon drops idle
sockets). `--from-year` lets a partial run resume cheaply. Re-runs are
no-ops where data already exists thanks to the `ON CONFLICT … DO UPDATE`
upsert keyed on `(source, source_event_id, hazard_type)`.

**One failing source must never kill the run.** The orchestrator already
wraps each source in try/except. Source modules should also catch their
own per-record errors (e.g. NaN handling in `coral_bleach.py` — the bug we
hit on first backfill) so one bad row doesn't take down a whole year.

---

## Per-source plans

### 1. `coral_bleach` (NOAA Coral Reef Watch) — LIVE

**What it is.** Daily 5 km Bleaching Alert Area (BAA) level at 23 hardcoded
major reef regions. Levels 0 (No Stress) → 5 (Alert Level 3) drive
intensity_norm = `level / 5`.

**Data path.** NOAA CRW ERDDAP `NOAA_DHW.csv?CRW_BAA[…][lat][lon]`. One CSV
per (reef, window). Public, no auth.

**Backfill.** Done — 11,022 events for 2021–2025. The 2026 window 404'd
because the request got geographically routed to PacIOOS's stale mirror
(`dhw_5km`, capped at end of 2025). To fill 2026 once the mirror catches up:

```bash
python run.py --source coral_bleach --backfill --from-year 2026
```

**Known caveats.**
- Peak intensity caps at 0.800 (BAA=4) in our 2021–2025 data because the
  PacIOOS mirror uses the old 5-level scale; NOAA extended the scale to
  levels 4/5 in 2023+ but only the primary endpoint has them. Not a bug;
  the relative pattern (climbing 2023→2024) is correct.
- 60 s timeout was too short — bumped to 120 s after two reefs failed
  mid-backfill.
- Reef list is curated to 23; easy to swap for a richer inventory later.

**Next steps.** None blocking. Already in the UI.

---

### 2. `marine_heat` (NOAA OISST) — UP NEXT

**What it is.** Marine heatwave cells from satellite SST anomaly. A cell on
a given day where SST is ≥ +2 °C above the OISST 1971–2000 baseline becomes
an event. Intensity scales up to +5 °C anomaly.

**Data path.** NOAA CoastWatch ERDDAP `ncdcOisst21Agg_LonPM180.anom`,
stride-sampled at 10° (13 lat × 37 lon, mostly ocean).

**Backfill plan.** Same orchestrator shape as coral_bleach, but the per-year
ERDDAP fetch is chunked **monthly** internally — a single year cube at
stride 40 would be ~5M cells of CSV in one response. Monthly windows keep
each call to ~500 KB.

```bash
python run.py --source marine_heat --backfill
```

Expect 15–25 minutes wall-clock and roughly **150–250k events**. Volume is
heavily dominated by 2023–2024 (the ocean-fever years).

**Pre-UI checklist.**
- [ ] Run the backfill and sanity-check per-year counts: 2023 and 2024
  should jump out hard against 2021–2022.
- [ ] If the layer dominates the map, bump `MHW_THRESHOLD_C` from 2.0 → 2.5
  before re-exposing. The threshold is the only knob; everything else
  follows.
- [ ] Decide whether the cell count overwhelms the map at small zooms.
  A heatmap-layer rendering may be cleaner than individual dots; check
  the existing `heatmap` toggle in `page.tsx`.
- [ ] Uncomment `marine_heat` in `HAZARD_ORDER` and `noaa-oisst` in
  `SOURCE_ORDER`.

**Clean upgrade (deferred).** Replace the fixed +2 °C threshold with the
Hobday 2016 90th-percentile-of-climatology definition. Same TODO as the
percentile-vs-climatology cleanup documented in `temperature.py`. Nothing
else in the pipeline needs to change — only the in-source classifier.

---

### 3. `swell` — Open-Meteo Marine

**What it is.** Daily-max significant wave height (Hs) at 40 curated
coastal/open-ocean sample points. Hs ≥ 6 m (WMO "very rough sea") becomes
an event; intensity saturates at 14 m (rogue-wave territory).

**Data path.** Open-Meteo Marine API `wave_height_max` daily, multi-coord
batch call. Free, no key. `past_days` ≤ 92 — so a single call covers ~3
months max per request.

**Backfill plan.** Open-Meteo's `past_days` ceiling forces month-by-month
chunking back to 2021, similar to `marine_heat`. ~66 calls total. Volume
estimate: 40 points × ~125 exceedance-days/year on average ≈ **~25k events
across 5+ years**. Cheap.

```bash
# To implement: same fetch_backfill() pattern, chunked by 90-day windows
python run.py --source swell --backfill
```

**Pre-UI checklist.**
- [ ] Add `BACKFILL_FROMDATE` and `fetch_backfill()` to `swell.py` (mirrors
  `temperature.py`'s 90-day-window pattern).
- [ ] Wire `run_swell_backfill()` into `run.py`.
- [ ] Run backfill. Sanity-check NW Pacific typhoon season + N Atlantic
  winter storms show up; Southern Ocean is the persistent background.
- [ ] Decide whether 6 m is the right cut. Real storm tracks routinely
  push above 8 m; 6 m gives more density but more noise.
- [ ] Uncomment `swell` in `HAZARD_ORDER` and `open-meteo-marine` in
  `SOURCE_ORDER`.

**Clean upgrade.** Per-point percentile climatology (e.g. > 99th percentile
of that point's Hs distribution) instead of a global 6 m cutoff. Captures
"abnormal for here" without raising the bar in genuinely big-wave
locations.

---

### 4. `swell` — Copernicus Marine (alternative provider)

**What it is.** Same hazard type, higher-fidelity source — global wave
analysis & forecast at 1/12° from Météo-France's WAVERYS via CMEMS. Better
resolution and storm-fetch coverage than Open-Meteo's.

**Data path.** `copernicusmarine` Python toolbox → dataset
`cmems_mod_glo_wav_anfc_0.083deg_PT3H-i`, variable `VHM0`. Requires free
CMEMS account (`CMEMS_USERNAME` / `CMEMS_PASSWORD` env vars). Lazy-imports
the package so users who opt out aren't forced to install it.

**Backfill plan.** Skip for now. Keep as a documented upgrade path. The
shape mirrors `marine_heat` (stride-sampled global grid, monthly chunks)
but the toolbox handles the heavy lifting via xarray.

**Pre-UI checklist.**
- [ ] Sign up for CMEMS, get credentials.
- [ ] Decide: replace Open-Meteo, or run both (Copernicus for global grid +
  Open-Meteo for high-temporal-cadence at named points)? They emit the
  same `swell` hazard type, so dedup matters — different
  `source_event_id` prefixes prevent collisions but the map will show
  overlapping markers.

**Decision deferred** until the Open-Meteo version proves out the layer.

---

### 5. `mortality` (GBIF) — biodiversity die-off signal

**What it is.** Spatial clusters of recent GBIF occurrence records whose
text fields mention mortality keywords ("mortality", "die-off",
"stranding", "fish kill", "bleached", "mass death"). 1° × 1-week
spatiotemporal bins; emit one Event per cluster ≥ 3 records.

**Data path.** GBIF Occurrence API
`/v1/occurrence/search?q=<keyword>&hasCoordinate=true&eventDate=…`.
Public, no key. We paginate to 10 × 300 records per keyword.

**Backfill plan.** GBIF supports arbitrary `eventDate` ranges so a single
call per (keyword, year) is feasible. Six keywords × six years = 36
search runs, each paginated up to 10 pages. Expected volume: **~3–10k
events** but with low recall — keyword text-match is a coarse proxy.

```bash
# To implement: fetch_backfill() that walks year-by-year per keyword
python run.py --source gbif --backfill
```

**Pre-UI checklist.**
- [ ] Add `BACKFILL_FROMDATE` and `fetch_backfill()` to `gbif.py`.
- [ ] Wire `run_gbif_backfill()` into `run.py`.
- [ ] Manually inspect 20 random emitted clusters. Validate that they're
  real die-offs vs. records whose dataset title happens to contain the
  word "mortality". If precision is poor, narrow the keyword set or add
  a `basisOfRecord=PRESERVED_SPECIMEN` filter.
- [ ] Uncomment `mortality` + `gbif` once precision is acceptable.

**Clean upgrade.** Anomaly detection on per-taxon record density —
"unusual cluster of this species' records here this week vs. its
climatology." Same paradigm as the percentile MHW upgrade. This is the
right way to detect die-offs; the keyword spike is a proof-of-concept
only.

---

### 6. `deforestation` (GFW Integrated Alerts)

**What it is.** Daily aggregated GLAD-L + GLAD-S2 + RADD + DIST-ALERT
detections, summed per country per day, placed at a hardcoded centroid for
each of the top 40 forest-loss countries.

**Data path.** GFW Data API SQL query on
`gadm__integrated_alerts__iso_daily_alerts`. Optional `GFW_API_KEY` env
var (anonymous calls work but are rate-limited).

**Backfill plan.** SQL endpoint supports any date range — a single query
per year would work. The dataset itself only goes back to **2018-01-01**
(GLAD-L launch date), so the 2021 cutoff is well inside coverage.
Expected volume: ~40 countries × ~250 alert-days/year ≈ **~50k events**.

```bash
# To implement: fetch_backfill() with one SQL query per year
python run.py --source deforestation --backfill
```

**Pre-UI checklist.**
- [ ] Add `BACKFILL_FROMDATE` and `fetch_backfill()` to `deforestation.py`.
- [ ] Sign up for a free GFW API key if rate limits bite during backfill.
- [ ] Run backfill. Brazil and Indonesia should dominate; Amazon dry
  season (Aug–Oct) should be visibly peaky.
- [ ] Decide: country-centroid markers look identical to FIRMS at a
  glance. Consider drilling down to ADM1 (state/province) for visual
  differentiation — would 10x event volume but make Brazil's
  state-level pattern legible.
- [ ] Uncomment `deforestation` + `gfw`.

**Clean upgrade.** Drop to ADM1 (state/province) granularity using the
sibling `gadm__integrated_alerts__adm1_daily_alerts` dataset, with proper
centroids derived from a GADM polygon shapefile. Pairs naturally with
FIRMS on the map — fire and forest loss are often the same story told two
ways (Brazilian arc, Indonesia peatland fires).

---

### 7. `air_quality` (OpenAQ)

**What it is.** PM2.5 readings ≥ 150 µg/m³ (US EPA "Very Unhealthy"+) from
OpenAQ ground stations. Intensity saturates at 500 µg/m³ (extreme smoke).

**Data path.** OpenAQ v3 `/parameters/2/latest` with `X-API-Key` header.
Requires `OPENAQ_API_KEY` env var (free from openaq.org).

**Backfill plan.** **No backfill possible from this endpoint.** OpenAQ's
`/latest` is by definition the most recent reading per sensor; there's no
historical bulk endpoint exposed at this resolution. Each routine run
captures whatever's hazardous right now, and the events accumulate over
time. The "historical" view will build up organically as ingestion runs.

To get historical PM2.5: switch to OpenAQ's `/measurements` endpoint
(per-sensor time-series), which is paginated heavily and would require a
per-sensor loop across thousands of stations. That's a bigger lift; not
worth it for the spike.

**Pre-UI checklist.**
- [ ] Confirm OPENAQ_API_KEY is set in `.env`.
- [ ] Let routine ingestion run for a few cycles to accumulate events.
- [ ] Inspect — at 150 µg/m³ this should be mostly wildfire smoke
  plumes and severe industrial events. Validate the pattern aligns with
  FIRMS downstream of major fire seasons.
- [ ] Uncomment `air_quality` + `openaq`.

**Clean upgrade.** Switch to the `/measurements` endpoint with a
per-sensor loop OR use OpenAQ's S3 bulk exports for a one-shot historical
backfill. Either is multiple hours of work.

---

## Re-exposing a source

When a source is ready to ship:

1. Verify the data looks right (per-year counts, peak events match known
   real-world events).
2. Uncomment its line in `web/lib/hazards.ts` (`HAZARD_ORDER`).
3. Uncomment its line in `web/lib/sources.ts` (`SOURCE_ORDER`).
4. `cd web && npm run build` to verify typecheck still passes.
5. Local-test in `npm run dev` — the new filter chip should appear and the
   layer should render on the map.
6. Commit + deploy.

No backend or schema change needed — the API already accepts all 11
hazard types in `VALID_HAZARDS`, and the events table has no CHECK
constraint on `hazard_type`.

## Backfill sequence (suggested)

Run in this order to make the storage and rate-limit story visible
incrementally:

1. ✅ `coral_bleach` — done
2. **`marine_heat`** — next; biggest volume, worth seeing first
3. `swell` (Open-Meteo) — cheap
4. `deforestation` — medium volume, pairs visually with FIRMS
5. `mortality` (GBIF) — low volume, but precision needs human review
6. (`copernicus_waves` — only if Open-Meteo proves insufficient)
7. (`air_quality` — no backfill; just runs forward)
