# UI Component Library

Reusable, accessible building blocks for the MortgageGuard web app. Import
everything from the barrel:

```tsx
import { Button, Card, Modal, useToast } from "@/components/ui";
```

## Design tokens (`tokens.ts`)

TypeScript mirror of the CSS custom properties in `app/globals.css` — brand
colors (royal `#1B3A6B`, green `#0F7B46`, pales), `shadows`, `radius`, the
shared `authGradient`, and the status/score → badge-variant helpers
(`stageVariant`, `stageLabel`, `scoreVariant`). Prefer Tailwind utility classes
that reference the CSS vars (e.g. `text-[var(--royal)]`); reach for the TS
constants only when a value must live in JS.

## Components

| Component | Notes |
|-----------|-------|
| `Button` | variants `primary/secondary/success/danger/ghost`, `sm/md/lg`, `loading`, `iconOnly` (requires `aria-label`). Hover/focus via Tailwind only. |
| `Input` / `Textarea` / `Select` | label association, `hint`, `error` (sets `aria-invalid` + `aria-describedby`). Focus ring via CSS classes — no inline `onFocus`/`onBlur` mutation. |
| `Card` (+ `CardHeader/Title/Body/Footer`) | white surface, brand border + shadow. `flush` removes padding for tables. |
| `Badge` (+ `StatusBadge`, `ScoreBadge`) | token-driven variants; stage/score logic centralized. |
| `Table` | responsive — real `<table>` (md+, horizontal-scroll fallback) and stacked label/value cards on mobile. Optional keyboard-activatable rows. |
| `Modal` | `role="dialog"`, `aria-modal`, focus trap, Escape-to-close, focus restored to trigger, body scroll lock, optional backdrop close. |
| `Tabs` (+ `TabPanel`) | `role="tablist"`, roving tabindex, ←/→/Home/End navigation. |
| `EmptyState` / `Skeleton` + `LoadingSkeleton` | empty + loading states (`role="status"`). |
| `ToastProvider` + `useToast` | imperative `toast({ variant, title, description })`; live region, auto-dismiss, error toasts announce assertively. Mounted once in the root layout. |
| `PageHeader` / `MetricCard` | page title + actions; KPI tile (static or hover-elevating link). |

## Accessibility

- Global focus ring (`:focus-visible`) in `globals.css`; components add ring
  styling on fields/rows via Tailwind classes.
- Icon-only buttons require `aria-label`; modals/tabs/toasts ship correct roles
  and aria wiring.

## Verification

```bash
# from repo root
cd apps/web && npx tsc --noEmit      # types
cd apps/web && npx next build        # production build
cd apps/web && npx vitest run        # component + a11y tests (jsdom)
```

Component/a11y tests live in `src/components/ui/__tests__/`. They are excluded
from the Next/`tsc` type-check (see `tsconfig.json`) and run via vitest only.
