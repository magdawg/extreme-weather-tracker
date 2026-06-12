"use client";

export default function Legend() {
  return (
    <div className="text-xs leading-relaxed text-white/65">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-white/55" />
        <div className="h-2 flex-1 rounded-full bg-gradient-to-r from-white/25 to-white/90" />
        <span className="inline-block h-4 w-4 shrink-0 rounded-full bg-white/90" />
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-white/45">
        <span>low</span>
        <span>high</span>
      </div>
      <p className="mt-2 text-white/50">
        Dot size &amp; opacity scale with normalized intensity (0–1) across all
        hazards.
      </p>
    </div>
  );
}
