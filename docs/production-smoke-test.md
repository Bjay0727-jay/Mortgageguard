# MortgageGuard — Production Smoke Test

Run this after every production deploy to `main` to confirm the release is
healthy. It exercises the critical paths that have broken before (load-rules
500s, schema drift, missing deploys from stacked branches).

> **No real production credentials live in this repo.** Provide them at runtime
> via environment variables. Never paste tokens, passwords, or connection
> strings into commits, issues, or CI logs.

---

## Automated checks

`scripts/smoke-production.ts` hits the read-only / safe endpoints and reports
pass/fail. It needs a base URL and (for authenticated checks) a JWT supplied at
runtime — nothing is hardcoded.

```bash
# Unauthenticated checks only (health):
API_BASE_URL=https://api.mortgageguard.example \
  npx tsx scripts/smoke-production.ts

# Include authenticated checks (setup/status, rules-status, dashboard):
API_BASE_URL=https://api.mortgageguard.example \
SMOKE_JWT="<paste-a-short-lived-admin-jwt>" \
  npx tsx scripts/smoke-production.ts
```

Endpoints exercised:

| Check | Endpoint | Auth |
|-------|----------|------|
| Health | `GET /health` | none |
| Readiness (DB) | `GET /ready` | none |
| Setup status | `GET /api/v1/setup/status` | admin JWT |
| Rules status (TX) | `GET /api/v1/setup/rules-status?state=TX` | admin JWT |
| Compliance dashboard | `GET /api/v1/compliance/dashboard` | admin JWT |

The script does **not** POST `load-rules` (it is a mutation); verify that
manually below.

---

## Manual smoke checklist (UI)

Perform these in the production web app after a deploy:

1. **Login as admin** — log in with the admin account; confirm no 500.
2. **Open `/setup`** — the setup page renders all steps and progress.
3. **Re-check status** — click *Re-check status*; status refreshes without error.
4. **Load Texas Rules** — click *Load Texas Rules*; confirm **no 500** from
   `POST /api/v1/setup/load-rules` and rules show as loaded.
5. **`/loans`** — the loans list renders; open a loan.
6. **Loan workspace tabs** — Overview, Documents, Transaction Log, Stage Gate,
   Notes all load.
7. **`/reports`** — reporting deadlines / exports render.
8. **`/evidence-packets`** — evidence packets page renders.
9. **`/admin/outbox`** — outbox admin page renders; events are visible.

If any step 500s, capture the failing endpoint, check `wrangler tail`
(requires Cloudflare access), and consult the rollback section of
`docs/deployment.md`.

---

## Logs

To watch live production logs during the smoke test (requires Cloudflare auth):

```bash
cd apps/api && npx wrangler tail
```

Never paste secret values from logs into issues or PRs — redact before sharing.
