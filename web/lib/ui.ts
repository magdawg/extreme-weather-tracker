// Shared UI tokens so every control on the map shares one visual language:
// the same glass surface, focus ring, radii, and active/hover states. Keeping
// these here (rather than re-typing Tailwind strings per component) is what
// makes the controls read as one system instead of a pile of one-offs.

// Keyboard focus ring — applied to every interactive element.
export const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70";

// Floating glass surface used by the left panel, bottom bar, and dialogs.
export const PANEL =
  "rounded-2xl border border-white/10 bg-[#0b1020]/80 shadow-xl shadow-black/40 ring-1 ring-white/5 backdrop-blur-md";

// Square icon button (play, calendar, close, about, stepper arrows).
export const ICON_BTN = `flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/90 transition hover:bg-white/10 hover:text-white active:scale-95 ${FOCUS}`;

// A segmented-control track (severity / window / speed share this look).
export const SEGMENT =
  "inline-flex items-center gap-0.5 rounded-lg bg-black/20 p-0.5 ring-1 ring-white/10";

// One option inside a SEGMENT track.
export const segmentBtn = (on: boolean) =>
  `cursor-pointer rounded-md px-2 py-1 text-xs tabular-nums transition ${FOCUS} ${
    on
      ? "bg-white/15 text-white shadow-sm"
      : "text-white/55 hover:bg-white/5 hover:text-white/90"
  }`;

// A selectable list row (hazards / sources): tinted + ringed when on,
// dimmed-but-reachable when off.
export const listRow = (on: boolean) =>
  `flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition ${FOCUS} ${
    on
      ? "bg-white/[0.08] text-white ring-1 ring-white/10"
      : "text-white/55 hover:bg-white/[0.04] hover:text-white/90"
  }`;
