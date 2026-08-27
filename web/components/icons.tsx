// One consistent stroke-based icon set (Lucide-style: 24px grid, 1.75 stroke,
// round caps/joins) so the UI never falls back to emoji — which render
// differently per-OS and can't be themed. `currentColor` lets each icon inherit
// text color, so the same glyph works dimmed, accented, or hazard-colored.
import type { HazardType } from "@/lib/types";

type IconProps = { size?: number; className?: string };

function Svg({
  size = 16,
  className,
  children,
  fill = "none",
}: IconProps & { children: React.ReactNode; fill?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const GlobeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9Z" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 7.75h.01" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const ChevronDownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 8.5 12 15l7-6.5" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.5 5 8 12l6.5 7" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 5 16 12l-6.5 7" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor">
    <path d="M7 4.5v15l12-7.5z" strokeWidth={1.5} />
  </Svg>
);

export const PauseIcon = (p: IconProps) => (
  <Svg {...p} fill="currentColor">
    <rect x="6.5" y="4.5" width="3.5" height="15" rx="1.25" strokeWidth={1} />
    <rect x="14" y="4.5" width="3.5" height="15" rx="1.25" strokeWidth={1} />
  </Svg>
);

export const ExternalLinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 10.5 13.5" />
    <path d="M19 14v5.5A1.5 1.5 0 0 1 17.5 21h-13A1.5 1.5 0 0 1 3 19.5v-13A1.5 1.5 0 0 1 4.5 5H10" />
  </Svg>
);

// Used on the "Donate" CTA in the event detail panel. Lucide-style heart.
export const HeartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19 14.5c1.7-1.5 3-3.2 3-5.5 0-2.5-2-4.5-4.5-4.5-1.8 0-3 1-4.5 2.5C11.5 5.5 10.3 4.5 8.5 4.5 6 4.5 4 6.5 4 9c0 2.3 1.3 4 3 5.5l5 5z" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </Svg>
);

// A slider/timeline glyph: a horizontal rail with a thumb — used to return
// from the pinned-month view back to the scrubbing timeline.
export const TimelineIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h18" />
    <circle cx="9" cy="12" r="2.9" fill="currentColor" stroke="none" />
  </Svg>
);

// --- Hazard glyphs (carry the hazard's color via currentColor) -------------

const Storm = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 12c3 0 5-1.5 5-3.4S15 5 12 5.4" />
    <path d="M12 12c-3 0-5 1.5-5 3.4S9 19 12 18.6" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

const Flood = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8c1.4 0 1.4 1.3 2.8 1.3S7.2 8 8.6 8s1.4 1.3 2.8 1.3S12.8 8 14.2 8s1.4 1.3 2.8 1.3S18.4 8 21 8" />
    <path d="M3 13c1.4 0 1.4 1.3 2.8 1.3S7.2 13 8.6 13s1.4 1.3 2.8 1.3S12.8 13 14.2 13s1.4 1.3 2.8 1.3S18.4 13 21 13" />
    <path d="M3 18c1.4 0 1.4 1.3 2.8 1.3S7.2 18 8.6 18s1.4 1.3 2.8 1.3S12.8 18 14.2 18s1.4 1.3 2.8 1.3S18.4 18 21 18" />
  </Svg>
);

const Wildfire = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3c.9 2.6 2.6 3.5 3.8 5.2C16.9 9.7 17.5 11 17.5 12.6a5.5 5.5 0 0 1-11 0c0-1.1.3-2.2 1-3.1.5 1.1 1.4 1.6 2.2 1.6.9 0 1.3-1 1.3-2.1 0-2 .3-4 1-6Z" />
  </Svg>
);

const Heat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 13.6V5.5a2 2 0 1 1 4 0v8.1a4 4 0 1 1-4 0Z" />
    <path d="M12 10.5v4.5" />
  </Svg>
);

const Drought = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="10" r="3.4" />
    <path d="M12 3v1.6M12 15.4V17M4.6 10h1.6M17.8 10h1.6M6.7 4.7l1.1 1.1M16.2 4.7l-1.1 1.1" />
    <path d="M4 20h3M9 20h3.5M15 20h5" />
  </Svg>
);

// Spike additions — kept geometrically simple so they read at 16px alongside
// the existing five hazard glyphs.

const CoralBleach = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21v-6" />
    <path d="M9 15c-2 0-3-1.5-3-3.2 0-1.4 1-2.3 1-3.3 0-1.2-1-1.6-1-2.8C6 4 8 3 9.5 3.6 10.5 3 12 3 13 3.6 14 3 15.5 3.5 16 5c.4 1-.4 1.7-.4 2.5 0 1 .9 1.8.9 3 0 1.7-1 3.5-3 3.5" />
    <path d="M9 15h6" />
  </Svg>
);

const MarineHeat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 12.6V5a2 2 0 1 1 4 0v7.6a3.5 3.5 0 1 1-4 0Z" />
    <path d="M3 19c1.4 0 1.4 1.2 2.8 1.2S7.2 19 8.6 19s1.4 1.2 2.8 1.2S12.8 19 14.2 19s1.4 1.2 2.8 1.2S18.4 19 21 19" />
  </Svg>
);

const Swell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 16c2 0 3-4 6-4s4 4 6 4 3-4 6-4" />
    <path d="M3 11c2 0 3-4 6-4s4 4 6 4 3-4 6-4" />
  </Svg>
);

const Mortality = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 4.5h7L17 8v6.5l-2 2-1 2.5h-4l-1-2.5-2-2V8z" />
    <circle cx="10" cy="11" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14" cy="11" r="1.1" fill="currentColor" stroke="none" />
    <path d="M11 14h2" />
  </Svg>
);

const Deforestation = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 7 9h3l-3 4h3l-3 4h10l-3-4h3l-3-4h3z" />
    <path d="M12 17v4" />
    <path d="M5 20h14" />
  </Svg>
);

const AirQuality = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9c0-1.5 1.2-2.5 2.5-2.5 1 0 1.7.5 2 1 .5-1.3 1.8-2 3.2-2 1.8 0 3.3 1.3 3.3 3.2 0 .2 0 .4-.1.6" />
    <path d="M3 13h12.5a2 2 0 1 1 0 4H3" />
    <path d="M3 18h17" />
  </Svg>
);

const HAZARD_ICONS: Record<HazardType, (p: IconProps) => React.ReactElement> = {
  storm: Storm,
  flood: Flood,
  wildfire: Wildfire,
  heat: Heat,
  drought: Drought,
  coral_bleach: CoralBleach,
  marine_heat: MarineHeat,
  swell: Swell,
  mortality: Mortality,
  deforestation: Deforestation,
  air_quality: AirQuality,
};

export function HazardIcon({
  hazard,
  ...rest
}: IconProps & { hazard: HazardType }) {
  const Glyph = HAZARD_ICONS[hazard];
  return <Glyph {...rest} />;
}
