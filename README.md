# MortgageGuard — Multi-State Mortgage Compliance CRM

A compliance-first CRM for mortgage brokers, lenders, and servicers. Dynamically generates loan-level compliance checklists based on state + loan type + loan purpose, with real-time examination readiness scoring.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | Hono.js 4.6+ on Cloudflare Workers |
| Frontend | Next.js 15 via OpenNext on Workers |
| ORM | Drizzle ORM 0.36+ |
| Database | Neon PostgreSQL (us-east-2, Postgres 16) |
| Connection Pool | Cloudflare Hyperdrive |
| Object Storage | Cloudflare R2 |
| Cache | Cloudflare KV |
| Queues | Cloudflare Queues |
| Auth | JWT (jose) + KV sessions |
| Validation | Zod 3.23+ |

## API Routes

### Auth (public)
- `POST /api/v1/auth/login` — Login with email/password
- `POST /api/v1/auth/register` — Register new user
- `POST /api/v1/auth/refresh` — Refresh JWT token
- `POST /api/v1/auth/logout` — Invalidate session

### Loans (protected)
- `GET /api/v1/loans` — List loans (filterable by status, state, search)
- `POST /api/v1/loans` — Create loan (triggers compliance checklist generation)
- `GET /api/v1/loans/:id` — Loan detail
- `GET /api/v1/loans/:id/checklist` — Compliance checklist with upload status
- `GET /api/v1/loans/:id/score` — Compliance score breakdown
- `POST /api/v1/loans/:id/advance` — Advance pipeline stage (enforces compliance gates)
- `GET /api/v1/loans/:id/timeline` — Audit trail events

### Documents (protected)
- `POST /api/v1/documents/upload/:loanId` — Upload document to R2
- `GET /api/v1/documents/:loanId` — List loan documents
- `GET /api/v1/documents/:loanId/:docId/download` — Download from R2
- `DELETE /api/v1/documents/:loanId/:docId` — Delete document

### Compliance (protected)
- `GET /api/v1/compliance/rules/:state` — List state rules
- `GET /api/v1/compliance/dashboard` — Exam readiness dashboard
- `POST /api/v1/compliance/recalculate/:loanId` — Force score recalculation
- `GET /api/v1/compliance/tx-documents` — TX-SML document library
- `GET /api/v1/compliance/tx-documents/:loanId` — Required docs for specific loan

### Programs (protected) — source-backed compliance control center
- `GET /api/v1/programs` — List programs with computed integrity status, evidence + regulatory basis, and a summary
- `POST /api/v1/programs/setup-required` — Seed the required source-backed programs + global catalog (idempotent)
- `POST /api/v1/programs/setup-recommended` — Seed optional recommended programs (idempotent)
- `POST /api/v1/programs` — Create an ad-hoc program
- `PUT /api/v1/programs/:id` — Update a program
- `GET /api/v1/programs/:id` — Program detail (overview, current document, evidence checklist, regulatory basis, history)
- `POST /api/v1/programs/:id/documents` (alias `/:id/upload`) — Upload a new program document version
- `POST /api/v1/programs/:id/evidence` — Attach / mark an evidence requirement (uploaded | accepted | not_applicable)
- `POST /api/v1/programs/:id/reviews` — Record a periodic program review
- `GET /api/v1/programs/:id/versions` · `/:id/download` · `/:id/versions/:versionId/download`

### Regulatory Source Registry (protected)
- `GET /api/v1/regulatory-sources` — List authoritative sources (eCFR / Federal Register / agency guidance) with verification status
- `GET /api/v1/regulatory-sources/:id` — Single source
- `POST /api/v1/regulatory-sources/:id/mark-verified` — Manually mark a source verified (sets `last_verified_at`, `verification_status=verified`, `next_verification_due_at` default +180d; emits `regulatory_source.verified`)

#### Company compliance programs (company-level controls)

Distinct from **loan-level** required documents (LE/CD, disclosures, appraisal — checked per loan), these are periodically-reviewed *company* controls:

| Program | Required by | Conditional |
|---------|-------------|-------------|
| AML Program | 31 CFR 1029.210 | — |
| Red Flags Program | 16 CFR 681.1 | — |
| Information Security Program | 16 CFR Part 314 | — |
| Loan Originator and Lender Compensation Agreements | 12 CFR 1026.36 & 1026.25(c)(2) | — |
| Remote Work Policy | State licensing / GLBA Safeguards | Only when `companies.allows_remote_work = true` |

Optional **recommended** programs: Ability-to-Repay Underwriting, Quality Control / Compliance Manual, Advertising / Social Media, E-Sign Act Procedures, Personnel / Employee Policies.

Each required program carries **evidence requirements** (e.g. AML: policy, senior-management approval, designated officer, training, independent testing, SAR escalation, recordkeeping) and **regulatory source links** (citation + eCFR + rulemaking + agency guidance URLs) for a click-through audit trail.

**Program status** (derived integrity): `missing` → `incomplete` → `current`, plus `review_due`, `overdue`, `source_review_due`, `not_applicable`, `archived`. A program is **current** only when its document is valid (status in `uploaded|current|approved`; `superseded|rejected|deleted|expired|failed|quarantined` never count), an owner + review dates are set, all required evidence is satisfied or N/A, a regulatory source is linked, and that source is not past its verification date. The dashboard “Upload required compliance program documents” step is complete only when integrity passes, and dashboard **Top actions** surface missing program docs/evidence, overdue reviews, **source verification due**, and an unknown remote-work setting. This document + evidence + verified-source packet also feeds the examiner evidence packet.

### Reports (protected)
- `GET /api/v1/reports/transaction-log?format=json|csv` — TX transaction log (all 17 fields)
- `GET /api/v1/reports/rmla/:quarter` — RMLA data for quarter
- `GET /api/v1/reports/deadlines` — Reporting deadlines
- `PUT /api/v1/reports/deadlines/:id` — Update deadline status

### Integrations (admin)
- `GET /api/v1/integrations/available` — Supported LOS systems
- `GET /api/v1/integrations/connected` — Company integrations
- `POST /api/v1/integrations/connect` — Connect LOS system
- `POST /api/v1/integrations/sync/:systemId` — Trigger sync
- `DELETE /api/v1/integrations/:systemId` — Disconnect
- `POST /api/v1/integrations/webhook/:systemId` — LOS webhook receiver

### Supported LOS Integrations
- **Encompass** (ICE Mortgage Technology) — Enterprise LOS
- **Calyx Point** (Calyx Technology) — Broker-focused LOS
- **LendingPad** — Cloud-native LOS
- **Byte Pro** (Byte Software) — Enterprise LOS with automation
- **Floify** — Borrower POS portal
- **Blend** (Blend Labs) — Digital lending POS
- **ARIVE** — Broker-first LOS + pricing engine
- **DocMagic** — TX disclosure generation + eSign
- **MeridianLink / CBC** — Tri-merge credit + AUS

## Database Schema
12 tables, 17 enums. See `apps/api/src/db/schema/index.ts`.

## Stage Gate Behavior
- Gate preview (`GET /loans/:id/gate/:targetStage`) and stage advancement
  (`POST /loans/:id/advance`) use the **same** readiness logic
  (`buildStageReadiness` in `apps/api/src/lib/stage-gate.ts`), so `canAdvance`
  can never disagree between the two.
- **Blockers** prevent advancement; **warnings** are informational only.
  `canAdvance` is true only when there are zero blockers and no unsatisfied
  required documents.
- Missing required documents block advancement.
- Only **current valid** documents satisfy a gate. Valid statuses are
  `uploaded`, `signed`, `delivered` (`GATE_SATISFYING_DOCUMENT_STATUSES`).
- Rejected / expired / superseded / deleted documents do **not** satisfy gates.
  On replacement, only the latest document per type (by `uploaded_at`) is
  considered, so stale rows never count.
- No configured mandatory requirements emits a warning but does **not** block
  advancement (empty/demo environments shouldn't hard-fail).
- Gate preview is capability-gated with `advanceLoanStage` (the same capability
  the advancement modal needs).
- An invalid stage transition is a blocker that is **not** overrideable. Only
  unsatisfied-document blockers can be overridden, and only with the
  `overrideCompliance` capability plus a reason; the override audit event
  records the blockers, warnings, unsatisfied documents, and reason.

## Deployment
See MortgageGuard_MVP_WebUI_Guide_v3.docx for step-by-step instructions using GitHub Web UI.

## Cost
~$5/month for the MVP beta period (Cloudflare Workers Paid + Neon free tier).

## Initial admin and invite-only onboarding

MortgageGuard seeds one bootstrap administrator for first-time setup only:

- Email: `admin@mortgageguard.com`
- Password: `MortgageGuard!2026`

The seeded administrator is created with `must_change_password = true`, so the app forces a password change before normal dashboard use. Change this password before entering production loan, document, or compliance data.

Public self-registration is disabled. New users join a company by invitation:

1. Sign in as a company admin.
2. Open **Users & Invites** from the Admin sidebar or user menu.
3. Create an invite by email and role.
4. Copy the MVP invite link returned by the app and share it with the user.
5. The invitee opens `/invite/:token`, sets their name/password, and receives the company and role from the invite only.

Invite tokens are generated with secure randomness. Only a SHA-256 token hash is stored in the database; raw tokens are shown once in the MVP invite link and are not recoverable from the database. Expired, revoked, or accepted invites cannot be reused.

## Setup status & onboarding

The dashboard onboarding panel and the dedicated **`/setup`** page are powered by real backend state via `GET /api/v1/setup/status` (capability `viewSetupStatus`, available to all company-scoped roles). The response includes `setupComplete`, `coreSetupComplete` (excludes the optional LOS integration), a `progress` object over the required steps, backend-generated `warnings`, and the per-step list with `complete`/`status`/`actionLabel`/`actionHref`/`details`.

### Password limit (Cloudflare)

Cloudflare Workers (workerd) hard-caps PBKDF2 at **100000 iterations**. `PBKDF2_ITERATIONS` must stay `<= 100000` (do **not** restore the OWASP 600000 value — it throws on this platform). A test asserts the cap.

### Required vs optional steps

| Step key | Required | Complete when |
|----------|----------|---------------|
| `change_default_admin_password` | yes | current user's `must_change_password = false` (protected routes redirect to `/change-password` until then) |
| `confirm_company_profile` | yes | name, NMLS ID, entity type, compliance contact name + email, ≥1 licensed state, and `allows_remote_work` explicitly set (true/false) |
| `load_texas_compliance_rules` | yes | active TX + federal `state_rules` and linked `required_documents` exist |
| `create_first_loan` | yes | company has ≥1 loan |
| `upload_required_compliance_program_documents` | yes | required programs exist, none missing/incomplete/overdue, Remote Work Policy current or `not_applicable` (Prompt 15A integrity) |
| `invite_team_members` | yes | >1 active user or ≥1 accepted invite (pending-only → warning) |
| `connect_los_integration` | **no** | an LOS integration is `connected`/`healthy` (optional) |

### Company settings & remote work

`GET/PATCH /api/v1/company/settings` (PATCH requires `manageCompanySettings`, emits `company.settings_updated`). The Company Settings page edits the profile fields above. **`allows_remote_work` must be confirmed explicitly** — it drives whether the Remote Work Policy program is required or marked `not_applicable` (Prompt 15A).

### Loading Texas rules

- `GET /api/v1/setup/rules-status?state=TX` returns counts + `loaded`/`blockers`.
- `POST /api/v1/setup/load-rules` (capability `loadComplianceRules`) idempotently loads/verifies the TX + federal rule set and required documents (NOT EXISTS guards — never duplicates), and emits `setup.rules_loaded`. The dashboard CTA is **Load Texas Rules** (or visit `/setup?step=rules`).

### Required programs & first loan

The "Upload required compliance program documents" step integrates with the Prompt 15A Programs API — use **Set up required programs** on `/programs` (or `/setup?step=programs`); the step never hard-codes complete and degrades gracefully if no program rows exist yet. Create the first loan at **`/loans/new`**, which generates the initial compliance checklist from the loaded rules and redirects to the loan detail.

### Connecting an LOS / inviting users

LOS integration is optional for MVP — connect one any time from `/integrations`. Invite teammates from `/users` (see invite-only onboarding above).

### Resetting demo/setup data

Re-running `scripts/db-setup.sql` is idempotent (all `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / guarded seeds), so it is safe to apply repeatedly. To reset demo state, truncate the company-scoped tables (loans, documents, compliance_programs, reporting_deadlines, user_invitations) for the demo company; the seeded admin and catalog rows can be re-seeded via the setup actions.
