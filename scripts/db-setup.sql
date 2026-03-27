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
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);

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
  citation TEXT,
  is_active BOOLEAN DEFAULT true,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
