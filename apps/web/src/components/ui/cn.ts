// Tiny classNames joiner — no dependency. Falsy values are dropped so
// callers can write `cn("base", active && "is-active", className)`.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
