---
name: Security issue
about: Report a security concern (non-sensitive). For sensitive reports, contact the maintainer privately.
title: "[Security] "
labels: security
assignees: ''
---

> ⚠️ **Do not include exploit details, real credentials, tokens, or live
> connection strings in this issue.** For a sensitive vulnerability, contact the
> maintainer privately instead of filing a public issue.

## Summary

<!-- High-level description of the concern. -->

## Category

- [ ] AuthN / AuthZ (capabilities, RBAC, JWT)
- [ ] Secret handling / exposure
- [ ] Dependency vulnerability
- [ ] Data exposure (PII, loan data)
- [ ] PBKDF2 / password hashing
- [ ] Injection (SQL, CSV formula, XSS)
- [ ] Other

## Affected Area

- Area: [ ] API  [ ] Web  [ ] Shared  [ ] Database  [ ] Deployment
- Environment: [ ] Local  [ ] Preview  [ ] Production

## Impact

## Suggested Mitigation

## Checklist

- [ ] No secrets or credentials included in this report
- [ ] PBKDF2 iterations remain <= 100000 (workerd limit)
