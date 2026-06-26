# Responsive / mobile behavior

How the MortgageGuard web app adapts across breakpoints. Tailwind breakpoints
used: `sm` 640px, `md` 768px, `lg` 1024px.

## Breakpoint matrix

| Area | 375px (phone) | 768px (tablet) | 1024px+ (desktop) |
|------|---------------|----------------|-------------------|
| **Sidebar** | Off-canvas drawer; opened by the header hamburger, dimmed backdrop, slides in from left. Closes on backdrop tap, the in-drawer ✕, any nav tap, or route change. | Same drawer behavior (still `< lg`). | Static fixed 230px column, always visible; no hamburger. |
| **Top header** | Hamburger + truncated page title on the left; notifications + user avatar on the right. State filter & search hidden. Subtitle hidden. | Hamburger still shown; state filter appears (`md`); search still hidden. | No hamburger; state filter + search visible; user name/role label shown (`sm`). |
| **Loans / Programs / Reports tables** | Each row collapses to a stacked label/value **card** (`<ul><li>`); secondary columns (`hideOnMobile`) drop off. | Real `<table>` with horizontal-scroll fallback. | Real `<table>`. |
| **TX transaction log** | Horizontal scroll (8-column export grid — scroll is the accessible fallback). | Horizontal scroll. | Full table. |
| **Loan detail** | Sticky bottom action bar: **Upload Doc**, **Advance Stage**, **More** (sheet → Details / Checklist / Timeline / back to Loans). Header "Advance" button hidden to avoid duplication. Tabs scroll horizontally. | Bottom bar still shown (`< lg`). | Bottom bar hidden; header "Advance" button shown. |
| **Modals** (new loan, filing, gate review, upload, program edit, setup wizard, confirm) | Full-width **bottom sheet**, rounded top, max-height 92vh; header pinned, body scrolls, footer actions pinned (with safe-area padding). | Centered dialog (`sm`+). | Centered dialog. |
| **Integrations cards** | Connected cards stack header/actions vertically; available systems 1 column. | 2 columns. | 3 columns. |
| **Empty / loading / error** | `EmptyState` (centered, `role=status` skeletons) and token-colored error banners reflow fluidly at all widths. | — | — |

## Accessibility & touch

- Primary buttons (`Button` size `md`/`lg`) are ≥44px tall; header
  notification/hamburger controls are 44×44; sidebar nav rows are ≥44px.
- Drawer backdrop is `aria-hidden`; nav has `aria-label="Primary"` and the
  active link uses `aria-current="page"`.
- Tables keep `<table>` + `<caption>` + `scope="col"` headers on desktop;
  clickable rows are keyboard-activatable (Enter/Space).
- Modals retain `role="dialog"`, `aria-modal`, focus trap, and Escape-to-close
  in both the bottom-sheet and centered presentations.
- No horizontal page overflow: wide grids scroll inside their own container,
  not the viewport.

## Verification

```bash
cd apps/web && npx tsc --noEmit      # types
cd apps/web && npx next build        # production build
cd apps/web && npx vitest run        # 28 component/a11y tests (jsdom)
```

> Live screenshots require a running app + API/DB, which isn't available in the
> CI/sandbox here; the matrix above documents the per-breakpoint behavior. To
> capture screenshots locally, run `pnpm --filter web dev` against a seeded API
> and resize to 375 / 768 / 1024.
