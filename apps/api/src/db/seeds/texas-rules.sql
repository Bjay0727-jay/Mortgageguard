-- ─────────────────────────────────────────────────────
-- MortgageGuard — Texas (TX) Compliance Rules Seed
-- Source: TX-SML Mortgage Compliance Guide (Jan 26, 2026)
-- ─────────────────────────────────────────────────────

-- ═══ FEDERAL RULES (apply to all states) ═══

INSERT INTO state_rules (state_code, rule_category, rule_name, description, applies_to, effective_date)
VALUES
  ('FED', 'documentation', 'TRID - Initial Disclosures', 'Truth-in-Lending/RESPA Integrated Disclosure requirements', 'both', '2015-10-03'),
  ('FED', 'documentation', 'TRID - Closing Disclosures', 'Final closing disclosure requirements', 'both', '2015-10-03'),
  ('FED', 'documentation', 'Ability-to-Repay', 'ATR documentation and qualification requirements', 'both', '2014-01-10'),
  ('FED', 'documentation', 'ECOA Credit Disclosures', 'Equal Credit Opportunity Act disclosure requirements', 'both', '1974-10-28'),
  ('FED', 'documentation', 'RESPA Disclosures', 'Settlement procedures and provider list requirements', 'both', '1975-06-20'),
  ('FED', 'program', 'Anti-Money Laundering', 'BSA/AML compliance program required by federal law', 'both', '2002-10-26'),
  ('FED', 'program', 'Identity Theft Prevention', 'Red Flags Rule - identity theft prevention program', 'both', '2008-11-01'),
  ('FED', 'program', 'Information Security', 'Gramm-Leach-Bliley Act information security program', 'both', '2003-05-23'),
  ('FED', 'program', 'Compensation Agreements', 'Loan originator and lender compensation agreements', 'both', '2011-04-06');

-- ═══ TEXAS STATE RULES ═══

INSERT INTO state_rules (state_code, rule_category, rule_name, description, applies_to, effective_date)
VALUES
  ('TX', 'disclosure', 'TX Mortgage Company Disclosure', 'Required for mortgage company licensees - signed/dated by applicant(s)', 'broker', '2020-01-01'),
  ('TX', 'disclosure', 'TX Mortgage Banker Disclosure', 'Required for mortgage banker registrants - signed/dated by applicant(s)', 'lender', '2020-01-01'),
  ('TX', 'disclosure', 'TX Notice of Penalties', 'Notice of penalties for making false or misleading statements - signed at closing', 'both', '2020-01-01'),
  ('TX', 'disclosure', 'TX Home Equity Disclosure 50(a)(6)', 'Required for Texas cash-out home equity loans under Section 50(a)(6)', 'both', '2020-01-01'),
  ('TX', 'disclosure', 'TX Acknowledgement Fair Market Value', 'Required for 50(a)(6) home equity loans', 'both', '2020-01-01'),
  ('TX', 'disclosure', 'TX Discount Point Acknowledgement', 'Required for 50(a)(6) to demonstrate bona fide discount points', 'both', '2020-01-01'),
  ('TX', 'disclosure', 'TX Refinance Home Equity Notice 50(f)(2)', 'Notice concerning refinance of existing home equity loan to non-home equity', 'both', '2020-01-01'),
  ('TX', 'disclosure', 'TX Wrap Mortgage Disclosure', 'Required for wrap mortgage loans', 'both', '2020-01-01'),
  ('TX', 'disclosure', 'TX Prop Code 5.016 Notice', 'Notice to pre-existing lienholder for wrap mortgages', 'both', '2020-01-01'),
  ('TX', 'documentation', 'TX Transaction Log', 'Mortgage transaction log maintained within 7 days with all required fields', 'both', '2020-01-01'),
  ('TX', 'documentation', 'TX Loan File Completeness', 'Complete loan files with all applicable documents', 'both', '2020-01-01'),
  ('TX', 'program', 'TX Remote Work Policy', 'Required by state law if company allows remote work', 'both', '2023-01-01'),
  ('TX', 'reporting', 'TX RMLA Quarterly', 'Residential Mortgage Loan Activity report - due within 45 days of quarter end', 'both', '2020-01-01'),
  ('TX', 'reporting', 'TX SSSF Quarterly', 'State-Specific Supplemental Form - due within 45 days of quarter end', 'both', '2020-01-01'),
  ('TX', 'reporting', 'TX Financial Condition', 'Financial condition report - quarterly for lenders, annually for brokers', 'both', '2020-01-01'),
  ('TX', 'documentation', 'TX Processing/Underwriting Log', 'Required if providing third-party processing/underwriting services', 'both', '2025-01-01');


-- ═══ REQUIRED DOCUMENTS (Federal) ═══
-- These reference the federal rules above. In production, use the actual UUIDs.
-- This seed uses a simplified approach for the scaffold.

-- For the TRID Initial Disclosures rule:
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, description)
SELECT id, 'initial_loan_application', 'Initial Loan Application (signed/dated)', true, 3, 'application', 'Signed and dated by applicant(s) and RMLO'
FROM state_rules WHERE rule_name = 'TRID - Initial Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'initial_loan_estimate', 'Initial Loan Estimate', true, 3, 'processing'
FROM state_rules WHERE rule_name = 'TRID - Initial Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'intent_to_proceed', 'Intent to Proceed Documentation', true, 3, 'application'
FROM state_rules WHERE rule_name = 'TRID - Initial Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'revised_loan_estimate', 'Revised Loan Estimate(s)', false, 1, 'processing'
FROM state_rules WHERE rule_name = 'TRID - Initial Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'changed_circumstances', 'Documentation of Changed Circumstances', false, 1, 'processing'
FROM state_rules WHERE rule_name = 'TRID - Initial Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'homeownership_counseling_list', 'List of Homeownership Counseling Organizations', true, 3, 'processing'
FROM state_rules WHERE rule_name = 'RESPA Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'settlement_provider_list', 'Settlement Service Provider List', true, 3, 'processing'
FROM state_rules WHERE rule_name = 'RESPA Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'initial_privacy_notice', 'Initial Privacy Notice', true, 3, 'processing'
FROM state_rules WHERE rule_name = 'RESPA Disclosures' AND state_code = 'FED';

-- Closing disclosures
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'closing_disclosure_final', 'Final Closing Disclosure (signed)', true, 3, 'closing'
FROM state_rules WHERE rule_name = 'TRID - Closing Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'closing_disclosure_preliminary', 'Preliminary Closing Disclosure', true, 3, 'closing'
FROM state_rules WHERE rule_name = 'TRID - Closing Disclosures' AND state_code = 'FED';

-- Credit and appraisal
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'credit_report', 'Credit Report(s)', true, 3, 'processing'
FROM state_rules WHERE rule_name = 'ECOA Credit Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'credit_report_invoice', 'Credit Report Invoice(s)', true, 2, 'processing'
FROM state_rules WHERE rule_name = 'ECOA Credit Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'credit_score_disclosure', 'Credit Score Disclosure and Notice', true, 3, 'processing'
FROM state_rules WHERE rule_name = 'ECOA Credit Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'appraisal', 'Appraisal', true, 3, 'underwriting'
FROM state_rules WHERE rule_name = 'TRID - Initial Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'appraisal_invoice', 'Appraisal Invoice (itemized)', true, 2, 'underwriting'
FROM state_rules WHERE rule_name = 'TRID - Initial Disclosures' AND state_code = 'FED';

-- ATR documentation
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'atr_documentation', 'Ability-to-Repay Documentation', true, 3, 'underwriting'
FROM state_rules WHERE rule_name = 'Ability-to-Repay' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'credit_qualifying_docs', 'Credit Qualifying Documentation', true, 3, 'underwriting'
FROM state_rules WHERE rule_name = 'Ability-to-Repay' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'voe', 'Verification of Employment', true, 3, 'underwriting'
FROM state_rules WHERE rule_name = 'Ability-to-Repay' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'voi', 'Verification of Income', true, 3, 'underwriting'
FROM state_rules WHERE rule_name = 'Ability-to-Repay' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'vod', 'Verification of Deposit', true, 3, 'underwriting'
FROM state_rules WHERE rule_name = 'Ability-to-Repay' AND state_code = 'FED';

-- Closing docs
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'fee_agreement', 'Fee Agreement', true, 3, 'closing'
FROM state_rules WHERE rule_name = 'TRID - Closing Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'rate_lock_agreement', 'Rate Lock Agreement', true, 2, 'closing'
FROM state_rules WHERE rule_name = 'TRID - Closing Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'promissory_note', 'Promissory Note / Loan Agreement', true, 3, 'post_close'
FROM state_rules WHERE rule_name = 'TRID - Closing Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'deed_of_trust', 'Deed of Trust / Security Instrument (recorded)', true, 3, 'post_close'
FROM state_rules WHERE rule_name = 'TRID - Closing Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'title_policy', 'Lender Title Policy', true, 3, 'closing'
FROM state_rules WHERE rule_name = 'TRID - Closing Disclosures' AND state_code = 'FED';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'flood_certification', 'Flood Certification', true, 3, 'closing'
FROM state_rules WHERE rule_name = 'TRID - Closing Disclosures' AND state_code = 'FED';


-- ═══ REQUIRED DOCUMENTS (Texas-specific) ═══

-- TX Mortgage Company Disclosure (broker only)
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, description)
SELECT id, 'tx_mortgage_company_disclosure', 'TX Mortgage Company Disclosure', true, 2, 'application', 'Signed/dated by applicant(s) or evidence of delivery'
FROM state_rules WHERE rule_name = 'TX Mortgage Company Disclosure' AND state_code = 'TX';

-- TX Notice of Penalties (all TX loans)
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage)
SELECT id, 'tx_notice_penalties', 'TX Notice of Penalties for False/Misleading Statement', true, 2, 'closing'
FROM state_rules WHERE rule_name = 'TX Notice of Penalties' AND state_code = 'TX';

-- TX Home Equity 50(a)(6) disclosures (only for home equity loans)
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, loan_purpose_filter)
SELECT id, 'tx_home_equity_disclosure', 'TX Home Equity Disclosure - 50(a)(6)', true, 2, 'closing', 'home_equity_50a6'
FROM state_rules WHERE rule_name = 'TX Home Equity Disclosure 50(a)(6)' AND state_code = 'TX';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, loan_purpose_filter)
SELECT id, 'tx_fair_market_value_ack', 'Acknowledgement of Fair Market Value - 50(a)(6)', true, 2, 'closing', 'home_equity_50a6'
FROM state_rules WHERE rule_name = 'TX Acknowledgement Fair Market Value' AND state_code = 'TX';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, loan_purpose_filter)
SELECT id, 'tx_discount_point_ack', 'Discount Point Acknowledgement - 50(a)(6)', true, 2, 'closing', 'home_equity_50a6'
FROM state_rules WHERE rule_name = 'TX Discount Point Acknowledgement' AND state_code = 'TX';

-- TX Wrap Mortgage (only for wrap loans)
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, loan_purpose_filter)
SELECT id, 'tx_wrap_mortgage_disclosure', 'Wrap Mortgage Loan Disclosure', true, 2, 'closing', 'wrap_mortgage'
FROM state_rules WHERE rule_name = 'TX Wrap Mortgage Disclosure' AND state_code = 'TX';

INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, loan_purpose_filter)
SELECT id, 'tx_prop_code_5016_notice', 'Tex. Prop. Code 5.016 Notice (to lienholder)', true, 2, 'closing', 'wrap_mortgage'
FROM state_rules WHERE rule_name = 'TX Prop Code 5.016 Notice' AND state_code = 'TX';

-- TX Refinance 50(f)(2)
INSERT INTO required_documents (state_rule_id, document_type, display_name, is_mandatory, weight, pipeline_stage, loan_purpose_filter)
SELECT id, 'tx_refinance_home_equity_notice', 'TX Notice Concerning Refinance of Home Equity Loan - 50(f)(2)', true, 2, 'closing', 'refinance'
FROM state_rules WHERE rule_name = 'TX Refinance Home Equity Notice 50(f)(2)' AND state_code = 'TX';
