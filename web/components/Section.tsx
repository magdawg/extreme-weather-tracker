"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { FOCUS } from "@/lib/ui";

export default function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`-mx-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-center justify-between rounded-md px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-white/55 transition hover:text-white/90 ${FOCUS}`}
      >
        <span>{title}</span>
        <ChevronDownIcon
          size={14}
          className={`text-white/40 transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
