"use client";

// null = cumulative (everything up to the selected date); a number restricts
// to that many months counted back from the selected date.
export const WINDOW_OPTIONS: { label: string; months: number | null }[] = [
  { label: "All", months: null },
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
      <span className="text-xs opacity-60">Window</span>
      <div className="flex gap-1">
        {WINDOW_OPTIONS.map((o) => {
          const on = value === o.months;
          return (
            <button
              key={o.label}
              onClick={() => onChange(o.months)}
              title={
                o.months === null
                  ? "All events up to the selected date"
                  : `Only events within ${o.months} month${o.months > 1 ? "s" : ""} before the selected date`
              }
              className={`rounded-md px-2 py-0.5 text-xs tabular-nums transition ${
                on ? "bg-white/15" : "opacity-50 hover:opacity-80"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
