"use client";

import { useEffect } from "react";

import { CloseIcon, GlobeIcon } from "@/components/icons";
import { FOCUS } from "@/lib/ui";

export default function AboutDialog({ onClose }: { onClose: () => void }) {
  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="About this project"
    >
      <div
        className="relative max-h-[85vh] w-[min(520px,92vw)] overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1020]/95 p-6 shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className={`absolute right-4 top-4 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white/55 transition hover:bg-white/10 hover:text-white ${FOCUS}`}
        >
          <CloseIcon size={18} />
        </button>

        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <GlobeIcon size={20} className="text-indigo-300" />
          About this map
        </h2>
        <p className="mt-2 text-sm leading-relaxed opacity-80">
          The Extreme Weather Tracker is a live world map of storms, floods,
          wildfires, droughts, and extreme heat. It&apos;s a place to
          watch the <em>patterns</em>: where these events cluster, how they shift
          through the seasons, and how intense they get, all in one consistent
          view.
        </p>

        <div className="my-4 h-px bg-white/10" />

        <h3 className="text-sm font-medium opacity-90">Where the data comes from</h3>
        <p className="mt-1.5 text-sm leading-relaxed opacity-75">
          Everything is pulled from free, public, open data:
        </p>
        <ul className="mt-2 space-y-1.5 text-sm leading-relaxed opacity-75">
          <li>
            <span className="opacity-90">Storms, floods, wildfires &amp; drought</span>{" "}
            from{" "}
            <a
              href="https://www.gdacs.org"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 underline-offset-2 hover:underline"
            >
              GDACS
            </a>
            , a joint UN &amp; European Commission alert system.
          </li>
          <li>
            <span className="opacity-90">Wildfire hotspots</span>: satellite
            detections from{" "}
            <a
              href="https://firms.modaps.eosdis.nasa.gov"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 underline-offset-2 hover:underline"
            >
              NASA FIRMS
            </a>
            , grouped into clusters.
          </li>
          <li>
            <span className="opacity-90">Extreme heat</span>: derived
            from{" "}
            <a
              href="https://open-meteo.com"
              target="_blank"
              rel="noreferrer"
              className="text-indigo-300 underline-offset-2 hover:underline"
            >
              Open-Meteo
            </a>{" "}
            temperatures across a global grid of cities.
          </li>
        </ul>
        <p className="mt-3 text-xs leading-relaxed opacity-55">
          Every event is normalized into one shared scale, so the map colors and
          sizes each hazard the same way. Dates can run a little behind real
          time, since some sources update on their own schedule, so think of this
          as a window onto the data rather than a minute-by-minute warning system.
        </p>

        <div className="my-4 h-px bg-white/10" />

        <p className="text-sm leading-relaxed opacity-75">
          This is my passion project, built for the joy of seeing the
          planet&apos;s weather all at once, entirely on free tiers. Not
          affiliated with any of the data providers above. Curiosity welcome.
        </p>

        <div className="my-4 h-px bg-white/10" />

        <p className="text-sm leading-relaxed opacity-75">
          Made with ❤️ in Portugal · Copyright Magda Kowalska
        </p>
      </div>
    </div>
  );
}
