## Summary

<!-- What does this PR change and why? -->

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Database / schema change
- [ ] Compliance rule update
- [ ] CI/CD / infrastructure
- [ ] Documentation

## Validation

- [ ] `pnpm install` succeeds
- [ ] `pnpm db:validate` passes (schema drift / idempotency / capabilities)
- [ ] API typecheck + tests pass (`cd apps/api && npx tsc --noEmit && npx vitest run`)
- [ ] Web typecheck + tests pass (`cd apps/web && npx tsc --noEmit && npx vitest run`)
- [ ] Shared tests pass (`cd packages/shared && npx vitest run`)
- [ ] Web production build passes (`cd apps/web && pnpm run build`)

## Database / Schema

- [ ] No schema change
- [ ] `scripts/db-setup.sql` updated and is **idempotent** (safe to re-run)
- [ ] Drizzle schema and `db-setup.sql` are in sync (`pnpm db:validate`)
- [ ] New tables/columns/indexes use `IF NOT EXISTS`

## Capabilities / RBAC

- [ ] No capability change
- [ ] New capabilities added to `CAPABILITIES` and granted in `ROLE_CAPABILITIES`
- [ ] Routes protected with `requireCapability(...)`

## Audit / Outbox

- [ ] No audit/outbox change
- [ ] Audit events emitted for state changes (best-effort, never fatal)
- [ ] Outbox events written for cross-system side effects (idempotency key set)

## Compliance Impact

- [ ] None
- [ ] Affects rules, required documents, reporting deadlines, or obligations
- [ ] Reviewed for examiner / regulatory accuracy

## Cloudflare / Deployment

- [ ] No deployment impact
- [ ] New bindings/secrets documented in `docs/deployment.md`
- [ ] `wrangler.toml` bindings match code expectations

## PBKDF2 Guardrail

- [ ] `PBKDF2_ITERATIONS` is **<= 100000** (workerd limit — never set to 600000)

## Screenshots

<!-- UI changes: before / after -->

## Rollback Plan

<!-- How do we revert if this breaks production? -->
