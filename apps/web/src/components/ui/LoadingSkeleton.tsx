"use client";

import { cn } from "./cn";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tailwind width/height utilities, e.g. "h-4 w-32". */
  className?: string;
}

/** A single shimmering placeholder block. */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-[var(--gray-200)]", className)}
      {...props}
    />
  );
}

/** Convenience: N stacked skeleton lines inside an accessible busy region. */
export function LoadingSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={cn("space-y-3", className)}>
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4", i % 3 === 0 ? "w-3/4" : i % 3 === 1 ? "w-full" : "w-5/6")} />
      ))}
    </div>
  );
}
