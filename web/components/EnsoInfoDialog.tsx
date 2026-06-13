"use client";

import { useEffect } from "react";

import { CloseIcon, ExternalLinkIcon } from "@/components/icons";
import { FOCUS } from "@/lib/ui";
import { ENSO_PHASES } from "@/lib/enso";

export type EnsoInfoTopic = "card" | "band" | "signal" | "monthly";

/**
 * Explains the ENSO UI. Three entry points, three explanations: the top-right
 * `card` (current state — value, phase, trend), the timeline `band` (the index
 * plotted over time), and the `signal` (how the hazard mix shifts during El
 * Niño). Only the `card` — the primary ENSO status — carries the full "what is
 * ENSO" intro; the others would just repeat it, so they go straight to their
 * tailored section. The data source footer is shared.
 */
export default function EnsoInfoDialog({
  topic,
  onClose,
}: {
  topic: EnsoInfoTopic;
  onClose: () => void;
}) {
  // Close on Escape for keyboard users.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isCard = topic === "card";
  const title =
    topic === "card"
      ? "El Niño status (ENSO)"
      : topic === "band"
        ? "The ENSO timeline"
        : topic === "monthly"
          ? "Latest month (Niño-3.4)"
          : "The El Niño signal";
  const ariaLabel =
    topic === "card"
      ? "About the ENSO status card"
      : topic === "band"
        ? "About the ENSO timeline"
        : topic === "monthly"
          ? "About the latest-month Niño-3.4 anomaly"
          : "About the El Niño signal";

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
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

        <h2 className="pr-8 text-lg font-semibold">{title}</h2>
        {isCard && (
          <p className="mt-2 text-sm leading-relaxed opacity-80">
            ENSO — the El Niño–Southern Oscillation — is a natural climate
            pattern in the tropical Pacific that swings between warm (
            <em>El Niño</em>) and cool (<em>La Niña</em>) phases every few
            years. It reshapes weather worldwide: shifting where storms, floods,
            droughts, and extreme heat tend to strike. The standard yardstick is
            the{" "}
            <span className="opacity-90">Oceanic Niño Index (ONI)</span> — a
            3-month average of sea-surface temperature anomalies in the central
            tropical Pacific, in °C.
          </p>
        )}

        <div className="my-4 h-px bg-white/10" />

        {isCard ? (
          <>
            <h3 className="text-sm font-medium opacity-90">What this card shows</h3>
            <p className="mt-1.5 text-sm leading-relaxed opacity-75">
              The big number is the <span className="opacity-90">latest ONI
              value</span>. Its label classifies the current phase:
            </p>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed opacity-75">
              <li className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ENSO_PHASES["el-nino"].hex }}
                />
                <span>
                  <span className="opacity-90">El Niño</span> — index ≥ +0.5 °C
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ENSO_PHASES["la-nina"].hex }}
                />
                <span>
                  <span className="opacity-90">La Niña</span> — index ≤ −0.5 °C
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ENSO_PHASES["neutral"].hex }}
                />
                <span>
                  <span className="opacity-90">Neutral</span> — anything in
                  between. A <span className="opacity-90">&ldquo;Watch&rdquo;</span>{" "}
                  means it&apos;s neutral but trending toward a threshold.
                </span>
              </li>
            </ul>
            <p className="mt-3 text-sm leading-relaxed opacity-75">
              The small arrow is the <span className="opacity-90">trend</span>{" "}
              — the change versus the previous 3-month season — so red ↑ means
              the
              Pacific is warming toward El Niño, blue ↓ means it&apos;s cooling.
              The line beneath shows how far the index sits from the nearest
              El Niño / La Niña threshold.
            </p>
            <p className="mt-3 text-sm leading-relaxed opacity-75">
              Below that, <span className="opacity-90">Latest month</span> shows
              the freshest single-month Niño-3.4 anomaly — a more current, but
              noisier, read than the 3-month ONI. Tap its info icon for the full
              distinction.
            </p>
          </>
        ) : topic === "monthly" ? (
          <>
            <h3 className="text-sm font-medium opacity-90">
              What &ldquo;Latest month&rdquo; shows
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed opacity-75">
              The big number is the most recent{" "}
              <span className="opacity-90">single-month</span> sea-surface
              temperature anomaly in the{" "}
              <span className="opacity-90">Niño-3.4 region</span> — the patch of
              the central-tropical Pacific that defines ENSO. The arrow is its
              change versus the previous month, and the small spark traces the
              last several months.
            </p>
            <h3 className="mt-4 text-sm font-medium opacity-90">
              Why it&apos;s not the ONI
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed opacity-75">
              The headline ENSO value above is the{" "}
              <span className="opacity-90">ONI</span>, a <em>3-month</em>{" "}
              running mean. That smoothing means its newest value is always
              centred on a
              month or so ago (e.g. a &ldquo;Mar–Apr–May&rdquo; season). This
              monthly figure has <span className="opacity-90">no such lag</span>,
              so it&apos;s the freshest read on the Pacific — useful for spotting
              a turn before the ONI catches up.
            </p>
            <p className="mt-3 text-sm leading-relaxed opacity-75">
              The trade-offs: a single month is{" "}
              <span className="opacity-90">noisier</span> than a 3-month average,
              and it sits on a fixed{" "}
              <span className="opacity-90">1991–2020 baseline</span>{" "}
              rather than the ONI&apos;s sliding 30-year base. So it isn&apos;t a
              like-for-like
              ONI value, and we deliberately <em>don&apos;t</em> use it to label
              the El Niño / La Niña phase.
            </p>
          </>
        ) : topic === "band" ? (
          <>
            <h3 className="text-sm font-medium opacity-90">What the band shows</h3>
            <p className="mt-1.5 text-sm leading-relaxed opacity-75">
              The strip above the slider plots the ONI over time — one bar per
              3-month season — on the same dates as the timeline below it:
            </p>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed opacity-75">
              <li className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ENSO_PHASES["el-nino"].hex }}
                />
                <span>
                  <span className="opacity-90">Red, above the centre line</span>{" "}
                  — El Niño periods (index ≥ +0.5 °C)
                </span>
              </li>
              <li className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ENSO_PHASES["la-nina"].hex }}
                />
                <span>
                  <span className="opacity-90">Blue, below the centre line</span>{" "}
                  — La Niña periods (index ≤ −0.5 °C)
                </span>
              </li>
            </ul>
            <p className="mt-3 text-sm leading-relaxed opacity-75">
              Bar height is the strength of the anomaly. Because it lines up with
              the slider, you can scrub the timeline and see how El Niño / La Niña
              phases coincide with the events on the map.
            </p>
          </>
        ) : (
          <>
            <h3 className="text-sm font-medium opacity-90">
              What the signal shows
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed opacity-75">
              For every event on record, we look up the ENSO phase of the month
              it began, then compare each hazard&apos;s{" "}
              <span className="opacity-90">share of events during El Niño
              months</span> against its share across the whole record. A{" "}
              <span className="text-rose-300">warm bar</span> means that hazard
              makes up a <em>bigger</em> slice of activity when the Pacific runs
              warm; a <span className="text-sky-300">cool bar</span> means a
              smaller slice.
            </p>
            <p className="mt-3 text-sm leading-relaxed opacity-75">
              It compares the <span className="opacity-90">mix</span>, not the
              raw counts, on purpose: the total number of events drifts as data
              sources and backfills change over time, and shares cancel that
              out. The figure is{" "}
              <span className="opacity-90">correlational, not a forecast</span>{" "}
              — a few years of events can&apos;t prove El Niño <em>caused</em>{" "}
              any
              shift, and the signal only appears once enough events overlap the
              El Niño periods in the record.
            </p>
          </>
        )}

        <div className="my-4 h-px bg-white/10" />

        <h3 className="text-sm font-medium opacity-90">Where the data comes from</h3>
        <p className="mt-1.5 text-sm leading-relaxed opacity-75">
          The ONI series (back to 1950) is published by NOAA&apos;s{" "}
          <a
            href="https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-indigo-300 underline-offset-2 hover:underline"
          >
            Climate Prediction Center
            <ExternalLinkIcon size={12} />
          </a>
          , free and public. It refreshes monthly; this map re-pulls it on the
          same schedule as the rest of the data.
        </p>
      </div>
    </div>
  );
}
