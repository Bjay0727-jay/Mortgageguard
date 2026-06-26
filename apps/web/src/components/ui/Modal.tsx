"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { cn } from "./cn";

export type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: ModalSize;
  /** Clicking the backdrop closes the modal. Default true. */
  closeOnBackdrop?: boolean;
  /** Footer area (typically action buttons). */
  footer?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * Accessible dialog: role="dialog", aria-modal, focus trap, Escape-to-close,
 * focus returned to the trigger on close, body scroll locked while open.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  closeOnBackdrop = true,
  footer,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  // Lock body scroll, remember + restore focus, move focus into the dialog.
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (firstFocusable ?? panel)?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex bg-black/50",
        // Mobile: dock to the bottom as a sheet. Desktop: center it.
        "items-end justify-center sm:items-center sm:p-4",
      )}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex w-full flex-col bg-white shadow-[var(--shadow-xl)] outline-none",
          // Mobile: full-width bottom sheet, rounded top only, tall.
          "max-h-[92vh] rounded-t-[var(--radius-xl)]",
          // Desktop: centered card capped by size.
          "sm:max-h-[90vh] sm:rounded-[var(--radius-xl)]",
          SIZES[size],
        )}
      >
        {(title || description) && (
          <div className="flex-shrink-0 border-b border-[var(--gray-200)] px-6 py-4">
            {title && (
              <h2 id={titleId} className="text-lg font-semibold text-[var(--gray-900)]">
                {title}
              </h2>
            )}
            {description && (
              <p id={descId} className="mt-1 text-sm text-[var(--gray-500)]">
                {description}
              </p>
            )}
          </div>
        )}
        {/* Body scrolls; header + footer stay pinned. */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-[var(--gray-200)] px-6 py-4 [padding-bottom:calc(1rem+env(safe-area-inset-bottom))] sm:[padding-bottom:1rem]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
