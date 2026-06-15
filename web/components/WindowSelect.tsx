"use client";

import { SEGMENT, segmentBtn } from "@/lib/ui";

// A number restricts to that many months counted back from the selected date.
// (`null` still means cumulative, but is no longer offered as a preset now that
// the dataset is backfilled to 2021 and loading everything is expensive.)
export const WINDOW_OPTIONS: { label: string; months: number | null }[] = [
  { label: "1m", months: 1 },
  { label: "3m", months: 3 },
  { label: "6m", months: 6 },
  { label: "12m", months: 12 },
];

export default function WindowSelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (months: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="hidden text-[11px] font-medium uppercase tracking-wide text-white/45 sm:inline">
        Window
      </span>
      <div className={SEGMENT}>
        {WINDOW_OPTIONS.map((o) => {
          const on = value === o.months;
          return (
            <button
              key={o.label}
              onClick={() => onChange(o.months)}
              aria-pressed={on}
              title={
                o.months === null
                  ? "All events up to the selected date"
                  : `Only events within ${o.months} month${o.months > 1 ? "s" : ""} before the selected date`
              }
              className={segmentBtn(on)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
