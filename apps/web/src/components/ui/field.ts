// Shared styling for text inputs, selects and textareas. Focus styling is
// expressed purely with Tailwind utility classes (border + ring shadow) so
// there are no inline onFocus/onBlur style mutations anywhere in the app.
export const FIELD_BASE =
  "w-full rounded-lg border bg-white text-sm text-[var(--gray-900)] placeholder:text-[var(--gray-400)] " +
  "px-3.5 py-2.5 outline-none transition-colors " +
  "focus:border-[var(--royal)] focus:shadow-[0_0_0_3px_rgba(27,58,107,0.12)] " +
  "disabled:cursor-not-allowed disabled:bg-[var(--gray-50)] disabled:text-[var(--gray-500)]";

export const FIELD_BORDER_OK = "border-[var(--gray-300)]";
export const FIELD_BORDER_ERROR =
  "border-[var(--red)] focus:border-[var(--red)] focus:shadow-[0_0_0_3px_rgba(196,48,43,0.12)]";

export const LABEL_CLASS = "mb-1.5 block text-sm font-medium text-[var(--gray-700)]";
export const HINT_CLASS = "mt-1.5 text-xs text-[var(--gray-500)]";
export const ERROR_CLASS = "mt-1.5 text-xs font-medium text-[var(--red)]";
