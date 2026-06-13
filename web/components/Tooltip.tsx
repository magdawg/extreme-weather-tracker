"use client";

import type { ReactNode } from "react";

// A lightweight, dependency-free tooltip that matches the app's glass surface,
// replacing the browser's unstyleable native `title` bubble. CSS-only: it shows
// on hover and on keyboard focus (group-focus-within) for accessibility.
//
// `align` controls horizontal anchoring so triggers near a screen edge (e.g.
// the top-right ENSO card) don't overflow the viewport: use "right" there and
// "center" for elements with room on both sides.
export default function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
  className = "",
}: {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  align?: "center" | "left" | "right";
  className?: string;
}) {
  const sideCls =
    side === "top"
      ? "bottom-full mb-2 translate-y-1"
      : "top-full mt-2 -translate-y-1";
  const alignCls =
    align === "center"
      ? "left-1/2 -translate-x-1/2 text-center"
      : align === "right"
        ? "right-0 text-left"
        : "left-0 text-left";

  return (
    <span className={`group/tt relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        aria-hidden="true"
        className={`pointer-events-none absolute z-50 w-max max-w-[220px] rounded-lg border border-white/10 bg-[#0b1020]/95 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-white/90 opacity-0 shadow-xl shadow-black/50 ring-1 ring-white/5 backdrop-blur-md transition duration-150 ease-out group-hover/tt:translate-y-0 group-hover/tt:opacity-100 group-focus-within/tt:translate-y-0 group-focus-within/tt:opacity-100 ${sideCls} ${alignCls}`}
      >
        {label}
      </span>
    </span>
  );
}
