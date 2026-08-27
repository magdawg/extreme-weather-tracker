-- Extreme Weather Tracker — canonical schema.
-- One normalized table holds every hazard from every source so the map and
-- analytics never have to special-case a provider.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL PRIMARY KEY,

    -- provenance
    source          TEXT        NOT NULL,            -- 'gdacs' | 'firms' | 'open-meteo' | 'noaa-crw' | 'noaa-oisst' | 'open-meteo-marine' | 'copernicus-marine' | 'gbif' | 'gfw' | 'openaq'
    source_event_id TEXT        NOT NULL,            -- stable id within that source

    -- classification
    hazard_type     TEXT        NOT NULL,            -- 'storm'|'flood'|'wildfire'|'heat'|'drought'|'coral_bleach'|'marine_heat'|'swell'|'mortality'|'deforestation'|'air_quality'
    title           TEXT,
    severity_raw    TEXT,                            -- source's own label, e.g. 'Orange', 'Red'
    intensity_norm  DOUBLE PRECISION,                -- 0..1 unified scale for color/size

    -- where & when
    geom            geometry(Geometry, 4326) NOT NULL,
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    country         TEXT,

    -- extras
    url             TEXT,
    metadata        JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- lets ingestion upsert idempotently every 12h
    UNIQUE (source, source_event_id, hazard_type)
);

CREATE INDEX IF NOT EXISTS idx_events_geom       ON events USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_events_started_at ON events (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_hazard     ON events (hazard_type);

-- ENSO (El Niño / La Niña) state is a single *global* index, not a located
-- hazard, so it deliberately lives outside the events table — the map/API never
-- special-case it as an Event. We store NOAA CPC's Oceanic Niño Index (ONI):
-- one row per overlapping 3-month season (DJF, JFM, …) back to 1950. `anom` is
-- the ONI value (Niño-3.4 SST anomaly, °C); El Niño ≥ +0.5, La Niña ≤ −0.5.
CREATE TABLE IF NOT EXISTS enso_oni (
    year     INT              NOT NULL,           -- year of the season's centre month
    season   CHAR(3)          NOT NULL,           -- 'DJF' | 'JFM' | … | 'NDJ'
    total    DOUBLE PRECISION,                    -- 3-month mean SST (°C), Niño-3.4
    anom     DOUBLE PRECISION NOT NULL,           -- ONI anomaly; the headline value
    ingested_at TIMESTAMPTZ   NOT NULL DEFAULT now(),

    PRIMARY KEY (year, season)                    -- lets ingestion upsert idempotently
);

-- Donation links per event, populated by post-ingestion resolvers that match
-- events against IFRC GO (Red Cross emergencies, open API) and GlobalGiving
-- (NGO projects with public donate pages, free API). One row per event when at
-- least one source produces a hit; events without a match simply have no row.
-- The PK doubles as a FK to events(id), so the JOIN in /events is an index
-- probe per row (no extra index needed). ON DELETE CASCADE keeps donations from
-- outliving their event. See SPIKE_DONATIONS.md for the matching strategy.
CREATE TABLE IF NOT EXISTS event_donations (
    event_id              BIGINT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,

    -- IFRC GO (open API, no auth). Public URL pattern:
    -- https://go.ifrc.org/emergencies/{event_id}
    ifrc_url              TEXT,
    ifrc_appeal_requested BIGINT,                    -- total $ requested across appeals
    ifrc_appeal_funded    BIGINT,                    -- total $ raised so far

    -- GlobalGiving (free API, key required). Public URL:
    -- https://www.globalgiving.org/projects/{project_id}/
    -- Only the donate URL + display strings; we never proxy payments.
    gg_url                TEXT,
    gg_title              TEXT,
    gg_org                TEXT,

    resolved_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Companion to enso_oni: the monthly Niño-3.4 SST anomaly (ERSSTv5, fixed
-- 1991–2020 base). The ONI is a 3-month running mean, so its newest value
-- always trails the calendar by ~1 month; this single-month anomaly is the
-- freshest read on the Pacific. It's noisier and on a different base period, so
-- it's supplementary display context only — never relabelled as ONI, never used
-- to classify the El Niño / La Niña phase.
CREATE TABLE IF NOT EXISTS enso_nino34 (
    year     INT              NOT NULL,           -- calendar year
    month    INT              NOT NULL,           -- 1..12
    sst      DOUBLE PRECISION,                    -- monthly mean Niño-3.4 SST (°C)
    anom     DOUBLE PRECISION NOT NULL,           -- monthly SST anomaly (°C)
    ingested_at TIMESTAMPTZ   NOT NULL DEFAULT now(),

    PRIMARY KEY (year, month)                     -- lets ingestion upsert idempotently
);
