// ─────────────────────────────────────────────────────────────
// Design tokens — the single source of truth for brand colors,
// spacing, shadows, and radii. These mirror the CSS custom
// properties declared in `globals.css` so TS code and CSS stay
// in lock-step. Prefer Tailwind utility classes in components;
// reach for these constants only when a value must live in JS
// (inline gradients, canvas, computed styles, etc.).
// ─────────────────────────────────────────────────────────────

export const colors = {
  royal: "#1B3A6B",
  royalLight: "#2B5298",
  royalPale: "#E8EEF7",

  green: "#0F7B46",
  greenLight: "#15A35E",
  greenPale: "#E6F5EE",

  red: "#C4302B",
  redPale: "#FEF0EF",

  amber: "#B8860B",
  amberPale: "#FFF8E7",

  gray: {
    50: "#F9FAFB",
    100: "#F3F4F6",
    200: "#E5E7EB",
    300: "#D1D5DB",
    400: "#9CA3AF",
    500: "#6B7280",
    600: "#4B5563",
    700: "#374151",
    800: "#1F2937",
    900: "#111827",
  },
} as const;

export const shadows = {
  xs: "0 1px 2px rgba(0, 0, 0, 0.05)",
  sm: "0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)",
  md: "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)",
  lg: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
} as const;

export const radius = {
  sm: "4px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "9999px",
} as const;

// Sign-in / sign-up brand backdrop, reused across the auth screens.
export const authGradient = "linear-gradient(135deg, #122B52 0%, #1B3A6B 40%, #2B5298 100%)";

// ── Status / score → badge variant helpers ────────────────────
// Centralizes the loan-stage and risk-score color logic that used
// to be duplicated across StatusBadge / ScoreBadge.

export type BadgeVariant = "royal" | "green" | "amber" | "red" | "gray" | "blue" | "indigo" | "purple";

const STAGE_VARIANT: Record<string, BadgeVariant> = {
  application: "blue",
  processing: "indigo",
  underwriting: "purple",
  closing: "amber",
  post_close: "green",
  denied: "red",
  withdrawn: "gray",
};

const STAGE_LABEL: Record<string, string> = {
  application: "Application",
  processing: "Processing",
  underwriting: "Underwriting",
  closing: "Closing",
  post_close: "Post-Close",
  denied: "Denied",
  withdrawn: "Withdrawn",
};

export function stageVariant(stage: string): BadgeVariant {
  return STAGE_VARIANT[stage] ?? "gray";
}

export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage] ?? stage;
}

/** Risk / compliance score → badge variant (≥80 good, ≥50 watch, else risk). */
export function scoreVariant(score: number): BadgeVariant {
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
}
