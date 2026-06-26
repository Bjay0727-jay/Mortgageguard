"use client";

import { forwardRef, useId } from "react";
import { cn } from "./cn";
import { ERROR_CLASS, FIELD_BASE, FIELD_BORDER_ERROR, FIELD_BORDER_OK, HINT_CLASS, LABEL_CLASS } from "./field";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options?: SelectOption[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, className, id, options, children, "aria-label": ariaLabel, ...props },
  ref,
) {
  const reactId = useId();
  const fieldId = id ?? reactId;
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={fieldId} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={fieldId}
        aria-label={!label ? ariaLabel : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD_BASE, "cursor-pointer appearance-none pr-9", error ? FIELD_BORDER_ERROR : FIELD_BORDER_OK, className)}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236B7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 0.75rem center",
        }}
        {...props}
      >
        {options ? options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>) : children}
      </select>
      {error ? (
        <p id={`${fieldId}-error`} className={ERROR_CLASS}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className={HINT_CLASS}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
