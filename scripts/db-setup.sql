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
  last_reviewed_at TIMESTAMPTZ,
  next_review_due TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_programs_company ON compliance_programs(company_id);

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

CREATE INDEX IF NOT EXISTS idx_deadlines_company ON reporting_deadlines(company_id);

-- ─── Integrations ───
CREATE TABLE IF NOT EXISTS integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id),
  system_id VARCHAR(50) NOT NULL,
  system_name VARCHAR(100) NOT NULL,
  system_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'connected',
  config JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ
);

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
