"use client";

import { TELE_IMPACTS, TELE_IMPACT_ORDER } from "@/lib/teleconnections";

// Key for the El Niño impact-zone overlay. Shown only while the overlay is on.
export default function TeleconnectionLegend() {
  return (
    <div className="text-xs leading-relaxed text-white/65">
      <ul className="space-y-1">
        {TELE_IMPACT_ORDER.map((k) => (
          <li key={k} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
              style={{
                backgroundColor: `${TELE_IMPACTS[k].hex}55`,
                border: `1px solid ${TELE_IMPACTS[k].hex}`,
              }}
            />
            <span>{TELE_IMPACTS[k].label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
