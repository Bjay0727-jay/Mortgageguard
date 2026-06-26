"use client";

import { cn } from "./cn";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--royal-pl)] text-[var(--royal)]" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className="text-sm font-semibold text-[var(--gray-900)]">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-[var(--gray-500)]">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
