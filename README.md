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

### Programs (protected)
- `GET /api/v1/programs` — List compliance programs with summary
- `POST /api/v1/programs` — Create program
- `PUT /api/v1/programs/:id` — Update program status
- `POST /api/v1/programs/:id/upload` — Upload program document

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
