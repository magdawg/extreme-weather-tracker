-- Extreme Weather Tracker — canonical schema.
-- One normalized table holds every hazard from every source so the map and
-- analytics never have to special-case a provider.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS events (
    id              BIGSERIAL PRIMARY KEY,

    -- provenance
    source          TEXT        NOT NULL,            -- 'gdacs' | 'firms' | 'open-meteo'
    source_event_id TEXT        NOT NULL,            -- stable id within that source

    -- classification
    hazard_type     TEXT        NOT NULL,            -- 'storm'|'flood'|'wildfire'|'heat'|'drought'
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
