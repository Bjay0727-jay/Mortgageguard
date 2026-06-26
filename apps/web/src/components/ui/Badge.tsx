"use client";

import { cn } from "./cn";
import { scoreVariant, stageLabel, stageVariant, type BadgeVariant } from "./tokens";

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  royal: "bg-[var(--royal-pl)] text-[var(--royal)]",
  green: "bg-[var(--grn-pl)] text-[var(--grn)]",
  amber: "bg-[var(--amb-pl)] text-[var(--amb)]",
  red: "bg-[var(--red-pl)] text-[var(--red)]",
  gray: "bg-[var(--gray-100)] text-[var(--gray-700)]",
  blue: "bg-blue-100 text-blue-800",
  indigo: "bg-indigo-100 text-indigo-800",
  purple: "bg-purple-100 text-purple-800",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ variant = "gray", className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full px-2.5 py-0.5 text-xs font-semibold leading-tight",
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** Loan-stage badge — colors + labels come from the centralized token map. */
export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={stageVariant(status)}>{stageLabel(status)}</Badge>;
}

/** Risk / compliance score badge — ≥80 green, ≥50 amber, else red. */
export function ScoreBadge({ score }: { score: number }) {
  return <Badge variant={scoreVariant(score)}>{score}%</Badge>;
}
