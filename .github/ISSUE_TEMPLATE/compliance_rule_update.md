---
name: Compliance rule update
about: Request a change to compliance rules, required documents, or reporting obligations
title: "[Compliance] "
labels: compliance
assignees: ''
---

## Jurisdiction

- State / scope: <!-- e.g. TX, FED -->
- Regulator / program: <!-- e.g. SML RMLA, SSSF, Financial Condition -->

## Regulatory Source

<!-- Citation, statute/rule number, and link to the authoritative source. -->

## Change Requested

- [ ] New / updated state rule (`state_rules`)
- [ ] New / updated required document (`required_documents`)
- [ ] New / updated reporting deadline (`reporting_deadlines`)
- [ ] New / updated reporting obligation (`reporting_obligations`)
- [ ] New / updated regulatory source (`regulatory_sources`)
- [ ] New / updated compliance program (`compliance_programs`)

## Details

<!-- Describe the rule/document/obligation: name, category, due rule, weight, effective date. -->

## Effective Date

## Impact

- [ ] Affects existing loans / checklists
- [ ] Affects scoring
- [ ] Affects reporting deadlines
- [ ] Requires data backfill / migration

## Verification

- [ ] `pnpm db:validate` updated/passes after change
- [ ] Texas rules catalog (`apps/api/src/lib/texas-rules.ts`) updated if applicable
