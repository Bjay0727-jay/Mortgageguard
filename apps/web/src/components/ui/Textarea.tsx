"use client";

import { forwardRef, useId } from "react";
import { cn } from "./cn";
import { ERROR_CLASS, FIELD_BASE, FIELD_BORDER_ERROR, FIELD_BORDER_OK, HINT_CLASS, LABEL_CLASS } from "./field";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, "aria-label": ariaLabel, rows = 4, ...props },
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
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        aria-label={!label ? ariaLabel : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(FIELD_BASE, "resize-y", error ? FIELD_BORDER_ERROR : FIELD_BORDER_OK, className)}
        {...props}
      />
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
