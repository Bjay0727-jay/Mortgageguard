-- ─────────────────────────────────────────────────────
-- MortgageGuard — Database Setup (Neon PostgreSQL)
-- Run against your Neon database to create all tables.
-- ─────────────────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Companies ───
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  nmls_id VARCHAR(20),
  license_states TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Company profile columns used by the setup / company-settings flow (idempotent).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS primary_contact VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS primary_email VARCHAR(255);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS primary_phone VARCHAR(40);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT;

-- ─── Users ───
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  nmls_id VARCHAR(20),
  role VARCHAR(50) NOT NULL DEFAULT 'loan_originator',
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add must_change_password if missing (for existing deployments)
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

-- ─── User Invitations ───
-- Admin-issued invites. Only the SHA-256 hash of the token is stored; the raw
-- token lives only in the invite URL handed to the invitee.
CREATE TABLE IF NOT EXISTS user_invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,
  token_hash TEXT NOT NULL,
  invited_by UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT user_invitations_role_check CHECK (role IN ('company_admin','qualifying_individual','loan_originator','processor','compliance_officer','read_only'))
);

ALTER TABLE user_invitations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_token ON user_invitations(token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_company ON user_invitations(company_id);
CREATE INDEX IF NOT EXISTS idx_invitations_email ON user_invitations(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_active_company_email ON user_invitations(company_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ─── Loans ───
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  loan_number VARCHAR(50) NOT NULL,
  borrower_first_name VARCHAR(255) NOT NULL,
  borrower_last_name VARCHAR(255) NOT NULL,
  property_address TEXT,
  property_city VARCHAR(100),
  property_state VARCHAR(2) NOT NULL,
  property_zip VARCHAR(10),
  status VARCHAR(20) NOT NULL DEFAULT 'application',
  loan_purpose VARCHAR(30) NOT NULL,
  loan_product VARCHAR(20) NOT NULL DEFAULT 'conventional',
  loan_type VARCHAR(20) NOT NULL DEFAULT 'fixed',
  loan_amount DECIMAL(15,2),
  interest_rate DECIMAL(5,3),
  loan_term INTEGER,
  lien_position VARCHAR(10) DEFAULT 'first',
  occupancy_type VARCHAR(20) DEFAULT 'primary',
  application_date DATE NOT NULL DEFAULT CURRENT_DATE,
  closing_date DATE,
  compliance_score INTEGER DEFAULT 0,
  docs_required INTEGER DEFAULT 0,
  docs_complete INTEGER DEFAULT 0,
  is_deleted BOOLEAN DEFAULT false,
  originator_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add is_deleted if missing (for existing deployments)
ALTER TABLE loans ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- Originator/lender columns the loan create endpoint writes (drift fix).
ALTER TABLE loans ADD COLUMN IF NOT EXISTS originator_nmls_id VARCHAR(20);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS lender_name VARCHAR(255);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS lender_nmls_id VARCHAR(20);

-- Loan creation portal (Prompt 21): borrower/applicant, property, originator,
-- transaction-log, and conditional-rule columns. All idempotent.
ALTER TABLE loans ADD COLUMN IF NOT EXISTS applicant_email VARCHAR(255);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS applicant_phone VARCHAR(40);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS co_borrower_name VARCHAR(255);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS application_method VARCHAR(40);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS property_county VARCHAR(100);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS texas_cashout_type VARCHAR(20) DEFAULT 'none';
ALTER TABLE loans ADD COLUMN IF NOT EXISTS purchase_price DECIMAL(15,2);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS estimated_closing_date DATE;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS loan_originator_name VARCHAR(255);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS processor_user_id UUID REFERENCES users(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS compliance_owner_user_id UUID REFERENCES users(id);
ALTER TABLE loans ADD COLUMN IF NOT EXISTS transaction_log_entered_at TIMESTAMPTZ;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS transaction_log_due_at TIMESTAMPTZ;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS transaction_log_status VARCHAR(20);

-- ─── Loan Tasks (work queue) ───
CREATE TABLE IF NOT EXISTS loan_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  loan_id UUID NOT NULL REFERENCES loans(id),
  title TEXT NOT NULL,
  description TEXT,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  -- de-dupe key for auto-generated tasks (e.g. missing_document:appraisal)
  auto_key TEXT,
  assigned_to UUID REFERENCES users(id),
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loan_tasks_loan ON loan_tasks(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_tasks_company ON loan_tasks(company_id);
-- Keep auto-generated tasks unique per loan so regeneration never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_loan_tasks_auto ON loan_tasks(loan_id, auto_key) WHERE auto_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loans_company ON loans(company_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_state ON loans(property_state);
CREATE INDEX IF NOT EXISTS idx_loans_number ON loans(loan_number);

-- ─── State Rules ───
CREATE TABLE IF NOT EXISTS state_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_code VARCHAR(3) NOT NULL,
  rule_name VARCHAR(255) NOT NULL,
  rule_category VARCHAR(100) NOT NULL,
  description TEXT,
  applies_to VARCHAR(10) NOT NULL DEFAULT 'both',
  citation TEXT,
  is_active BOOLEAN DEFAULT true,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add applies_to if missing (for existing deployments / seed compatibility)
ALTER TABLE state_rules ADD COLUMN IF NOT EXISTS applies_to VARCHAR(10) NOT NULL DEFAULT 'both';

CREATE INDEX IF NOT EXISTS idx_state_rules_state ON state_rules(state_code);

-- ─── Required Documents ───
CREATE TABLE IF NOT EXISTS required_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  state_rule_id UUID NOT NULL REFERENCES state_rules(id),
  document_type VARCHAR(100) NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  is_mandatory BOOLEAN DEFAULT true,
  weight INTEGER DEFAULT 1,
  pipeline_stage VARCHAR(20),
  loan_type_filter VARCHAR(20),
  loan_purpose_filter VARCHAR(30),
  loan_product_filter VARCHAR(20),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add description if missing (for existing deployments / seed compatibility)
ALTER TABLE required_documents ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_req_docs_rule ON required_documents(state_rule_id);

-- ─── Documents (uploaded files) ───
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  document_type VARCHAR(100) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  r2_key TEXT NOT NULL,
  is_signed BOOLEAN DEFAULT false,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_loan ON documents(loan_id);

-- ─── Compliance Checks ───
CREATE TABLE IF NOT EXISTS compliance_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  state_rule_id UUID NOT NULL REFERENCES state_rules(id),
  required_document_id UUID NOT NULL REFERENCES required_documents(id),
  check_type VARCHAR(50) NOT NULL DEFAULT 'document_present',
  result VARCHAR(20) NOT NULL DEFAULT 'pending',
  checked_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checks_loan ON compliance_checks(loan_id);

-- ─── Loan Timeline (Audit Events) ───
CREATE TABLE IF NOT EXISTS loan_timeline (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  loan_id UUID NOT NULL REFERENCES loans(id),
  event_type VARCHAR(100) NOT NULL,
  stage_from VARCHAR(20),
  stage_to VARCHAR(20),
  description TEXT,
  metadata JSONB DEFAULT '{}',
  performed_by UUID REFERENCES users(id),
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeline_loan ON loan_timeline(loan_id);

-- ─── Loan Notes / Correspondence (Prompt 21C) ───
CREATE TABLE IF NOT EXISTS loan_notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  loan_id UUID NOT NULL REFERENCES loans(id),
  note_type TEXT NOT NULL DEFAULT 'general',
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loan_notes_loan ON loan_notes(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_notes_company ON loan_notes(company_id);

-- ─── Compliance Programs ───
CREATE TABLE IF NOT EXISTS compliance_programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  program_type VARCHAR(100) NOT NULL,
  program_name VARCHAR(255) NOT NULL,
  is_required BOOLEAN DEFAULT true,
  required_by VARCHAR(20),
  version VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'missing',
  r2_key TEXT,
  file_path TEXT,
  owner VARCHAR(255),
  notes TEXT,
  last_reviewed_at TIMESTAMPTZ,
  next_review_due TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add lifecycle columns if missing (existing deployments). file_path is what the
-- API writes on upload; older schemas only had r2_key, which 500'd the upload.
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS owner VARCHAR(255);
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS notes TEXT;
-- Source-backed program catalog columns (Prompt 15A).
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS program_key VARCHAR(100);
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS is_conditionally_required BOOLEAN DEFAULT false;
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS applicable BOOLEAN;
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS required_document_type VARCHAR(100);
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS required_document_name VARCHAR(255);
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS review_frequency_months INTEGER DEFAULT 12;
ALTER TABLE compliance_programs ADD COLUMN IF NOT EXISTS document_status VARCHAR(50);
-- required_by may now hold a full citation, widen it.
ALTER TABLE compliance_programs ALTER COLUMN required_by TYPE VARCHAR(255);
-- One catalog program per company.
CREATE UNIQUE INDEX IF NOT EXISTS idx_programs_company_key ON compliance_programs(company_id, program_key) WHERE program_key IS NOT NULL;

-- Conditional Remote Work Policy requirement is driven by this flag.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS allows_remote_work BOOLEAN;

-- ─── Compliance Program Versions (upload history) ───
CREATE TABLE IF NOT EXISTS compliance_program_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES compliance_programs(id),
  company_id UUID NOT NULL REFERENCES companies(id),
  version VARCHAR(50) NOT NULL,
  file_path TEXT NOT NULL,
  file_name VARCHAR(255),
  file_size INTEGER,
  mime_type VARCHAR(100),
  uploaded_by UUID REFERENCES users(id),
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_program_versions_program ON compliance_program_versions(program_id);
CREATE INDEX IF NOT EXISTS idx_program_versions_company ON compliance_program_versions(company_id);

CREATE INDEX IF NOT EXISTS idx_programs_company ON compliance_programs(company_id);

-- ─── Regulatory Source Registry (global catalog) ───
CREATE TABLE IF NOT EXISTS regulatory_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  citation TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  agency TEXT,
  source_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  rulemaking_citation TEXT,
  rulemaking_url TEXT,
  guidance_url TEXT,
  effective_date DATE,
  last_verified_at TIMESTAMPTZ,
  next_verification_due_at TIMESTAMPTZ,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  source_hash TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Program ⇄ Source links (global catalog) ───
CREATE TABLE IF NOT EXISTS compliance_program_source_links (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_key TEXT NOT NULL,
  source_key TEXT NOT NULL REFERENCES regulatory_sources(source_key),
  citation TEXT NOT NULL,
  applies_to TEXT NOT NULL DEFAULT 'program',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_key, source_key)
);

-- ─── Program evidence requirements (global catalog) ───
CREATE TABLE IF NOT EXISTS compliance_program_evidence_requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_key TEXT NOT NULL,
  evidence_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  source_key TEXT REFERENCES regulatory_sources(source_key),
  cadence_months INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_key, evidence_key)
);

-- ─── Program document requirements (global catalog) ───
CREATE TABLE IF NOT EXISTS compliance_program_document_requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_key TEXT NOT NULL,
  document_type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_key, document_type)
);

-- ─── Program evidence (company-uploaded / attested) ───
CREATE TABLE IF NOT EXISTS compliance_program_evidence (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  program_id UUID NOT NULL REFERENCES compliance_programs(id),
  evidence_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  file_path TEXT,
  file_name VARCHAR(255),
  notes TEXT,
  attested_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(program_id, evidence_key)
);
CREATE INDEX IF NOT EXISTS idx_program_evidence_company ON compliance_program_evidence(company_id);

-- ─── Program reviews (review / attestation log) ───
CREATE TABLE IF NOT EXISTS compliance_program_reviews (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  program_id UUID NOT NULL REFERENCES compliance_programs(id),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ DEFAULT NOW(),
  next_review_due DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_program_reviews_program ON compliance_program_reviews(program_id);

-- ─── Reporting Deadlines ───
CREATE TABLE IF NOT EXISTS reporting_deadlines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  report_type VARCHAR(100) NOT NULL,
  state_code VARCHAR(3),
  quarter VARCHAR(6),
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
  notes TEXT,
  -- Filing evidence
  filed_at TIMESTAMPTZ,
  filed_by UUID REFERENCES users(id),
  confirmation_number VARCHAR(100),
  evidence_file_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add filing-evidence columns if missing (for existing deployments)
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS filed_at TIMESTAMPTZ;
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS filed_by UUID REFERENCES users(id);
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS confirmation_number VARCHAR(100);
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS evidence_file_path TEXT;

-- Obligation-based reporting model (Prompt 13). obligation_key/jurisdiction/
-- period_* supersede the legacy report_type/state_code/quarter columns, which
-- are kept populated for backward compatibility.
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS obligation_key TEXT;
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(3);
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS period_start DATE;
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS period_end DATE;
ALTER TABLE reporting_deadlines ADD COLUMN IF NOT EXISTS receipt_document_id UUID;

CREATE INDEX IF NOT EXISTS idx_deadlines_company ON reporting_deadlines(company_id);
-- Idempotency key for obligation-based deadline setup (partial: legacy rows have
-- NULL obligation_key and are excluded).
CREATE UNIQUE INDEX IF NOT EXISTS uq_deadline_period
  ON reporting_deadlines(company_id, obligation_key, jurisdiction, period_start, period_end)
  WHERE obligation_key IS NOT NULL;

-- ─── Reporting Obligations (catalog of what must be filed, per jurisdiction) ───
CREATE TABLE IF NOT EXISTS reporting_obligations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  obligation_key TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  frequency TEXT NOT NULL,
  applies_to_entity_types TEXT[],
  due_rule TEXT NOT NULL,
  source_key TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(obligation_key, jurisdiction)
);

-- ─── Report Exports (audit trail of generated transaction-log/report files) ───
CREATE TABLE IF NOT EXISTS report_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  report_key TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  format TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  r2_key TEXT,
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  row_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  hash TEXT,
  metadata JSONB
);
CREATE INDEX IF NOT EXISTS idx_report_exports_company ON report_exports(company_id);

-- ─── Report Filing Events (immutable history of filings against a deadline) ───
CREATE TABLE IF NOT EXISTS report_filing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  reporting_deadline_id UUID NOT NULL REFERENCES reporting_deadlines(id),
  filed_by UUID REFERENCES users(id),
  filed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmation_number TEXT,
  receipt_document_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_filing_events_deadline ON report_filing_events(reporting_deadline_id);
CREATE INDEX IF NOT EXISTS idx_filing_events_company ON report_filing_events(company_id);

-- ─── Evidence Packets (examiner-ready packet history; Prompt 14) ───
CREATE TABLE IF NOT EXISTS evidence_packets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  packet_key TEXT NOT NULL,
  packet_type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'generated',
  scope JSONB NOT NULL,
  r2_key_json TEXT,
  r2_key_html TEXT,
  r2_key_pdf TEXT,
  r2_key_zip TEXT,
  generated_by UUID REFERENCES users(id),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  row_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  blocker_count INTEGER DEFAULT 0,
  hash TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidence_packets_company ON evidence_packets(company_id);
CREATE INDEX IF NOT EXISTS idx_evidence_packets_type ON evidence_packets(company_id, packet_type);

-- ─── Event Outbox (transactional outbox / audit reliability; Prompt 18) ───
CREATE TABLE IF NOT EXISTS event_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  last_error TEXT,
  idempotency_key TEXT,
  queue_message_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_event_outbox_status_next_attempt ON event_outbox(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_event_outbox_company_created ON event_outbox(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_outbox_event_type_created ON event_outbox(event_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_outbox_idempotency_key ON event_outbox(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ─── Integrations ───
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  system_id VARCHAR(50) NOT NULL,
  system_name VARCHAR(100) NOT NULL,
  system_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'connected',
  sync_direction VARCHAR(20),
  config JSONB DEFAULT '{}',
  -- Non-secret credential metadata
  client_id VARCHAR(255),
  instance_url TEXT,
  -- Secrets stored AES-GCM encrypted; never returned by the API
  client_secret_enc TEXT,
  api_key_enc TEXT,
  webhook_enabled BOOLEAN NOT NULL DEFAULT false,
  webhook_id VARCHAR(64),
  webhook_secret_enc TEXT,
  -- Health
  last_sync_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  last_error TEXT,
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lifecycle/health columns for existing deployments
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS sync_direction VARCHAR(20);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS client_id VARCHAR(255);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS instance_url TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS client_secret_enc TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS api_key_enc TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS webhook_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS webhook_id VARCHAR(64);
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS webhook_secret_enc TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_successful_sync_at TIMESTAMPTZ;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE integrations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_company_system ON integrations(company_id, system_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_webhook ON integrations(webhook_id);

-- ─── Integration Sync History ───
CREATE TABLE IF NOT EXISTS integration_sync_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  integration_id UUID REFERENCES integrations(id),
  system_id VARCHAR(50) NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  records_processed INTEGER DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_history_company ON integration_sync_history(company_id);
CREATE INDEX IF NOT EXISTS idx_sync_history_system ON integration_sync_history(company_id, system_id);

CREATE INDEX IF NOT EXISTS idx_integrations_company ON integrations(company_id);

-- ─────────────────────────────────────────────────────
-- Initial Admin Account (onboarding seed)
--
-- Creates a default company + admin so the app is usable out of the box.
-- Idempotent: re-running never overwrites an existing company/user.
--
--   Email:    admin@mortgageguard.com
--   Password: MortgageGuard!2026
--
-- ⚠️  CHANGE THIS PASSWORD AFTER FIRST LOGIN. The password_hash below is a
--    PBKDF2-SHA256 (100k iterations — the max the Workers runtime supports)
--    hash in the format the API verifies. The admin is seeded with
--    must_change_password = true so the app forces a password change on first
--    login.
-- ─────────────────────────────────────────────────────
INSERT INTO companies (id, name, license_states)
VALUES ('00000000-0000-0000-0000-000000000001', 'MortgageGuard Demo', ARRAY['TX'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (company_id, role, name, email, password_hash, must_change_password)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'company_admin',
  'Administrator',
  'admin@mortgageguard.com',
  'pbkdf2:e29ebb67e881e482108f57514ab3bb47:2931f5738d769f90ea1aead758b44e87222a218a73553d39fd628a83a79b6c4e',
  true
)
ON CONFLICT (email) DO NOTHING;

-- Self-healing correction: if the seeded admin still has the bootstrap state
-- (never logged in) reset it to the known-good default hash and re-arm the
-- forced password change. Once the admin has logged in, this is a no-op, so a
-- password the admin set later is never clobbered. Idempotent.
UPDATE users
SET password_hash = 'pbkdf2:e29ebb67e881e482108f57514ab3bb47:2931f5738d769f90ea1aead758b44e87222a218a73553d39fd628a83a79b6c4e',
    must_change_password = true
WHERE email = 'admin@mortgageguard.com'
  AND last_login_at IS NULL
  AND password_hash <> 'pbkdf2:e29ebb67e881e482108f57514ab3bb47:2931f5738d769f90ea1aead758b44e87222a218a73553d39fd628a83a79b6c4e';
