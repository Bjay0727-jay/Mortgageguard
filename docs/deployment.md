# MortgageGuard — Deployment Guide

This document is the deployment runbook for MortgageGuard. It covers the three
environments, the required Cloudflare bindings and secrets, the deploy commands,
database setup, and rollback procedures.

> **Security:** Never commit real credentials. All secrets live in Cloudflare
> Worker secrets and GitHub Actions secrets — never in the repo, never in logs.
> `PBKDF2_ITERATIONS` must stay **<= 100000** (the workerd hard cap).

---

## Environments

| Environment | API Worker | Web Worker | Database | Deploy trigger |
|-------------|-----------|-----------|----------|----------------|
| **local** | `wrangler dev` (`mortgageguard-api`) | `next dev` (`mortgageguard-web`) | Local `.env.local` → Neon dev branch | Manual, on your machine |
| **preview** | `mortgageguard-api` (versioned upload) | `mortgageguard-web` (versioned upload) | Neon (preview/dev branch) | `.github/workflows/deploy-preview.yml` (manual `workflow_dispatch`) |
| **production** | `mortgageguard-api` | `mortgageguard-web` | Neon (prod) via Hyperdrive | `.github/workflows/ci.yml` on push to `main` |

Production deploys happen **only** on push to `main` after the `test` job passes.
The preview workflow never promotes to production traffic; it uses
`wrangler versions upload` so you get a preview URL without shifting traffic.

---

## Required Cloudflare Bindings

These are the **actual** binding names from `apps/api/wrangler.toml` and
`apps/web/wrangler.toml`. The API depends on all of the API bindings being
present at runtime.

### API Worker — `mortgageguard-api`

| Binding | Type | Resource name | Purpose |
|---------|------|---------------|---------|
| `HYPERDRIVE` | Hyperdrive | `mortgageguard-db` (config id in `wrangler.toml`) | Pooled Postgres connection to Neon |
| `DOCUMENTS` | R2 bucket | `mortgageguard-documents` | Loan / compliance document storage |
| `EXPORTS` | R2 bucket | `mortgageguard-exports` | Generated exports + evidence packets |
| `RULE_CACHE` | KV namespace | (id in `wrangler.toml`) | Cached compliance rules |
| `SESSIONS` | KV namespace | (id in `wrangler.toml`) | Session data |
| `COMPLIANCE_QUEUE` | Queue producer | `compliance-events` | Async compliance processing |
| `AUDIT_QUEUE` | Queue producer | `audit-events` | Async audit log writes |

Queue **consumers** for `compliance-events` (`max_batch_size=10`) and
`audit-events` (`max_batch_size=25`) are also defined in `apps/api/wrangler.toml`.

### Web Worker — `mortgageguard-web`

| Binding | Type | Resource | Purpose |
|---------|------|----------|---------|
| `ASSETS` | Assets | `.open-next/assets` | Static assets (OpenNext) |
| `WORKER_SELF_REFERENCE` | Service binding | `mortgageguard-web` | OpenNext ISR / revalidation |

---

## Required Secrets & Environment Variables

### API Worker secrets (set via `wrangler secret put`)

| Name | Required | Notes |
|------|----------|-------|
| `JWT_SECRET` | **Yes** | HS256 signing key. A missing/empty value makes workerd 500 every auth request — the deploy job fails loudly if unset. |
| `RESEND_API_KEY` | Optional | Email (Resend). Only set if email is enabled. |

### API `[vars]` (non-secret, in `wrangler.toml`)

| Name | Value | Notes |
|------|-------|-------|
| `ENVIRONMENT` | `production` / `staging` / `development` | Controls CORS allow-list (localhost only allowed off-prod) |
| `APP_NAME` | `MortgageGuard` | Display name |

### GitHub Actions secrets / variables (for CI deploy)

| Name | Kind | Used for |
|------|------|----------|
| `CLOUDFLARE_API_TOKEN` | secret | Wrangler auth. **If unset, deploy jobs skip** (build/test still run). |
| `CLOUDFLARE_ACCOUNT_ID` | variable (`vars`) | Cloudflare account |
| `JWT_SECRET` | secret | Pushed to the Worker on deploy |
| `RESEND_API_KEY` | secret | Pushed to the Worker on deploy (optional) |
| `DATABASE_URL` | secret | Used by the `migrate` job + Hyperdrive create |
| `API_URL` | variable (`vars`) | `NEXT_PUBLIC_API_URL` for the web build/deploy |

### Web build env

| Name | Notes |
|------|-------|
| `NEXT_PUBLIC_API_URL` | Base URL of the API Worker. Defaults to `http://localhost:8787` in code if unset. |

> **CORS:** The API allow-list lives in `apps/api/src/index.ts`
> (`https://mortgageguard.com`, `https://app.mortgageguard.com`,
> `https://mortgageguard-web.stanley-riley.workers.dev`; `http://localhost:3000`
> off-production). If the web origin changes, update that list.

---

## Deploy Commands

### Local

```bash
pnpm install
# API (Cloudflare Workers, port 8787)
cd apps/api && npx wrangler dev
# Web (Next.js, port 3000)
cd apps/web && pnpm dev
```

### Preview (manual)

Trigger `.github/workflows/deploy-preview.yml` via **Actions → Deploy Preview
(manual) → Run workflow**. Leave `deploy=false` for a build-only validation, or
set `deploy=true` (with `CLOUDFLARE_API_TOKEN` configured) to upload a preview
version. Equivalent local command:

```bash
cd apps/web && npx opennextjs-cloudflare build && npx wrangler versions upload
```

### Production (automatic on `main`)

Pushing to `main` runs `ci.yml`:

1. `test` — install, typecheck, API/web/shared tests, schema-drift validation,
   PBKDF2 guardrail, web production build.
2. `migrate` — runs `scripts/db-setup.sql` against `DATABASE_URL` (if set).
3. `deploy-api` — ensures queues/buckets/Hyperdrive exist, sets Worker secrets,
   `wrangler deploy`.
4. `deploy-web` — `opennextjs-cloudflare build && deploy`.

Manual production deploy (only if deploying outside CI):

```bash
# API
cd apps/api
printf '%s' "$JWT_SECRET" | npx wrangler secret put JWT_SECRET
npx wrangler deploy
# Web
cd ../web && pnpm run deploy
```

---

## Database Setup

The deployed schema lives in `scripts/db-setup.sql`. It is **idempotent** — every
`CREATE TABLE` / index / column uses `IF NOT EXISTS`, so it is safe to re-run.

### First-time / idempotent run

```bash
psql "$DATABASE_URL" -f scripts/db-setup.sql
```

The CI `migrate` job runs exactly this command on push to `main`.

### Drift detection & recovery

`pnpm db:validate` compares the Drizzle schema (source of truth) against
`scripts/db-setup.sql` and checks tables, columns, indexes, idempotency,
capability definitions/grants, seeds, and the PBKDF2 cap. CI fails on drift.

```bash
pnpm db:validate            # human-readable report
pnpm db:validate -- --strict --json   # CI / machine-readable
```

If validation reports drift:

1. Decide the source of truth (almost always the Drizzle schema / runtime query).
2. Add the missing object to `scripts/db-setup.sql` **idempotently**
   (`CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` /
   `CREATE INDEX IF NOT EXISTS`).
3. Re-run `pnpm db:validate` until clean.
4. Apply to the database: `psql "$DATABASE_URL" -f scripts/db-setup.sql`.

See `docs/schema-drift-validation.md` for the full validator reference.

---

## Rollback Procedures

### Worker rollback (API or Web)

Cloudflare keeps prior Worker versions. To roll back:

```bash
cd apps/api   # or apps/web
npx wrangler deployments list
npx wrangler rollback [--version-id <id>]
```

Or re-run the deploy from a previously-good commit (revert the offending commit
on `main` and let CI redeploy):

```bash
git revert <bad-commit-sha>
git push origin main   # CI redeploys the reverted state
```

### Database rollback

`db-setup.sql` is additive and idempotent — it does not drop data. For a bad
data/seed change, restore from a Neon branch/point-in-time snapshot rather than
hand-editing production. Never run destructive SQL against production without a
verified backup.

### Secret rotation

```bash
cd apps/api
printf '%s' "$NEW_JWT_SECRET" | npx wrangler secret put JWT_SECRET
```

Rotating `JWT_SECRET` invalidates existing sessions (users must re-authenticate).

---

## Verifying a Production Deploy

After a deploy to `main`, confirm the run actually shipped from `main`
(see `docs/stacked-prs.md`) and run the smoke test in
`docs/production-smoke-test.md`.
