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
- `POST /api/v1/reports/setup-deadlines` — Idempotently provision RMLA/SSSF/Financial Condition deadlines (cap `setupReportingDeadlines`)
- `GET /api/v1/reports/deadlines` — Reporting deadlines + derived status summary
- `GET /api/v1/reports/transaction-log?jurisdiction=TX&from=&to=&format=json|csv` — TX transaction log (23 fields, cap `viewReports`; CSV requires `exportReports`)
- `POST /api/v1/reports/deadlines/:id/file` — Record a filing event (JSON; cap `fileReports`)
- `POST /api/v1/reports/deadlines/:id/receipt` — Upload a filing receipt (cap `uploadReportReceipts`)
- `GET /api/v1/reports/deadlines/:id/evidence` — Download a filing receipt
- `PUT /api/v1/reports/deadlines/:id` — Update deadline status
- `GET /api/v1/reports/rmla/:quarter` — RMLA aggregate data for quarter

See [Reports, filing evidence & transaction logs](#reports-filing-evidence--transaction-logs-prompt-13).

### Evidence Packets (protected)
- `GET /api/v1/evidence-packets` — Packet history (cap `viewEvidencePackets`)
- `GET /api/v1/evidence-packets/:id` — Packet metadata
- `POST /api/v1/evidence-packets/loan/:loanId` — Generate a loan evidence packet (cap `generateEvidencePackets`)
- `POST /api/v1/evidence-packets/programs` — Generate a program evidence packet
- `POST /api/v1/evidence-packets/reporting` — Generate a reporting evidence packet
- `POST /api/v1/evidence-packets/examination` — Generate a full examination readiness packet
- `GET /api/v1/evidence-packets/:id/download?format=json|html` — Download (cap `downloadEvidencePackets`)
- `DELETE /api/v1/evidence-packets/:id` — Soft-delete (cap `deleteEvidencePackets`)

See [Examiner evidence packets](#examiner-evidence-packets-prompt-14).

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

## Loan creation & processing (Prompt 21)

MortgageGuard is a working loan-processing platform, not just a dashboard. Loans are the central transaction record; data-driven rules generate the checklist; documents satisfy checklist items; stage gates prevent advancement until required items are present.

### Creating a loan

`POST /api/v1/loans` (capability `createLoan`) captures borrower/applicant, property, loan details (purpose/product/type/lien/occupancy/term + Texas cash-out type), originator/lender, and processor/compliance owners. `GET /api/v1/loans/new/context` returns the wizard's licensed states, company entity type, available enums, assignable users, and per-state rule-load status + warnings. On create the loan records the transaction-log entry timestamp + 7-day due date, queues checklist generation, and emits `loan.created`.

### Transaction log

`lib/transaction-log-integrity.ts` `deriveTransactionLogCompleteness(loan)` reports `{ complete, missingFields, warnings, status, dueAt }`. The 17 TX-SML fields are captured at creation; a current entry is expected within 7 days of application. `transaction_log_status` is `complete | missing_fields | overdue`.

### Dynamic + conditional checklist

`GET /api/v1/loans/:id/checklist` merges rules-derived documents (from `state_rules`/`required_documents`, filtered by state + loan attributes) with a tested conditional catalog (`lib/loan-conditional-docs.ts`) that encodes combinations the single-value filters can't express. Texas matrix (documented + tested):

| Condition | Adds |
|-----------|------|
| Every TX loan | Notice of Penalties; Mortgage Company **or** Banker Disclosure (by entity type) |
| `texasCashoutType = tx_50a6` (or purpose `home_equity_50a6`) | Home Equity Disclosure, FMV Acknowledgement, Discount Point Acknowledgement |
| `texasCashoutType = tx_50f2` | Refinance of Home Equity Notice 50(f)(2) |
| Reverse (`loanProduct=reverse`/reverse purpose) | ECOA Appraisal Notice, Servicing Disclosure, TALC, Certificate of Counseling, TX Reverse Mortgage Disclosure |
| Wrap (`wrap_mortgage` or `lienPosition=wrap`) | Wrap Mortgage Disclosure, Tex. Prop. Code §5.016 Notice |
| `loanType=arm` | ARM Program Disclosure |

If rules aren't loaded for the state, the loan is still created but a warning + auto-task surface (no silent empty-but-compliant checklist).

### Updating a loan

`PATCH /api/v1/loans/:id` (capability `updateLoan`). Changing a rule-affecting field (state, purpose, cash-out type, product, type, lien, occupancy) re-resolves rules: newly required `compliance_checks` are inserted, no-longer-applicable checks become `na` (uploaded documents are preserved), the score is recalculated, and `loan.rules_resolved` + `loan.updated` + a `checklist_changed` timeline event are emitted.

### Tasks / work queue

`loan_tasks` with `GET/POST /api/v1/loans/:id/tasks` and `PATCH /api/v1/loans/:id/tasks/:taskId` (`assignLoanTasks`/`manageLoanTasks`). Tasks auto-generate idempotently (unique `loan_id, auto_key`) for missing required documents, unloaded state rules, and transaction-log gaps, and auto-complete when resolved.

### Loan integrity

`lib/loan-integrity.ts` `deriveLoanIntegrity(...)` rolls checklist + tasks + transaction-log + rule-load + score into `{ status: clean|needs_attention|blocked|critical, blockers, warnings, nextActions }`, surfaced at `GET /api/v1/loans/:id/integrity`. Document statuses that satisfy gates: `uploaded|signed|delivered`; invalid: `rejected|expired|deleted|superseded|failed|quarantined`.

### Stage gates & audit

Pipeline stages and the gate-readiness model are unchanged (`GET /:id/gate/:targetStage`, `POST /:id/advance` with authorized override). Append-only timeline + audit events: `loan.created/updated/rules_resolved/checklist_changed/task_created/task_updated/task_completed/document_uploaded/stage_advanced/stage_override`.

### All-state architecture

Rules are data-driven (`state_rules` + `required_documents`, effective-dated). Texas is implemented first; other states are added by seeding rows (no code change). MVP conditional rules live in a tested backend catalog/helper, never in UI components.

> Phase note: this PR is the **backend foundation** (model, APIs, helpers, tasks, conditional rules, tests). The multi-step creation wizard + processing-workspace UI land in a follow-up.

## Reports, filing evidence & transaction logs (Prompt 13)

Turns operational loan/program data into compliance reports, filing evidence, and examiner-ready exports. Texas-first, but the deadline model is jurisdiction-parameterized for future multi-state reporting.

### Reporting deadlines

`POST /api/v1/reports/setup-deadlines` (`{ jurisdiction: "TX", year? }`) idempotently provisions a company's deadlines for a calendar year. `lib/reporting-deadlines.ts` is a pure, tested helper:

- **RMLA / SSSF** — quarterly Mortgage Call Reports, due 45 days after each quarter end: **Q1 → May 15, Q2 → Aug 14, Q3 → Nov 14, Q4 → Feb 14** of the following year.
- **Financial Condition** — cadence by company **entity type**: quarterly for `lender` / `servicer` / `broker_lender` (same schedule as RMLA), annual for `broker` (due Mar 31, within 90 days of calendar year end).
- `deriveDeadlineStatus` / `deriveReportingSummary` derive live `upcoming | due_soon (≤30d) | due | overdue | filed | not_applicable` status without mutating stored rows.

`GET /api/v1/reports/deadlines` returns `{ summary, deadlines }` (each row decorated with `derived_status`); supports `status`, `jurisdiction`, `quarter`, `from`/`to`, and `dueSoon` filters.

### Texas transaction-log export

`GET /api/v1/reports/transaction-log?jurisdiction=TX&from=&to=&format=json|csv` exports the 23 TX-SML transaction-log fields (loan #, applicant, application date, property address/city/state/ZIP, rate, purpose, **Texas 50(a)(6)/50(f)(2) cash-out classification**, product, type, term, lien, occupancy, status, closing date, originator name/NMLS, lender/NMLS, plus **completeness status** and **missing-field list** per loan via `deriveTransactionLogCompleteness`).

- **JSON** returns `{ reportKey, jurisdiction, periodStart, periodEnd, rowCount, warningCount, rulesLoaded, rows, warnings }`.
- **CSV** is RFC-4180 escaped, **formula-injection-safe** (cells starting with `= + - @` are prefixed with `'`), **UTF-8 BOM**-prefixed for Excel, and named `mortgageguard-tx-transaction-log-<from>-to-<to>.csv`. Each export is recorded in `report_exports`.

### Filing evidence

- `POST /api/v1/reports/deadlines/:id/file` (JSON `{ filedAt?, confirmationNumber?, notes? }`) records an immutable `report_filing_events` row and marks the deadline `filed` (audit `report.filed`).
- `POST /api/v1/reports/deadlines/:id/receipt` uploads a receipt through the existing document hardening (magic-byte MIME sniff, size cap, sanitized key) into the company-scoped `EXPORTS` bucket and links it (audit `report.receipt_uploaded`).
- `GET /api/v1/reports/deadlines/:id/evidence` downloads the receipt.

### Dashboard & UI

`GET /api/v1/compliance/dashboard` now also returns `reportOps { overdueDeadlines, dueSoonDeadlines, missingReceipts, transactionLogGaps }`, surfaced as top actions (file overdue/upcoming reports, upload receipts, fix tx-log gaps). The **Reports** page adds summary cards, a "Set up reporting deadlines" action, a jurisdiction/period transaction-log export panel with warnings preview, and filing + receipt-upload modals.

### Schema & capabilities

New tables (`scripts/db-setup.sql`, idempotent): `reporting_obligations`, `report_exports`, `report_filing_events`; `reporting_deadlines` gains `obligation_key`, `jurisdiction`, `period_start`, `period_end`, `receipt_document_id`. Capabilities: `setupReportingDeadlines`, `fileReports`, `uploadReportReceipts`, `viewReportAudit` (admin/qualifying-individual/compliance-officer get all; originators/processors/read-only get `viewReports`). Audit events: `reports.deadlines_setup`, `report.transaction_log_exported`, `report.filed`, `report.receipt_uploaded`.

> Not an official NMLS submission: trackers record filing **evidence** (confirmation numbers + receipts), not NMLS-format submissions.

## Audit reliability — event outbox (Prompt 18)

Critical compliance events are **durable**. Instead of relying only on a best-effort queue/audit write, a domain action records a row in `event_outbox` (transactional-outbox pattern), which a processor later delivers with retry, backoff, and dead-lettering — so an audit/queue hiccup can't silently lose compliance evidence.

### Lifecycle & statuses
`pending → processing → processed`, or on delivery failure `failed` (rescheduled) and finally `dead_letter` after `max_attempts` (default 5). Backoff via `deriveNextAttemptAt`: attempt 1 → +1m, 2 → +5m, 3 → +15m, 4 → +1h, 5 → dead-letter. All pure and unit-tested (pass `now`).

### Helpers
`lib/outbox.ts` — `createOutboxEvent` (idempotent on `idempotency_key`), `tryCreateOutboxEvent` (never throws into the caller), `claimOutboxEvents` (`FOR UPDATE SKIP LOCKED`), `markOutboxProcessed|Failed|DeadLetter`, `deriveNextAttemptAt`, `buildOutboxIdempotencyKey`, `redactPayload`. `lib/outbox-processor.ts` — `processPendingOutboxEvents(sql, handlers, opts)` returns `{ claimed, processed, failed, deadLettered, skipped }`. `lib/outbox-handlers.ts` — `audit` / `queue` / `notification` / `webhook` / `noop` dispatch (MVP delivers everything to the audit queue; notification/webhook are placeholders for later prompts).

### Idempotency & redaction
Each event carries a deterministic idempotency key (e.g. `loan:{id}:loan.created`, `report:{deadlineId}:filed:{confirmation}`, `packet:{id}:generated`) so a retried domain action never duplicates a row. Payloads are normalized to JSON and **redacted** on write and again in the API/UI — any key containing `password / token / secret / apiKey / clientSecret / authorization / credential` becomes `[REDACTED]`. Never store raw secrets, file contents, or PII beyond what audit already stores.

### API & UI
`GET /api/v1/outbox` (summary + company-scoped list), `GET /api/v1/outbox/:id`, `POST /api/v1/outbox/process` (manual processor run), `POST /api/v1/outbox/:id/retry`, `POST /api/v1/outbox/:id/dead-letter`. Capabilities: `viewOutbox`, `processOutbox`, `retryOutboxEvents`, `deadLetterOutboxEvents`, `viewAuditReliability`. The **Admin → Audit Outbox** page shows status summary cards, an event table (retry / process now / dead-letter), and a redacted payload detail modal. Outbox operations are themselves audited (`outbox.processed|retried|dead_lettered`).

### Outbox-backed workflows
Wired (best-effort, alongside existing audit) into: **setup rules loaded**, **company settings updated**, **regulatory source verified**, **loan created**, **loan stage advanced/overridden**, **report filed**, **evidence packet generated**. Other event families remain direct-audit for now and can be migrated incrementally by adding a `tryCreateOutboxEvent(sql, {...})` call next to their existing audit send.

### Processing & local testing
Run the processor manually via `POST /api/v1/outbox/process` (or the page's "Process pending" button). **Scheduled processing** can be enabled later by adding a Worker `scheduled(event, env, ctx)` handler that calls `ctx.waitUntil(processPendingOutboxEvents(sql, buildDefaultHandlers(env), { limit: 50 }))` — the processor logic is already isolated and needs no change. To add a new outbox event: call `tryCreateOutboxEvent(sql, { companyId, eventType, aggregateType, aggregateId, idempotencyKey, payload })` after the domain write.

## Loan processing workspace (Prompt 21C)

`/loans/:id` is a full processing workspace organized into eight tabs, with state preserved via `?tab=` (`overview | checklist | documents | tasks | transaction-log | stage-gate | notes | timeline`). All operational logic lives in the pure, tested helper `lib/loan-workspace.ts` — never hardcoded in React.

- **Overview** — command-center cards (compliance score, integrity, missing documents, open/overdue tasks, transaction-log status, stage gate, closing date) plus prioritized next actions, blockers, and warnings from the loan integrity helper. Each next action deep-links to the resolving tab via `nextActionTab(...)`.
- **Checklist** — the compliance work queue with search and filters (all / missing / required / uploaded / invalid / not-applicable / current-stage / federal / state). `checklistRowState` enforces that only `uploaded | signed | delivered` documents satisfy a row; `rejected | expired | deleted | superseded | failed | quarantined` never count.
- **Documents** — every uploaded document (current and superseded) with status, uploader, date, download, and replace. Superseded/deleted documents stay visible for audit history.
- **Tasks** — auto + manual work queue with filters (open / overdue / auto / manual / complete) and complete actions; auto-tasks carry an `auto_key` and de-duplicate.
- **Transaction Log** — the 21 Texas transaction-log fields with present/missing indicators, the missing-field count that will surface as export warnings, and a link to the Reports export.
- **Stage Gate** — current/next stage, gate preview/advance, and blockers vs warnings split (`splitGateReadiness`); invalid transitions are never overrideable.
- **Notes / Correspondence** — lightweight company- and loan-scoped notes (`loan_notes`, soft-deleted) with types (general / borrower / lender / processor / compliance / condition) and visibility; create/update/delete are audited (`loan.note_created|updated|deleted`) and timelined.
- **Timeline / Audit** — loan event history with category filters (documents / tasks / stage / notes / evidence-packets / audit), backed by `GET /loans/:id/timeline?type=`.

Notes API: `GET|POST /api/v1/loans/:id/notes`, `PATCH|DELETE /api/v1/loans/:id/notes/:noteId` (cap `manageLoanNotes`). The workspace integrates **evidence packet** generation (Prompt 14, `?type=loan&loanId=`) and the **transaction-log export** (Prompt 13). Dashboard loan top-actions deep-link to the relevant tab (e.g. a single missing-docs loan → `/loans/:id?tab=checklist`).

## Examiner evidence packets (Prompt 14)

Assembles loan / program / reporting / setup data into downloadable examiner-ready packets. Pure builders (`lib/evidence-packets.ts`) turn already-fetched data into a consistent `EvidencePacketPayload` (sections + warnings + blockers + summary + integrity hash); the route layer fetches inputs, renders, stores, and audits.

### Packet types
- **Loan Evidence Packet** (`loan_evidence_packet`) — loan summary, transaction-log completeness, checklist (satisfied / missing / N-A / invalid), uploaded documents, triggered conditional flags (50(a)(6), 50(f)(2), reverse, wrap, ARM, company/banker disclosure), stage-gate readiness, tasks, regulatory citations, audit trail.
- **Program Evidence Packet** (`program_evidence_packet`) — required (and optionally recommended) programs, current documents, evidence checklist, review history, and regulatory basis with source-verification status.
- **Reporting Evidence Packet** (`reporting_evidence_packet`) — reporting obligations + derived deadline status, filed dates / confirmation numbers / receipts, report-export history, and transaction-log gap summary.
- **Examination Readiness Packet** (`examination_readiness_packet`) — company/setup readiness, program summary, source-verification summary, reporting status, transaction-log summary, loan inventory, and per-loan evidence summaries.

### Output, storage & integrity
- **JSON** and **HTML** are rendered for every packet (`lib/evidence-packet-renderer.ts`; HTML is fully escaped). PDF/ZIP are intentionally out of scope for this MVP.
- Artifacts are stored in the company-scoped `EXPORTS` R2 bucket at `exports/{companyId}/evidence-packets/{packetType}/{packetId}.{json,html}`.
- Each packet carries a deterministic **integrity hash** (`cyrb53:…`) that changes whenever the payload changes — change-detection metadata, not a cryptographic signature.
- History is tracked in `evidence_packets` (status `generating | generated | failed | expired | deleted`; `DELETE` soft-deletes). A failed generation records a `failed` row so history stays honest.

### Warnings vs blockers
Builders never emit a silently-clean packet. **Warnings**: rules not loaded, optional document missing, transaction-log gaps, source verification due, missing receipt, open tasks, review overdue. **Blockers**: required document/evidence/program missing, stage gate blocked, report overdue, invalid/rejected/expired document used as evidence, company profile incomplete. Invalid-document, blocked-gate, and overdue-report blockers escalate the packet summary to `critical`.

### Capabilities & UI
Capabilities: `viewEvidencePackets`, `generateEvidencePackets`, `downloadEvidencePackets`, `deleteEvidencePackets` (admin / qualifying-individual / compliance-officer get all; originators get view+generate+download; processors/read-only get view+download). The **Evidence Packets** page (generate / history / detail) plus entry-point buttons on the Loan, Programs, Reports, and Dashboard pages deep-link with `?type=` (and `?loanId=`). Audit events: `evidence_packet.generated | downloaded | deleted | failed`.

### Limitations
- Not a direct **SES** submission and not an official **NMLS** filing format.
- Document **binaries are not bundled** — packets reference document metadata + download routes only (no ZIP/PDF in this MVP).
- Retention follows the `EXPORTS` bucket lifecycle; soft-deleted packets remain in storage until the bucket policy reclaims them.

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
