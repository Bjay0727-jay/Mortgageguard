"use client";

import { forwardRef, useId } from "react";
import { cn } from "./cn";
import { ERROR_CLASS, FIELD_BASE, FIELD_BORDER_ERROR, FIELD_BORDER_OK, HINT_CLASS, LABEL_CLASS } from "./field";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, "aria-label": ariaLabel, ...props },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? reactId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className={LABEL_CLASS}>
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        aria-label={!label ? ariaLabel : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD_BASE, error ? FIELD_BORDER_ERROR : FIELD_BORDER_OK, className)}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className={ERROR_CLASS}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className={HINT_CLASS}>
          {hint}
        </p>
      ) : null}
    </div>
  );
});
