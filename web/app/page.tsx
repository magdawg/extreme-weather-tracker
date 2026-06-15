"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import HazardFilter from "@/components/HazardFilter";
import SeverityFilter from "@/components/SeverityFilter";
import SourceFilter from "@/components/SourceFilter";
import Section from "@/components/Section";
import TimeSlider from "@/components/TimeSlider";
import WindowSelect from "@/components/WindowSelect";
import MonthPicker from "@/components/MonthPicker";
import SpeedSelect from "@/components/SpeedSelect";
import TeleconnectionLegend from "@/components/TeleconnectionLegend";
import EnsoStrip from "@/components/EnsoStrip";
import EnsoInfoDialog from "@/components/EnsoInfoDialog";
import type { EnsoInfoTopic } from "@/components/EnsoInfoDialog";
import AboutDialog from "@/components/AboutDialog";
import EventDetails from "@/components/EventDetails";
import type { SelectedEvent } from "@/components/EventDetails";
import { GlobeIcon, InfoIcon, ChevronDownIcon } from "@/components/icons";
import { PANEL, FOCUS } from "@/lib/ui";
import { fetchEvents, fetchEnso, timeChunks, DATA_START_YEAR } from "@/lib/api";
import { HAZARD_ORDER } from "@/lib/hazards";
import { ensoHazardSignal } from "@/lib/enso";
import {
  SEVERITY_ORDER,
  matchesSeverity,
  tierOf,
} from "@/lib/severity";
import type { Severity } from "@/lib/severity";
import { SOURCE_ORDER, isKnownSource } from "@/lib/sources";
import type { SourceId } from "@/lib/sources";
import type { EnsoData, EventFeature, HazardType } from "@/lib/types";

// deck.gl + maplibre touch window/WebGL, so the map is client-only.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const DAY_MS = 86_400_000;
// At 1× speed, playback sweeps the whole data domain in this many frames, so
// wall-clock speed stays steady regardless of how wide the date range is. The
// selected speed multiplier scales the per-frame step.
const PLAYBACK_FRAMES = 480;
const PLAYBACK_INTERVAL_MS = 120;

// Track viewport "mobile-ness" outside React state so we can read it during
// render without triggering a hydration mismatch. SSR/initial-hydration assume
// not-mobile; after mount, the real media query takes over.
const MOBILE_QUERY = "(max-width: 640px)";
const subscribeMobile = (cb: () => void) => {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const getMobileSnapshot = () => window.matchMedia(MOBILE_QUERY).matches;
const getMobileServerSnapshot = () => false;

export default function Page() {
  const [features, setFeatures] = useState<EventFeature[]>([]);
  const [active, setActive] = useState<Set<HazardType>>(new Set(HAZARD_ORDER));
  const [activeSources, setActiveSources] = useState<Set<SourceId>>(
    new Set(SOURCE_ORDER),
  );
  const [severity, setSeverity] = useState<Set<Severity>>(
    new Set(SEVERITY_ORDER),
  );
  const [cutoffMs, setCutoffMs] = useState<number | null>(null); // null = show all
  const [playing, setPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  // ENSO sparkline above the time slider. Collapsed by default — the pill
  // toggle in the secondary controls row reveals it.
  const [ensoBandOpen, setEnsoBandOpen] = useState(false);
  const [windowMonths, setWindowMonths] = useState<number | null>(1); // default: last 1 month
  // When set, view exactly this calendar month (overrides slider/window/play).
  const [monthFilter, setMonthFilter] = useState<{ year: number; month: number } | null>(null);
  const [heatmap, setHeatmap] = useState(false);
  // El Niño teleconnection overlay — expected impact zones, off by default.
  const [teleconnections, setTeleconnections] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  // Which ENSO explainer is open (the status card vs the timeline band), or null.
  const [ensoInfo, setEnsoInfo] = useState<EnsoInfoTopic | null>(null);
  // Highlight the Niño-3.4 region box on the map while its label is hovered.
  const [nino34Hover, setNino34Hover] = useState(false);
  const [selected, setSelected] = useState<SelectedEvent | null>(null);
  // ENSO state (El Niño / La Niña index) — global context, fetched once. A
  // failed fetch just hides the ENSO UI; it never blocks the map.
  const [enso, setEnso] = useState<EnsoData | null>(null);
  // Default panel state follows the viewport (open on desktop, collapsed on
  // mobile so the map is usable on first load), but user clicks override that.
  const isMobile = useSyncExternalStore(
    subscribeMobile,
    getMobileSnapshot,
    getMobileServerSnapshot,
  );
  const [panelOpenOverride, setPanelOpenOverride] = useState<boolean | null>(
    null,
  );
  const panelOpen = panelOpenOverride ?? !isMobile;
  // Capture "now" once at mount — it's the upper bound of the time slider and
  // doesn't need to tick live. (Reading Date.now() during render is impure.)
  const [now] = useState(() => Date.now());

  // The slider spans the full known data range [start-of-data, now] rather than
  // the range of *loaded* events: with lazy chunk loading the user must be able
  // to scrub into ranges that haven't been fetched yet, which is what triggers
  // their load. Fixed domain, so it's stable from first paint.
  const minMs = useMemo(() => Date.UTC(DATA_START_YEAR, 0, 1), []);
  const maxMs = now;

  // The timeline split into fixed, independently-cacheable 2-year chunks
  // (newest first). We load the newest chunk on mount for a fast first paint,
  // then load older chunks on demand as the view needs them.
  const chunks = useMemo(() => timeChunks(now), [now]);
  const [loadedChunks, setLoadedChunks] = useState<Set<number>>(new Set());
  const inFlight = useRef<Set<number>>(new Set());

  const loadChunk = useCallback(
    (i: number) => {
      if (loadedChunks.has(i) || inFlight.current.has(i)) return;
      const c = chunks[i];
      if (!c) return;
      inFlight.current.add(i);
      fetchEvents({ from: c.from, to: c.to })
        .then((fc) => {
          // Long-lived events (e.g. droughts) can straddle a chunk boundary and
          // be returned by two adjacent requests. Keep only those whose
          // started_at falls in this chunk's half-open range, so each event is
          // owned by exactly one chunk — no duplicates when chunks merge.
          // (Undated events are never returned once from/to are set; the dataset
          // currently has none — see summary.)
          const own = fc.features.filter((f) => {
            const s = f.properties.started_at;
            if (!s) return false;
            const t = new Date(s).getTime();
            return t >= c.fromMs && t < c.toMs;
          });
          setFeatures((prev) => prev.concat(own));
          setLoadedChunks((prev) => new Set(prev).add(i));
        })
        .catch((e) => setError(String(e)))
        .finally(() => {
          inFlight.current.delete(i);
          if (i === 0) setLoading(false);
        });
    },
    [chunks, loadedChunks],
  );

  // Load the newest chunk first for a fast first paint, then pre-load every
  // other chunk in the background (newest to oldest) so scrubbing and playback
  // never hit an unloaded range. loadChunk de-dupes already-loaded/in-flight
  // requests, so re-running as chunks resolve is cheap.
  useEffect(() => {
    if (!loadedChunks.has(0)) {
      loadChunk(0);
      return;
    }
    for (let i = 1; i < chunks.length; i++) loadChunk(i);
  }, [loadedChunks, chunks, loadChunk]);

  // True until every chunk has loaded — drives the subtle "loading history…"
  // hint without blocking the already-rendered map.
  const historyLoading = loadedChunks.size < chunks.length;

  // Load ENSO once on mount. Best-effort: swallow errors so the map still works
  // if the index is unavailable.
  useEffect(() => {
    fetchEnso()
      .then(setEnso)
      .catch(() => {});
  }, []);

  const cutoff = cutoffMs ?? maxMs;
  const atNow = cutoff >= maxMs;

  // Years spanned by the data, for the month-comparison picker.
  const years = useMemo(() => {
    const start = new Date(minMs).getFullYear();
    const end = new Date(maxMs).getFullYear();
    const out: number[] = [];
    for (let y = start; y <= end; y++) out.push(y);
    return out;
  }, [minMs, maxMs]);

  // Month to open on when toggling into month view — the most recent event's
  // month, so the first view always has data (falls back to the latest year).
  const defaultMonth = useMemo(() => {
    let latest = -Infinity;
    for (const f of features) {
      const s = f.properties.started_at;
      if (s) latest = Math.max(latest, new Date(s).getTime());
    }
    const d = new Date(latest > 0 ? latest : maxMs);
    return { year: d.getFullYear(), month: d.getMonth() };
  }, [features, maxMs]);

  // Half-open [start, end) bounds of the selected calendar month, or null.
  const monthRange = useMemo(() => {
    if (!monthFilter) return null;
    return {
      start: new Date(monthFilter.year, monthFilter.month, 1).getTime(),
      end: new Date(monthFilter.year, monthFilter.month + 1, 1).getTime(),
    };
  }, [monthFilter]);

  // Pinning a month is incompatible with the scrubbing/playback timeline, so
  // stop playback when one is selected.
  const handleMonthChange = (v: { year: number; month: number } | null) => {
    if (v) setPlaying(false);
    setMonthFilter(v);
  };

  // Advance the cutoff toward "now" while playing, then stop on arrival.
  useEffect(() => {
    if (!playing) return;
    const step =
      Math.max(DAY_MS, (maxMs - minMs) / PLAYBACK_FRAMES) * playbackSpeed;
    const id = setInterval(() => {
      setCutoffMs((prev) => {
        const next = (prev ?? maxMs) + step;
        if (next >= maxMs) {
          setPlaying(false);
          return maxMs;
        }
        return next;
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, minMs, maxMs, playbackSpeed]);

  const togglePlay = () => {
    // Pressing play at the end replays from the start of the data range.
    if (!playing && cutoff >= maxMs) setCutoffMs(minMs);
    setPlaying((p) => !p);
  };

  // Manually scrubbing the slider takes over from playback.
  const handleCutoffChange = (ms: number) => {
    setPlaying(false);
    setCutoffMs(ms);
  };

  // Lower bound when a "last X months" window is active (calendar months back
  // from the selected date); null means cumulative — no lower bound.
  const lowerMs = useMemo(() => {
    if (windowMonths === null) return null;
    const d = new Date(cutoff);
    d.setMonth(d.getMonth() - windowMonths);
    return d.getTime();
  }, [cutoff, windowMonths]);

  // Parse `started_at` to ms once per `features` reference. The time filter
  // below runs on every slider tick (every 120 ms during playback); without
  // this cache, each tick allocated O(features) Date objects, which blocked the
  // main thread once the dataset grew past a few thousand events.
  const startedAtMs = useMemo(
    () =>
      features.map((f) =>
        f.properties.started_at
          ? new Date(f.properties.started_at).getTime()
          : null,
      ),
    [features],
  );

  // A pinned month shows exactly that calendar month and ignores the slider /
  // window. Otherwise, reveal events chronologically up to the selected date;
  // if a window is set, also clip off anything older than `lowerMs`.
  const timeFiltered = useMemo(
    () =>
      features.filter((f, i) => {
        const s = startedAtMs[i];
        if (monthRange) {
          // Undated events can't be placed in a specific month.
          return s !== null && s >= monthRange.start && s < monthRange.end;
        }
        // Undated events can't be placed in a finite window.
        if (s === null) return atNow && lowerMs === null;
        if (s > cutoff) return false;
        return lowerMs === null || s >= lowerMs;
      }),
    [features, startedAtMs, cutoff, atNow, lowerMs, monthRange],
  );

  // Source counts reflect the time window only — so toggling a source off
  // doesn't make its own count disappear.
  const sourceCounts = useMemo(() => {
    const c = Object.fromEntries(SOURCE_ORDER.map((s) => [s, 0])) as Record<
      SourceId,
      number
    >;
    for (const f of timeFiltered) {
      const s = f.properties.source;
      if (isKnownSource(s)) c[s]++;
    }
    return c;
  }, [timeFiltered]);

  // Apply source filter before counting hazards / severity, so those tallies
  // reflect what's actually on the map.
  const sourceFiltered = useMemo(
    () =>
      timeFiltered.filter((f) => {
        const s = f.properties.source;
        return isKnownSource(s) && activeSources.has(s);
      }),
    [timeFiltered, activeSources],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(HAZARD_ORDER.map((h) => [h, 0])) as Record<
      HazardType,
      number
    >;
    for (const f of sourceFiltered) c[f.properties.hazard_type]++;
    return c;
  }, [sourceFiltered]);

  // Severity counts reflect the events currently in scope (time + source + hazard),
  // so the segmented control mirrors what each tier would reveal.
  const severityCounts = useMemo(() => {
    const c = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<
      Severity,
      number
    >;
    for (const f of sourceFiltered) {
      if (active.has(f.properties.hazard_type)) c[tierOf(f.properties)]++;
    }
    return c;
  }, [sourceFiltered, active]);

  const visible = useMemo(
    () =>
      sourceFiltered.filter(
        (f) =>
          active.has(f.properties.hazard_type) && matchesSeverity(f, severity),
      ),
    [sourceFiltered, active, severity],
  );

  // The El Niño signal compares the hazard mix during El Niño months against
  // the full loaded record, so it intentionally uses every loaded event —
  // independent of the time slider, window, and hazard/source filters.
  const ensoSignal = useMemo(
    () => (enso?.series.length ? ensoHazardSignal(features, enso.series) : null),
    [features, enso],
  );

  const toggle = (h: HazardType) =>
    setActive((prev) => {
      const next = new Set(prev);
      next.has(h) ? next.delete(h) : next.add(h);
      return next;
    });

  const toggleSource = (s: SourceId) =>
    setActiveSources((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const toggleSeverity = (s: Severity) =>
    setSeverity((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <MapView
        features={visible}
        heatmap={heatmap}
        teleconnections={teleconnections}
        highlightNino34={nino34Hover}
        onSelect={setSelected}
      />

      {selected && (
        <EventDetails event={selected} onClose={() => setSelected(null)} />
      )}

      <EnsoStrip
        enso={enso}
        signal={ensoSignal}
        onShowInfo={() => setEnsoInfo("card")}
        onShowSignalInfo={() => setEnsoInfo("signal")}
        onShowMonthlyInfo={() => setEnsoInfo("monthly")}
        onHoverNino34={setNino34Hover}
      />

      {/* About button — bottom-left corner */}
      <button
        onClick={() => setAboutOpen(true)}
        aria-label="About this project"
        title="About this project"
        className={`absolute bottom-4 left-4 z-10 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/15 bg-[#0b1020]/85 text-white shadow-lg shadow-black/40 ring-1 ring-white/10 backdrop-blur-md transition hover:bg-[#0b1020] hover:ring-white/20 active:scale-95 ${FOCUS}`}
      >
        <InfoIcon size={19} />
      </button>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}

      {ensoInfo && (
        <EnsoInfoDialog topic={ensoInfo} onClose={() => setEnsoInfo(null)} />
      )}

      {/* Left control panel. On mobile the bottom slider eats ~13rem at the
          foot of the screen — cap the panel's max-height so it always stops
          above the slider and the lower sections stay scroll-reachable. */}
      <div
        className={`ewt-scroll absolute left-3 top-3 z-10 flex max-w-[calc(100vw-1.5rem)] flex-col sm:left-4 sm:top-4 sm:max-w-[calc(100vw-2rem)] ${PANEL} ${
          panelOpen
            ? "w-72 max-h-[calc(100vh-14rem)] overflow-y-auto p-3 sm:max-h-[calc(100vh-2rem)] sm:p-4"
            : "w-auto px-3 py-2 sm:w-72 sm:px-4 sm:py-3"
        }`}
      >
        <button
          onClick={() => setPanelOpenOverride(!panelOpen)}
          aria-expanded={panelOpen}
          aria-controls="panel-body"
          className={`-mx-1 flex items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-white/5 ${FOCUS}`}
        >
          <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <GlobeIcon size={18} className="shrink-0 text-indigo-300" />
            {/* Collapsed on a phone, the title would overlap the ENSO card top-
                right, so shrink to just the globe; the text returns on tap (when
                open) and on larger screens. */}
            <span className={panelOpen ? "" : "hidden sm:inline"}>
              Extreme Weather Tracker
            </span>
          </h1>
          <ChevronDownIcon
            size={14}
            className={`shrink-0 text-white/45 transition-transform ${
              panelOpen ? "" : "-rotate-90 hidden sm:block"
            }`}
          />
        </button>

        {panelOpen && (
          <div id="panel-body">
            <p className="mt-1 hidden text-xs leading-relaxed text-white/55 sm:block">
              Patterns, transitions &amp; intensity of extreme weather worldwide.
            </p>

            <div className="my-2 h-px bg-white/10 sm:my-3" />
            <Section title="Hazards">
              <HazardFilter
                active={active}
                counts={counts}
                onToggle={toggle}
                loading={loading}
              />
            </Section>

            <div className="my-2 h-px bg-white/10 sm:my-3" />
            <Section title="Severity">
              <SeverityFilter
                active={severity}
                counts={severityCounts}
                onToggle={toggleSeverity}
                loading={loading}
              />
            </Section>

            <div className="my-2 h-px bg-white/10 sm:my-3" />
            <Section title="Data source" defaultOpen={false}>
              <SourceFilter
                active={activeSources}
                counts={sourceCounts}
                onToggle={toggleSource}
                loading={loading}
              />
            </Section>

            <div className="my-2 h-px bg-white/10 sm:my-3" />
            <Section title="Display" defaultOpen={false}>
              <button
                type="button"
                role="switch"
                aria-checked={heatmap}
                onClick={() => setHeatmap((v) => !v)}
                className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-1 py-1 text-sm text-white/85 transition hover:text-white ${FOCUS}`}
              >
                <span>Heatmap view</span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    heatmap ? "bg-indigo-500" : "bg-white/15"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      heatmap ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>

              <div className="my-2 h-px bg-white/10 sm:my-3" />
              <button
                type="button"
                role="switch"
                aria-checked={teleconnections}
                onClick={() => setTeleconnections((v) => !v)}
                className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-sm text-white/85 transition hover:text-white ${FOCUS}`}
              >
                <span>El Niño impact zones</span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    teleconnections ? "bg-indigo-500" : "bg-white/15"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      teleconnections ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
              {teleconnections && (
                <div className="mt-3">
                  <TeleconnectionLegend />
                </div>
              )}
            </Section>
          </div>
        )}
      </div>

      {/* Bottom time slider */}
      <div className={`absolute bottom-3 left-1/2 z-10 w-[min(640px,calc(100vw-1.5rem))] -translate-x-1/2 px-2.5 py-2 sm:bottom-4 sm:px-4 sm:py-3 ${PANEL}`}>
        {!loading && monthFilter === null && (
          <TimeSlider
            minMs={minMs}
            maxMs={maxMs}
            valueMs={cutoff}
            onChange={handleCutoffChange}
            playing={playing}
            onTogglePlay={togglePlay}
            oni={enso?.series}
            showEnsoBand={ensoBandOpen}
            onShowEnsoInfo={() => setEnsoInfo("band")}
          />
        )}
        {monthFilter === null ? (
          // Mobile: 2-column layout — ENSO + calendar tucked under the play
          // button so the row above isn't wasted vertical space. Desktop: the
          // wrappers `display: contents` away so everything flows into a single
          // centered row.
          <div className="mt-2 flex items-start gap-2.5 sm:mt-3 sm:items-center sm:justify-center sm:gap-5">
            <div className="flex w-8 shrink-0 flex-col items-center gap-1.5 sm:contents sm:w-9">
              {enso?.series && enso.series.length > 0 && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={ensoBandOpen}
                  aria-label={
                    ensoBandOpen ? "Hide ENSO sparkline" : "Show ENSO sparkline"
                  }
                  title="El Niño–Southern Oscillation — NOAA Oceanic Niño Index"
                  onClick={() => setEnsoBandOpen((v) => !v)}
                  className={`group flex h-7 cursor-pointer flex-col items-center gap-1 rounded-md sm:h-auto sm:flex-row sm:gap-1.5 ${FOCUS}`}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide text-white/55 transition group-hover:text-white/90">
                    ENSO
                  </span>
                  <span
                    className={`relative inline-block h-3.5 w-7 rounded-full transition ${
                      ensoBandOpen ? "bg-indigo-500/80" : "bg-white/15"
                    }`}
                  >
                    <span
                      className={`absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-all ${
                        ensoBandOpen ? "left-[1rem]" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>
              )}
              <MonthPicker
                value={monthFilter}
                years={years}
                defaultMonth={defaultMonth}
                onChange={handleMonthChange}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 sm:contents">
              <WindowSelect value={windowMonths} onChange={setWindowMonths} />
              <SpeedSelect value={playbackSpeed} onChange={setPlaybackSpeed} />
            </div>
          </div>
        ) : (
          <div className="mt-2 flex justify-center sm:mt-3">
            <MonthPicker
              value={monthFilter}
              years={years}
              defaultMonth={defaultMonth}
              onChange={handleMonthChange}
            />
          </div>
        )}
        <div className="mt-1.5 text-center text-[11px] leading-snug tabular-nums text-white/45 sm:mt-2 sm:text-xs">
          {loading ? (
            "Loading events…"
          ) : monthFilter ? (
            <>
              Showing {visible.length.toLocaleString()} events in{" "}
              {new Date(monthFilter.year, monthFilter.month, 1).toLocaleDateString(
                undefined,
                { month: "long", year: "numeric" },
              )}
            </>
          ) : (
            <>
              Showing {visible.length.toLocaleString()} events
              {windowMonths === null
                ? atNow
                  ? " up to now"
                  : " up to the selected date"
                : ` · ${windowMonths} month${windowMonths > 1 ? "s" : ""} before ${atNow ? "now" : "the selected date"}`}
            </>
          )}
          {!loading && historyLoading && (
            <span className="ml-1.5 text-white/35">· loading history…</span>
          )}
        </div>
      </div>

      {/* Status overlays */}
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center">
          <div className={`flex items-center gap-2.5 rounded-full px-4 py-2 text-sm text-white/90 ${PANEL}`}>
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/25 border-t-indigo-300"
              aria-hidden="true"
            />
            Loading events…
          </div>
        </div>
      )}
      {error && (
        <div className="absolute left-1/2 top-20 z-20 max-w-[min(420px,90vw)] -translate-x-1/2 rounded-xl border border-red-400/30 bg-red-500/15 px-4 py-3 text-sm leading-relaxed text-red-200 shadow-lg shadow-black/30 backdrop-blur-md">
          Could not load data: {error}. Is the API running at{" "}
          {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}?
        </div>
      )}
    </main>
  );
}
