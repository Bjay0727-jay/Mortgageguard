# Schema Drift Validation (Prompt 19)

A deterministic, repo-only validator that fails CI/local checks when the Drizzle
schema, `scripts/db-setup.sql`, seed/catalog definitions, capability catalog, or
the PBKDF2 guardrail drift apart. It requires **no live database** and **no
Cloudflare credentials**.

## Why it exists

MortgageGuard has had real drift — application code (and the Drizzle schema)
referenced tables/columns that `scripts/db-setup.sql` never created, so a fresh
production database would be missing them. (This validator's first run caught
exactly that: the runtime + Drizzle use `loan_documents`, but `db-setup.sql`
only created a legacy `documents` table.) As the app added schema-heavy features
(programs, sources, evidence, loans, tasks, notes, reporting, evidence packets,
the event outbox), the risk of silent drift grew. This check makes drift a
build failure instead of a production incident.

## How to run

```bash
pnpm db:validate            # fail (exit 1) on hard issues
pnpm db:validate -- --strict  # also fail on warnings
pnpm db:validate -- --json    # machine-readable { ok, errors, warnings }
```

It also runs in CI (`.github/workflows/ci.yml`, "Validate schema drift" step).

## What it checks

| Check | Severity | Source of truth |
|-------|----------|-----------------|
| Every Drizzle table exists in `db-setup.sql` | error | `apps/api/src/db/schema/index.ts` |
| Every Drizzle column exists in `db-setup.sql` | error | parsed Drizzle vs parsed SQL |
| Required indexes / unique constraints present | error | curated regex list vs SQL text |
| SQL is idempotent (`IF NOT EXISTS`, guarded `INSERT`) | error | line/statement scan |
| Capabilities referenced in routes/UI exist in catalog | error | `requireCapability`/`can`/`capability:` refs |
| Capabilities in catalog but never referenced | warning | — |
| Required seed/catalog keys present (programs, sources, obligations, packet keys, outbox statuses) | error | catalog files |
| Texas conditional-rule coverage tokens | warning | `loan-conditional-docs.ts` |
| `PBKDF2_ITERATIONS <= 100000` | error | `apps/api/src/lib/*.ts` |

The **Drizzle schema is the source of truth**; `db-setup.sql` must be a
superset of it. The validator parses both rather than relying on hardcoded
column lists, so it stays correct as the schema evolves.

## Fixing common failures

- **Missing table in db-setup.sql** — add `CREATE TABLE IF NOT EXISTS <name> (...)`
  to `scripts/db-setup.sql` matching the Drizzle definition.
- **Missing column in db-setup.sql** — add `ALTER TABLE <table> ADD COLUMN IF NOT EXISTS <col> <type>;`
  (idempotent) near that table.
- **Missing index/unique constraint** — add the `CREATE [UNIQUE] INDEX IF NOT EXISTS ...`
  / `UNIQUE(...)` to `db-setup.sql`. (Required patterns are listed in
  `apps/api/src/schema-validation/index.ts → REQUIRED_INDEX_PATTERNS`.)
- **Non-idempotent SQL** — wrap with `IF NOT EXISTS`; guard seeds with
  `ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`.
- **Missing capability** — add it to `CAPABILITIES` in `packages/shared/src/index.ts`
  and grant it in `ROLE_CAPABILITIES`.
- **Missing seed/catalog key** — add the key to its catalog file (the validator
  prints which catalog + key).
- **PBKDF2 too high** — keep `PBKDF2_ITERATIONS <= 100000` (workerd caps PBKDF2;
  600000 throws at runtime). Do **not** raise it.

## Adding a new capability safely

1. Add the string to `CAPABILITIES` (catalog) in `packages/shared/src/index.ts`.
2. Grant it in `ROLE_CAPABILITIES` (or rely on `company_admin: ALL_CAPABILITIES`).
3. Reference it via `requireCapability("...")` in a route and/or `can("...")` in the UI.
   If a route/UI references a capability that isn't in the catalog, validation fails.

## Adding new seeded catalog keys safely

Add the key to its catalog file and to the `REQUIRED_SEEDS` list in
`apps/api/src/schema-validation/index.ts` so future removals are caught.

## How the PBKDF2 guardrail works

The validator scans `apps/api/src/lib/*.ts` for `PBKDF2_ITERATIONS = <n>`. If any
value exceeds **100000**, it fails with:

```
PBKDF2_ITERATIONS=<n> exceeds Cloudflare Workers workerd limit. Must be <= 100000.
```

## Known limitations & future work

- **Static only.** It parses SQL/TS text; it does not execute SQL. Idempotency is
  checked by pattern, not by running `db-setup.sql` twice.
- **Substring seed matching.** Seed keys are matched as substrings, so a prefix
  key (`aml_program`) is satisfied by a longer key containing it.
- **Future dynamic validation.** When a disposable test database is available, a
  follow-up can run `db-setup.sql` twice against it and diff `information_schema`
  against the Drizzle schema for exact column types. The static check is the MVP.

## Where the code lives

- Pure modules + tests: `apps/api/src/schema-validation/` (covered by the API
  `vitest` + `tsc` jobs).
- CLI entry: `scripts/validate-schema-drift.ts` (run via `pnpm db:validate`).
