"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

import HazardFilter from "@/components/HazardFilter";
import SeverityFilter from "@/components/SeverityFilter";
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
import type { Severity, SeverityFilter as SeverityValue } from "@/lib/severity";
import type { EventFeature, HazardType } from "@/lib/types";

// deck.gl + maplibre touch window/WebGL, so the map is client-only.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function Page() {
  const [features, setFeatures] = useState<EventFeature[]>([]);
  const [active, setActive] = useState<Set<HazardType>>(new Set(HAZARD_ORDER));
  const [severity, setSeverity] = useState<SeverityValue>("all");
  const [cutoffMs, setCutoffMs] = useState<number | null>(null); // null = show all
  const [windowMonths, setWindowMonths] = useState<number | null>(null); // null = cumulative
  const [heatmap, setHeatmap] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
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

  const counts = useMemo(() => {
    const c = Object.fromEntries(HAZARD_ORDER.map((h) => [h, 0])) as Record<
      HazardType,
      number
    >;
    for (const f of timeFiltered) c[f.properties.hazard_type]++;
    return c;
  }, [timeFiltered]);

  // Severity counts reflect the events currently in scope (time + hazard),
  // so the segmented control mirrors what each tier would reveal.
  const severityCounts = useMemo(() => {
    const c = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<
      Severity,
      number
    >;
    for (const f of timeFiltered) {
      if (active.has(f.properties.hazard_type)) c[tierOf(f.properties)]++;
    }
    return c;
  }, [timeFiltered, active]);

  const visible = useMemo(
    () =>
      timeFiltered.filter(
        (f) =>
          active.has(f.properties.hazard_type) && matchesSeverity(f, severity),
      ),
    [timeFiltered, active, severity],
  );

  const toggle = (h: HazardType) =>
    setActive((prev) => {
      const next = new Set(prev);
      next.has(h) ? next.delete(h) : next.add(h);
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
      <div className="absolute left-4 top-4 z-10 w-72 rounded-xl border border-white/10 bg-[#0b1020]/85 p-4 backdrop-blur">
        <h1 className="text-base font-semibold">🌍 Extreme Weather Tracker</h1>
        <p className="mt-0.5 text-xs opacity-60">
          Patterns, transitions & intensity of extreme weather worldwide.
        </p>

        <div className="my-3 h-px bg-white/10" />
        <HazardFilter active={active} counts={counts} onToggle={toggle} />

        <div className="my-3 h-px bg-white/10" />
        <SeverityFilter
          value={severity}
          counts={severityCounts}
          onChange={setSeverity}
        />

        <div className="my-3 h-px bg-white/10" />
        <label className="flex cursor-pointer items-center justify-between text-sm">
          <span>Heatmap view</span>
          <input
            type="checkbox"
            checked={heatmap}
            onChange={(e) => setHeatmap(e.target.checked)}
            className="accent-indigo-400"
          />
        </label>

        <div className="my-3 h-px bg-white/10" />
        <Legend />
      </div>

      {/* Bottom time slider */}
      <div className="absolute bottom-4 left-1/2 z-10 w-[min(640px,90vw)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b1020]/85 px-4 py-3 backdrop-blur">
        {!loading && (
          <TimeSlider
            minMs={minMs}
            maxMs={maxMs}
            valueMs={cutoff}
            onChange={setCutoffMs}
          />
        )}
        <div className="mt-2 flex items-center justify-center">
          <WindowSelect value={windowMonths} onChange={setWindowMonths} />
        </div>
        <div className="mt-1 text-center text-xs opacity-50">
          Showing {visible.length.toLocaleString()} events
          {windowMonths === null
            ? atNow
              ? " up to now"
              : " up to the selected date"
            : ` in the ${windowMonths} month${windowMonths > 1 ? "s" : ""} before ${atNow ? "now" : "the selected date"}`}
        </div>
      </div>

      {/* Status overlays */}
      {loading && (
        <div className="absolute inset-x-0 top-1/2 z-20 text-center text-sm opacity-70">
          Loading events…
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
