"use client";

// Toggles a single-calendar-month view. Off by default — the time slider +
// window drive the time filter. Clicking the calendar button pins one month;
// while pinned the ‹ › arrows step the year (month fixed), so the same month
// can be compared across years with one click, and the highlighted calendar
// button toggles back to the main timeline.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SELECT_CLASS =
  "rounded-md bg-white/10 px-1.5 py-0.5 text-xs text-white tabular-nums transition hover:bg-white/15 focus:outline-none [&>option]:text-black";

function CalendarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <rect
        x="1.5"
        y="2.5"
        width="11"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M1.5 5.5h11M4.5 1v2.5M9.5 1v2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function MonthPicker({
  value,
  years,
  defaultMonth,
  onChange,
}: {
  value: { year: number; month: number } | null;
  years: number[]; // ascending
  defaultMonth: { year: number; month: number }; // selected when toggled on
  onChange: (v: { year: number; month: number } | null) => void;
}) {
  // Off state: a single calendar button that opts into month view.
  if (value === null) {
    return (
      <button
        onClick={() => onChange(defaultMonth)}
        title="View a single calendar month"
        className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-xs text-white transition hover:bg-white/15"
      >
        <CalendarIcon />
        Month view
      </button>
    );
  }

  const { year, month } = value;
  const minYear = years[0];
  const maxYear = years[years.length - 1];

  // Stepping the month rolls over into the adjacent year; stepping the year
  // keeps the month fixed. Both are bounded by the data's year range.
  const stepMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 11) (m = 0), y++;
    else if (m < 0) (m = 11), y--;
    if (y >= minYear && y <= maxYear) onChange({ year: y, month: m });
  };
  const stepYear = (delta: number) => {
    const y = year + delta;
    if (y >= minYear && y <= maxYear) onChange({ year: y, month });
  };

  const ARROW_CLASS =
    "rounded px-1 text-xs opacity-60 transition enabled:hover:opacity-100 disabled:opacity-20";

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(null)}
        aria-pressed="true"
        aria-label="Exit month view"
        title="Exit month view"
        className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/30 text-indigo-200 transition hover:bg-indigo-500/40"
      >
        <CalendarIcon />
      </button>
      <div className="flex items-center gap-1">
        <button
          onClick={() => stepMonth(-1)}
          disabled={year <= minYear && month <= 0}
          aria-label="Previous month"
          title="Previous month"
          className={ARROW_CLASS}
        >
          ‹
        </button>
        <select
          value={month}
          onChange={(e) => onChange({ year, month: Number(e.target.value) })}
          title="Month"
          className={SELECT_CLASS}
        >
          {MONTHS.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <button
          onClick={() => stepMonth(1)}
          disabled={year >= maxYear && month >= 11}
          aria-label="Next month"
          title="Next month"
          className={ARROW_CLASS}
        >
          ›
        </button>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => stepYear(-1)}
          disabled={year <= minYear}
          aria-label="Previous year"
          title="Previous year (same month)"
          className={ARROW_CLASS}
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
          disabled={year >= maxYear}
          aria-label="Next year"
          title="Next year (same month)"
          className={ARROW_CLASS}
        >
          ›
        </button>
      </div>
    </div>
  );
}
