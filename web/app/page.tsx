"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import HazardFilter from "@/components/HazardFilter";
import SeverityFilter from "@/components/SeverityFilter";
import SourceFilter from "@/components/SourceFilter";
import Section from "@/components/Section";
import TimeSlider from "@/components/TimeSlider";
import WindowSelect from "@/components/WindowSelect";
import Legend from "@/components/Legend";
import AboutDialog from "@/components/AboutDialog";
import { fetchEvents } from "@/lib/api";
import { HAZARD_ORDER } from "@/lib/hazards";
import {
  SEVERITY_ORDER,
  matchesSeverity,
  tierOf,
} from "@/lib/severity";
import type { Severity } from "@/lib/severity";
import { SOURCE_ORDER, isKnownSource } from "@/lib/sources";
import type { SourceId } from "@/lib/sources";
import type { EventFeature, HazardType } from "@/lib/types";

// deck.gl + maplibre touch window/WebGL, so the map is client-only.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const DAY_MS = 86_400_000;
// Playback sweeps the whole data domain in a fixed number of frames, so the
// wall-clock speed stays steady regardless of how wide the date range is.
const PLAYBACK_FRAMES = 200;
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
  const [windowMonths, setWindowMonths] = useState<number | null>(1); // default: last 1 month
  const [heatmap, setHeatmap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
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

  useEffect(() => {
    // Fetch everything we have, then let the slider span the real data range —
    // GDACS's most-recent events per hazard can be months old.
    fetchEvents()
      .then((fc) => setFeatures(fc.features))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Time domain derived from the data: [oldest event, now].
  const { minMs, maxMs } = useMemo(() => {
    let min = now;
    for (const f of features) {
      const s = f.properties.started_at;
      if (s) min = Math.min(min, new Date(s).getTime());
    }
    // Guard against a single same-day dataset.
    if (min >= now) min = now - 30 * 86_400_000;
    return { minMs: min, maxMs: now };
  }, [features, now]);

  const cutoff = cutoffMs ?? maxMs;
  const atNow = cutoff >= maxMs;

  // Advance the cutoff toward "now" while playing, then stop on arrival.
  useEffect(() => {
    if (!playing) return;
    const step = Math.max(DAY_MS, (maxMs - minMs) / PLAYBACK_FRAMES);
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
  }, [playing, minMs, maxMs]);

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

  // Reveal events chronologically up to the selected date; if a window is set,
  // also clip off anything older than `lowerMs`.
  const timeFiltered = useMemo(
    () =>
      features.filter((f) => {
        const s = f.properties.started_at
          ? new Date(f.properties.started_at).getTime()
          : null;
        // Undated events can't be placed in a finite window.
        if (s === null) return atNow && lowerMs === null;
        if (s > cutoff) return false;
        return lowerMs === null || s >= lowerMs;
      }),
    [features, cutoff, atNow, lowerMs],
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
      <MapView features={visible} heatmap={heatmap} />

      {/* About button — bottom-left corner */}
      <button
        onClick={() => setAboutOpen(true)}
        aria-label="About this project"
        title="About this project"
        className="absolute bottom-4 left-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#0b1020]/85 text-lg font-bold backdrop-blur transition hover:bg-[#0b1020] opacity-80 hover:opacity-100"
      >
        ?
      </button>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}

      {/* Left control panel */}
      <div
        className={`absolute left-4 top-4 z-10 flex w-72 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-white/10 bg-[#0b1020]/85 backdrop-blur ${
          panelOpen ? "max-h-[calc(100vh-2rem)] overflow-y-auto p-4" : "px-4 py-3"
        }`}
      >
        <button
          onClick={() => setPanelOpenOverride(!panelOpen)}
          aria-expanded={panelOpen}
          aria-controls="panel-body"
          className="-mx-1 flex items-center justify-between gap-2 rounded px-1 py-0.5 text-left transition hover:opacity-90"
        >
          <h1 className="text-base font-semibold">🌍 Extreme Weather Tracker</h1>
          <svg
            width="12"
            height="12"
            viewBox="0 0 10 10"
            className={`shrink-0 opacity-70 transition-transform ${panelOpen ? "" : "-rotate-90"}`}
            aria-hidden
          >
            <path
              d="M1 3 L5 7 L9 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {panelOpen && (
          <div id="panel-body">
            <p className="mt-0.5 text-xs opacity-60">
              Patterns, transitions & intensity of extreme weather worldwide.
            </p>

            <div className="my-3 h-px bg-white/10" />
            <Section title="Hazards">
              <HazardFilter
                active={active}
                counts={counts}
                onToggle={toggle}
                loading={loading}
              />
            </Section>

            <div className="my-3 h-px bg-white/10" />
            <Section title="Severity">
              <SeverityFilter
                active={severity}
                counts={severityCounts}
                onToggle={toggleSeverity}
                loading={loading}
              />
            </Section>

            <div className="my-3 h-px bg-white/10" />
            <Section title="Data source" defaultOpen={false}>
              <SourceFilter
                active={activeSources}
                counts={sourceCounts}
                onToggle={toggleSource}
                loading={loading}
              />
            </Section>

            <div className="my-3 h-px bg-white/10" />
            <Section title="Display" defaultOpen={false}>
              <label className="flex cursor-pointer items-center justify-between text-sm">
                <span>Heatmap view</span>
                <input
                  type="checkbox"
                  checked={heatmap}
                  onChange={(e) => setHeatmap(e.target.checked)}
                  className="accent-indigo-400"
                />
              </label>
              <div className="mt-3">
                <Legend />
              </div>
            </Section>
          </div>
        )}
      </div>

      {/* Bottom time slider */}
      <div className="absolute bottom-4 left-1/2 z-10 w-[min(640px,90vw)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b1020]/85 px-4 py-3 backdrop-blur">
        {!loading && (
          <TimeSlider
            minMs={minMs}
            maxMs={maxMs}
            valueMs={cutoff}
            onChange={handleCutoffChange}
            playing={playing}
            onTogglePlay={togglePlay}
          />
        )}
        <div className="mt-2 flex items-center justify-center">
          <WindowSelect value={windowMonths} onChange={setWindowMonths} />
        </div>
        <div className="mt-1 text-center text-xs opacity-50">
          {loading ? (
            "Loading events…"
          ) : (
            <>
              Showing {visible.length.toLocaleString()} events
              {windowMonths === null
                ? atNow
                  ? " up to now"
                  : " up to the selected date"
                : ` in the ${windowMonths} month${windowMonths > 1 ? "s" : ""} before ${atNow ? "now" : "the selected date"}`}
            </>
          )}
        </div>
      </div>

      {/* Status overlays */}
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-20 flex -translate-y-1/2 items-center justify-center">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0b1020]/85 px-4 py-2 text-sm opacity-90 backdrop-blur">
            <span
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white/90"
              aria-hidden="true"
            />
            Loading events…
          </div>
        </div>
      )}
      {error && (
        <div className="absolute left-1/2 top-20 z-20 -translate-x-1/2 rounded-lg bg-red-500/20 px-4 py-2 text-sm text-red-200">
          Could not load data: {error}. Is the API running at{" "}
          {process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}?
        </div>
      )}
    </main>
  );
}
