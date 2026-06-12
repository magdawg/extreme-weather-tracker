"use client";

export default function Legend() {
  return (
    <div className="text-xs leading-relaxed opacity-70">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-white/60" />
        <div className="h-2 flex-1 rounded-full bg-gradient-to-r from-white/30 to-white/90" />
        <span className="inline-block h-4 w-4 rounded-full bg-white/90" />
      </div>
      <div className="mt-0.5 flex justify-between">
        <span>low</span>
        <span>high</span>
      </div>
      <p className="mt-2 opacity-60">
        Dot size & opacity scale with normalized intensity (0–1) across all
        hazards.
      </p>
    </div>
  );
}
