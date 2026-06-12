# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repo. **The full project
guide is [`AGENTS.md`](./AGENTS.md)** — read it first; this file only adds
Claude-specific quick reference and the rules most worth repeating.

## TL;DR architecture

Four independent layers, free-tier only, glued by one normalized event model:
`ingestion/` (Python ETL, pluggable `sources/`) → `db/` (one PostGIS `events`
table on Neon) → `api/` (read-only FastAPI GeoJSON) → `web/` (Next.js +
MapLibre + deck.gl). See `AGENTS.md` and `ARCHITECTURE.md` for detail.

## Working rules

- **There is no root toolchain.** `cd` into `api/`, `ingestion/`, or `web/`
  before running anything. Each has its own venv / `node_modules`.
- **The `Event` contract is sacred.** Everything funnels through the `Event`
  dataclass in `ingestion/normalize.py` and the single `events` table. Don't
  add provider-specific columns or branch on `source` in the API/frontend.
- **Keep the hazard taxonomy in sync across three files** when it changes:
  `ingestion/normalize.py`, `api/index.py` (`VALID_HAZARDS`),
  `web/lib/types.ts` + `web/lib/hazards.ts`. See AGENTS.md → "The one invariant".
- **`intensity_norm` is always clamped to `[0,1]`.** Use `clamp01`.
- **Adding a data source is the common task** — follow `CONTRIBUTING.md`. Most
  source additions need zero changes outside `ingestion/`.
- **Secrets come from env only** (`DATABASE_URL`, `FIRMS_MAP_KEY`). Never commit
  `.env` / `.env.local`.

## Common commands

```bash
# ingestion (from ingestion/, venv active)
python run.py                    # all sources
python run.py --source gdacs     # one source: gdacs | firms | temperature

# api (from api/, venv active)
DATABASE_URL=… uvicorn index:app --reload     # localhost:8000

# web (from web/)
npm run dev      # localhost:3000
npm run build    # build + typecheck
npm run lint
```

## Before you finish a change

- Touched **TypeScript**? Run `npm run build` (it typechecks) and `npm run lint`
  from `web/`.
- Touched **ingestion**? Smoke-test with `python run.py --source <name>` against
  a real or local `DATABASE_URL`; confirm idempotency by running it twice
  (counts upsert, rows don't duplicate).
- Touched the **event shape, schema, or API response**? Verify the `events`
  table SQL, the API serialization in `api/index.py`, and the TS types in
  `web/lib/types.ts` all still agree.
- There is **no automated test suite** in this repo yet — verify by running the
  relevant layer, and call out untested assumptions in your summary.

## Gotchas that bite

- Map is client-only (`next/dynamic`, `ssr:false`) — deck.gl/maplibre need
  `window`/WebGL.
- GDACS "latest" events can be months old; the time slider's domain is derived
  from the data, not from "now". Don't hard-filter to recent dates.
- FIRMS detections are grid-binned to protect Neon's free storage — never store
  raw pixels.
- One failing source must not abort the whole ingestion run (`run.py` catches
  per-source).

See `AGENTS.md` → "Gotchas" for the full list with reasons.
