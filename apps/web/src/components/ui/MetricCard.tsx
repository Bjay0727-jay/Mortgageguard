"use client";

import Link from "next/link";
import { cn } from "./cn";

export interface MetricCardProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  /** Foreground accent (value text + icon). Defaults to royal. */
  color?: string;
  /** Icon chip background. */
  bgColor?: string;
  /** When set, the whole card becomes a focusable link. */
  href?: string;
  className?: string;
}

function Inner({ label, value, icon, color, bgColor, linked }: MetricCardProps & { linked: boolean }) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--gray-500)]">{label}</p>
        {icon != null && (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold"
            style={{ backgroundColor: bgColor ?? "var(--royal-pl)", color: color ?? "var(--royal)" }}
            aria-hidden="true"
          >
            {icon}
          </div>
        )}
      </div>
      <p className="text-2xl font-bold" style={{ color: color ?? "var(--royal)" }}>{value}</p>
      {linked && <p className="mt-2 text-xs text-[var(--gray-400)] group-hover:text-[var(--gray-600)]">Open details →</p>}
    </>
  );
}

/**
 * KPI tile. Renders as a hover-elevating link when `href` is set, otherwise a
 * static card. Hover/focus handled by Tailwind + the global focus ring.
 */
export function MetricCard(props: MetricCardProps) {
  const { href, className, label, value } = props;
  const base = "block rounded-[var(--radius-xl)] border border-[var(--gray-200)] bg-white p-5 shadow-[var(--shadow-sm)]";

  if (href) {
    return (
      <Link
        href={href}
        aria-label={`${label}: ${value}`}
        className={cn(base, "group transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-lg)]", className)}
      >
        <Inner {...props} linked />
      </Link>
    );
  }
  return (
    <div className={cn(base, className)}>
      <Inner {...props} linked={false} />
    </div>
  );
}
