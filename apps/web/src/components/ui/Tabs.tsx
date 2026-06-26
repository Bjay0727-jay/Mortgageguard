"use client";

import { useRef } from "react";
import { cn } from "./cn";

export interface TabItem {
  id: string;
  label: React.ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  "aria-label"?: string;
}

/** Accessible tablist: roving focus, ←/→/Home/End navigation, aria-selected. */
export function Tabs({ tabs, value, onChange, className, "aria-label": ariaLabel }: TabsProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: React.KeyboardEvent) {
    const idx = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const id = tabs[next].id;
    onChange(id);
    refs.current[id]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("flex gap-1 overflow-x-auto border-b border-[var(--gray-200)] whitespace-nowrap", className)}
    >
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[t.id] = el; }}
            role="tab"
            type="button"
            id={`tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              selected
                ? "border-[var(--royal)] text-[var(--royal)]"
                : "border-transparent text-[var(--gray-500)] hover:text-[var(--gray-800)]",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Pair with a Tabs `value` to give panels the right aria wiring. */
export function TabPanel({ id, value, children, className }: { id: string; value: string; children: React.ReactNode; className?: string }) {
  if (id !== value) return null;
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className={className}>
      {children}
    </div>
  );
}
