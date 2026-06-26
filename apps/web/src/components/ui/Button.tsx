"use client";

import { forwardRef } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--royal)] text-white hover:bg-[var(--royal-lt)] border border-transparent",
  secondary:
    "bg-white text-[var(--royal)] border border-[var(--gray-300)] hover:bg-[var(--gray-50)]",
  success:
    "bg-[var(--grn)] text-white hover:bg-[var(--grn-lt)] border border-transparent",
  danger:
    "bg-[var(--red)] text-white hover:opacity-90 border border-transparent",
  ghost:
    "bg-transparent text-[var(--gray-700)] hover:bg-[var(--gray-100)] border border-transparent",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5 gap-1.5 rounded-md",
  md: "text-sm px-4 py-2.5 gap-2 rounded-lg",
  lg: "text-base px-5 py-3 gap-2 rounded-lg",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "p-1.5 rounded-md",
  md: "p-2 rounded-lg",
  lg: "p-2.5 rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Render as a square icon-only button. Requires `aria-label`. */
  iconOnly?: boolean;
  fullWidth?: boolean;
}

/**
 * Brand button. Hover/focus are handled entirely by Tailwind utility classes
 * (and the global `:focus-visible` ring) — no inline style mutation.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, iconOnly = false, fullWidth = false, className, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center font-semibold transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANTS[variant],
        iconOnly ? ICON_SIZES[size] : SIZES[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
});
