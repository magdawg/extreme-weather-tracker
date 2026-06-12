"use client";

import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { FOCUS } from "@/lib/ui";

// Toggles a single-calendar-month view. Off by default — the time slider +
// window drive the time filter. Clicking the calendar button pins one month;
// while pinned the ‹ › arrows step the year (month fixed), so the same month
// can be compared across years with one click, and the highlighted calendar
// button toggles back to the main timeline.
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SELECT_CLASS = `cursor-pointer rounded-md bg-white/10 px-2 py-1 text-xs text-white tabular-nums transition hover:bg-white/15 [&>option]:text-black ${FOCUS}`;

const STEP_CLASS = `flex h-6 w-6 cursor-pointer items-center justify-center rounded-md text-white/55 transition enabled:hover:bg-white/10 enabled:hover:text-white disabled:opacity-20 ${FOCUS}`;

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
        className={`flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-white/80 transition hover:bg-white/10 hover:text-white ${FOCUS}`}
      >
        <CalendarIcon size={14} />
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

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(null)}
        aria-pressed="true"
        aria-label="Exit month view"
        title="Exit month view"
        className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-indigo-400/40 bg-indigo-500/25 text-indigo-100 transition hover:bg-indigo-500/35 ${FOCUS}`}
      >
        <CalendarIcon size={14} />
      </button>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => stepMonth(-1)}
          disabled={year <= minYear && month <= 0}
          aria-label="Previous month"
          title="Previous month"
          className={STEP_CLASS}
        >
          <ChevronLeftIcon size={14} />
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
          className={STEP_CLASS}
        >
          <ChevronRightIcon size={14} />
        </button>
      </div>
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => stepYear(-1)}
          disabled={year <= minYear}
          aria-label="Previous year"
          title="Previous year (same month)"
          className={STEP_CLASS}
        >
          <ChevronLeftIcon size={14} />
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
          className={STEP_CLASS}
        >
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </div>
  );
}
