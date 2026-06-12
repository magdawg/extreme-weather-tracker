"use client";

// Picks a single calendar month to view in isolation. `null` = off (the slider
// + window drive the time filter instead). When a month is selected the ‹ ›
// arrows step the year while keeping the month fixed, so the same month can be
// compared across years with one click.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SELECT_CLASS =
  "rounded-md bg-white/10 px-1.5 py-0.5 text-xs text-white tabular-nums transition hover:bg-white/15 focus:outline-none [&>option]:text-black";

export default function MonthPicker({
  value,
  years,
  onChange,
}: {
  value: { year: number; month: number } | null;
  years: number[]; // ascending
  onChange: (v: { year: number; month: number } | null) => void;
}) {
  const active = value !== null;
  const latestYear = years[years.length - 1];
  const year = value?.year ?? latestYear;
  const month = value?.month ?? 0;
  const yearIdx = years.indexOf(year);

  const setMonth = (m: number) =>
    onChange(m < 0 ? null : { year, month: m });
  const stepYear = (delta: number) => {
    const i = yearIdx + delta;
    if (i >= 0 && i < years.length) onChange({ year: years[i], month });
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs opacity-60">Month</span>
      <select
        value={active ? month : -1}
        onChange={(e) => setMonth(Number(e.target.value))}
        title="View a single calendar month"
        className={SELECT_CLASS}
      >
        <option value={-1}>All</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i}>
            {m}
          </option>
        ))}
      </select>
      {active && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => stepYear(-1)}
            disabled={yearIdx <= 0}
            aria-label="Previous year"
            title="Previous year (same month)"
            className="rounded px-1 text-xs opacity-60 transition enabled:hover:opacity-100 disabled:opacity-20"
          >
            ‹
          </button>
          <select
            value={year}
            onChange={(e) => onChange({ year: Number(e.target.value), month })}
            title="Year"
            className={SELECT_CLASS}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            onClick={() => stepYear(1)}
            disabled={yearIdx >= years.length - 1}
            aria-label="Next year"
            title="Next year (same month)"
            className="rounded px-1 text-xs opacity-60 transition enabled:hover:opacity-100 disabled:opacity-20"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
