"use client";

import { useEffect } from "react";

import { HAZARDS } from "@/lib/hazards";
import { SEVERITIES, tierOf } from "@/lib/severity";
import { SOURCES, isKnownSource } from "@/lib/sources";
import { PANEL, FOCUS } from "@/lib/ui";
import { HazardIcon, CloseIcon, ExternalLinkIcon } from "@/components/icons";
import type { EventProperties } from "@/lib/types";

// The full event the user clicked, plus its map position (for the coordinate
// readout). Selection lives in the page; this component is purely presentational.
export interface SelectedEvent {
  props: EventProperties;
  position: [number, number] | null; // [lng, lat]
}

function fmtDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function fmtCoord([lng, lat]: [number, number]) {
  const ns = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}`;
  const ew = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? "E" : "W"}`;
  return `${ns}, ${ew}`;
}

// A labeled detail row — muted uppercase label, value on the right.
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-white/40">
        {label}
      </span>
      <span className="min-w-0 text-right text-sm text-white/85">{children}</span>
    </div>
  );
}

export default function EventDetails({
  event,
  onClose,
}: {
  event: SelectedEvent;
  onClose: () => void;
}) {
  // Close on Escape, mirroring the About dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const p = event.props;
  const hazard = HAZARDS[p.hazard_type];
  const label = hazard?.label ?? p.hazard_type;
  const sev = SEVERITIES[tierOf(p)];
  const date = fmtDate(p.started_at);
  const source = isKnownSource(p.source) ? SOURCES[p.source] : null;
  const intensityPct =
    p.intensity_norm !== null ? Math.round(p.intensity_norm * 100) : null;

  // Lead with the title only when it adds something beyond the hazard label.
  const showTitle =
    p.title &&
    !(p.country && p.title.toLowerCase().includes(p.country.toLowerCase()));

  return (
    <div
      role="dialog"
      aria-label="Event details"
      className={`ewt-pop absolute right-4 top-[4.75rem] z-20 w-80 max-w-[calc(100vw-2rem)] p-4 ${PANEL}`}
    >
      <button
        onClick={onClose}
        aria-label="Close details"
        className={`absolute right-3 top-3 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white ${FOCUS}`}
      >
        <CloseIcon size={16} />
      </button>

      {/* Header: hazard glyph (in its color) + label + severity pill */}
      <div className="flex items-center gap-2 pr-7">
        <span style={{ color: hazard?.hex }}>
          <HazardIcon hazard={p.hazard_type} size={20} />
        </span>
        <h2 className="text-base font-semibold tracking-tight">{label}</h2>
        <span
          className="ml-auto inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{
            color: sev.hex,
            background: `${sev.hex}22`,
            border: `1px solid ${sev.hex}55`,
          }}
        >
          {sev.label}
        </span>
      </div>

      {showTitle && (
        <p className="mt-2 text-sm leading-snug text-white/80">{p.title}</p>
      )}

      <div className="my-3 h-px bg-white/10" />

      <div className="divide-y divide-white/5">
        {p.country && <Row label="Location">{p.country}</Row>}
        {date && (
          <Row label="When">
            <span className="tabular-nums">{date}</span>
          </Row>
        )}
        {event.position && (
          <Row label="Coordinates">
            <span className="tabular-nums">{fmtCoord(event.position)}</span>
          </Row>
        )}
        {intensityPct !== null && (
          <Row label="Intensity">
            <span className="flex items-center justify-end gap-2">
              <span
                className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10"
                aria-hidden
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${intensityPct}%`,
                    background: hazard?.hex ?? "#9ca3af",
                  }}
                />
              </span>
              <span className="tabular-nums text-white/85">{intensityPct}%</span>
            </span>
          </Row>
        )}
        {/* Source's own classification, when it's human-readable (e.g. GDACS
            alert color, or FIRMS "FRP 42 MW") rather than a bare code. */}
        {p.severity_raw && (
          <Row label="Alert">
            <span className="capitalize">{p.severity_raw}</span>
          </Row>
        )}
      </div>

      {source && (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          title={source.description}
          className={`mt-3 flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10 hover:text-white ${FOCUS}`}
        >
          <span>
            Source: <span className="font-medium text-white/90">{source.label}</span>
          </span>
          <ExternalLinkIcon size={14} className="shrink-0 text-white/50" />
        </a>
      )}
    </div>
  );
}
