---
name: Schema / migration issue
about: Report schema drift, migration failures, or db-setup.sql problems
title: "[Schema] "
labels: database, schema
assignees: ''
---

## What happened?

<!-- e.g. `pnpm db:validate` failed, migration errored, or runtime hit a missing column. -->

## Affected Objects

- Table(s):
- Column(s) / index(es):

## `pnpm db:validate` Output

```
<!-- Paste the validator output. Do NOT paste real connection strings. -->
```

## Source of Truth Mismatch

- [ ] Drizzle schema (`apps/api/src/db/schema/index.ts`) has it, `db-setup.sql` does not
- [ ] `db-setup.sql` has it, Drizzle does not
- [ ] Runtime query references an object missing from both
- [ ] Idempotency violation (missing `IF NOT EXISTS`)
- [ ] Capability definition / grant missing

## Proposed Fix

<!-- Idempotent SQL and/or Drizzle change. -->

## Verification

- [ ] `pnpm db:validate` passes after fix
- [ ] `scripts/db-setup.sql` re-runs cleanly (idempotent)
