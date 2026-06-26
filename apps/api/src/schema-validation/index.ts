// ─────────────────────────────────────────────────────────────
// MortgageGuard — Schema-drift validator (pure orchestrator)
//
// Compares the Drizzle schema (source of truth) against scripts/db-setup.sql,
// checks required indexes/constraints, idempotent SQL, the capability catalog,
// required seed/catalog keys, and the PBKDF2 workerd guardrail. Returns a
// structured, grouped result; the CLI formats + exits.
// ─────────────────────────────────────────────────────────────

import {
  parseDrizzleTables,
  parseSetupSql,
  parseCapabilityCatalog,
  extractCapabilityRefs,
} from "./parse";

export type Severity = "error" | "warning";
export interface Finding {
  group: string;
  message: string;
  severity: Severity;
}

export interface ValidatorInputs {
  drizzleSource: string;
  setupSql: string;
  capabilitiesSource: string;
  capabilityRefSources: string[];
  catalogs: {
    compliance?: string;
    reportingDeadlines?: string;
    evidencePackets?: string;
    outbox?: string;
    conditionalDocs?: string;
  };
  pbkdf2Sources: string[];
}

export interface ValidationResult {
  ok: boolean;
  errors: Finding[];
  warnings: Finding[];
}

// Drizzle tables that are ORM-only and intentionally NOT in db-setup.sql
// (defined in the schema for completeness but never read/written at runtime).
const IGNORE_TABLES = new Set<string>(["licenses", "vendor_contracts"]);

// Required indexes / unique constraints, as tolerant regexes against db-setup.sql.
const REQUIRED_INDEX_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "loan_tasks unique(loan_id, auto_key)", re: /loan_tasks\(loan_id,\s*auto_key\)/i },
  { label: "regulatory_sources unique(source_key)", re: /source_key\s+TEXT\s+NOT NULL\s+UNIQUE/i },
  { label: "compliance_program_source_links unique(program_key, source_key)", re: /UNIQUE\(program_key,\s*source_key\)/i },
  { label: "compliance_program_evidence_requirements unique(program_key, evidence_key)", re: /UNIQUE\(program_key,\s*evidence_key\)/i },
  { label: "reporting_deadlines unique(company_id, obligation_key, jurisdiction, period_start, period_end)", re: /reporting_deadlines\(company_id,\s*obligation_key,\s*jurisdiction,\s*period_start,\s*period_end\)/i },
  { label: "reporting_obligations unique(obligation_key, jurisdiction)", re: /UNIQUE\(obligation_key,\s*jurisdiction\)/i },
  { label: "event_outbox partial unique(idempotency_key)", re: /event_outbox\(idempotency_key\)\s+WHERE\s+idempotency_key\s+IS NOT NULL/i },
  { label: "event_outbox index(status, next_attempt_at)", re: /event_outbox\(status,\s*next_attempt_at\)/i },
];

// Required seed/catalog keys per catalog file.
const REQUIRED_SEEDS = {
  compliance: {
    label: "compliance catalog",
    keys: [
      "aml_program", "red_flags_program", "information_security_program",
      "lo_lender_compensation_agreements", "remote_work_policy",
      "aml_program_31_cfr_1029_210", "aml_sar_31_cfr_1029_320", "red_flags_16_cfr_681_1",
      "safeguards_16_cfr_part_314", "safeguards_16_cfr_314_4", "lo_comp_12_cfr_1026_36",
      "lo_recordkeeping_12_cfr_1026_25_c_2", "remote_work_state_specific",
      "Loan Originator and Lender Compensation Agreements",
    ],
  },
  reportingDeadlines: { label: "reporting obligations", keys: ["rmla", "sssf", "financial_condition"] },
  evidencePackets: { label: "evidence packet keys", keys: ["loan_evidence_packet", "program_evidence_packet", "reporting_evidence_packet", "examination_readiness_packet"] },
  outbox: { label: "outbox statuses", keys: ["pending", "processing", "processed", "failed", "dead_letter"] },
} as const;

// Texas conditional-rule coverage tokens (warning-level — wording varies).
const TEXAS_RULE_TOKENS = ["50(a)(6)", "50(f)(2)", "Wrap", "5.016", "Banker", "Penalties", "ARM Program", "Reverse"];

export const PBKDF2_MAX = 100_000;

// ── Individual checks (exported for unit testing) ──

export function validateTables(drizzle: ReturnType<typeof parseDrizzleTables>, setup: ReturnType<typeof parseSetupSql>): Finding[] {
  const findings: Finding[] = [];
  for (const table of drizzle.keys()) {
    if (IGNORE_TABLES.has(table)) continue;
    if (!setup.has(table)) findings.push({ group: "Missing tables in db-setup.sql", message: table, severity: "error" });
  }
  return findings;
}

export function validateColumns(drizzle: ReturnType<typeof parseDrizzleTables>, setup: ReturnType<typeof parseSetupSql>): Finding[] {
  const findings: Finding[] = [];
  for (const [table, cols] of drizzle) {
    if (IGNORE_TABLES.has(table)) continue;
    const setupCols = setup.get(table);
    if (!setupCols) continue; // missing table already reported
    for (const col of cols) {
      if (!setupCols.has(col)) findings.push({ group: "Missing columns in db-setup.sql", message: `${table}.${col}`, severity: "error" });
    }
  }
  return findings;
}

export function validateIndexes(setupSql: string): Finding[] {
  return REQUIRED_INDEX_PATTERNS
    .filter((p) => !p.re.test(setupSql))
    .map((p) => ({ group: "Missing unique constraints/indexes", message: p.label, severity: "error" as const }));
}

// Static idempotency check: flag unguarded DDL/seed statements.
export function validateIdempotency(setupSql: string): Finding[] {
  const findings: Finding[] = [];
  const lines = setupSql.split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("--")) return;
    const at = `(line ${i + 1})`;
    if (/^CREATE TABLE\s+(?!IF NOT EXISTS)/i.test(line)) {
      findings.push({ group: "Non-idempotent SQL patterns", message: `${line.slice(0, 80)} ${at}\n  Use: CREATE TABLE IF NOT EXISTS ...`, severity: "error" });
    }
    if (/^ALTER TABLE\s+\w+\s+ADD COLUMN\s+(?!IF NOT EXISTS)/i.test(line)) {
      findings.push({ group: "Non-idempotent SQL patterns", message: `${line.slice(0, 80)} ${at}\n  Use: ALTER TABLE ... ADD COLUMN IF NOT EXISTS ...`, severity: "error" });
    }
    if (/^CREATE(\s+UNIQUE)?\s+INDEX\s+(?!IF NOT EXISTS)/i.test(line)) {
      findings.push({ group: "Non-idempotent SQL patterns", message: `${line.slice(0, 80)} ${at}\n  Use: CREATE INDEX IF NOT EXISTS ...`, severity: "error" });
    }
  });
  // INSERT INTO statements must be guarded (ON CONFLICT / WHERE NOT EXISTS / DO $$).
  const insertRe = /INSERT INTO\s+\w+[\s\S]*?;/gi;
  let m: RegExpExecArray | null;
  while ((m = insertRe.exec(setupSql))) {
    const stmt = m[0];
    if (!/ON CONFLICT|WHERE NOT EXISTS|DO \$\$/i.test(stmt)) {
      findings.push({ group: "Non-idempotent SQL patterns", message: `${stmt.slice(0, 80).replace(/\s+/g, " ")}\n  Guard with ON CONFLICT DO NOTHING or WHERE NOT EXISTS`, severity: "error" });
    }
  }
  return findings;
}

export function validateCapabilities(catalog: Set<string>, refs: Set<string>): Finding[] {
  const findings: Finding[] = [];
  for (const ref of refs) {
    if (!catalog.has(ref)) findings.push({ group: "Missing capability definitions", message: `${ref} (referenced in route/UI but absent from CAPABILITIES)`, severity: "error" });
  }
  for (const cap of catalog) {
    if (!refs.has(cap)) findings.push({ group: "Unused capabilities (catalog but no route/UI reference)", message: cap, severity: "warning" });
  }
  return findings;
}

export function validateSeeds(catalogs: ValidatorInputs["catalogs"]): Finding[] {
  const findings: Finding[] = [];
  const check = (src: string | undefined, spec: { label: string; keys: readonly string[] }) => {
    if (src === undefined) return; // catalog file not supplied — skip (CLI supplies all)
    for (const key of spec.keys) {
      if (!src.includes(key)) findings.push({ group: "Missing seed/catalog keys", message: `${spec.label}: ${key}`, severity: "error" });
    }
  };
  check(catalogs.compliance, REQUIRED_SEEDS.compliance);
  check(catalogs.reportingDeadlines, REQUIRED_SEEDS.reportingDeadlines);
  check(catalogs.evidencePackets, REQUIRED_SEEDS.evidencePackets);
  check(catalogs.outbox, REQUIRED_SEEDS.outbox);
  // Texas conditional-rule coverage — warning level.
  if (catalogs.conditionalDocs !== undefined) {
    for (const token of TEXAS_RULE_TOKENS) {
      if (!catalogs.conditionalDocs.includes(token)) findings.push({ group: "Texas conditional-rule coverage", message: `token not found: ${token}`, severity: "warning" });
    }
  }
  return findings;
}

export function validatePbkdf2(sources: string[]): Finding[] {
  const findings: Finding[] = [];
  const re = /PBKDF2_ITERATIONS\s*[=:]\s*(\d[\d_]*)/g;
  for (const src of sources) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const value = Number(m[1].replace(/_/g, ""));
      if (value > PBKDF2_MAX) {
        findings.push({ group: "PBKDF2 guardrail", message: `PBKDF2_ITERATIONS=${value} exceeds Cloudflare Workers workerd limit. Must be <= ${PBKDF2_MAX}.`, severity: "error" });
      }
    }
  }
  return findings;
}

// ── Orchestrator ──
export function validateSchemaDrift(inputs: ValidatorInputs): ValidationResult {
  const drizzle = parseDrizzleTables(inputs.drizzleSource);
  const setup = parseSetupSql(inputs.setupSql);
  const catalog = parseCapabilityCatalog(inputs.capabilitiesSource);
  const refs = extractCapabilityRefs(inputs.capabilityRefSources);

  const all: Finding[] = [
    ...validateTables(drizzle, setup),
    ...validateColumns(drizzle, setup),
    ...validateIndexes(inputs.setupSql),
    ...validateIdempotency(inputs.setupSql),
    ...validateCapabilities(catalog, refs),
    ...validateSeeds(inputs.catalogs),
    ...validatePbkdf2(inputs.pbkdf2Sources),
  ];

  const errors = all.filter((f) => f.severity === "error");
  const warnings = all.filter((f) => f.severity === "warning");
  return { ok: errors.length === 0, errors, warnings };
}

// Group findings by their `group` for human-readable output.
export function formatReport(result: ValidationResult, opts: { strict?: boolean } = {}): string {
  const lines: string[] = [];
  const fail = !result.ok || (opts.strict && result.warnings.length > 0);
  const groupBy = (findings: Finding[]) => {
    const groups = new Map<string, string[]>();
    for (const f of findings) {
      const arr = groups.get(f.group) ?? [];
      arr.push(f.message);
      groups.set(f.group, arr);
    }
    return groups;
  };

  if (result.errors.length === 0 && result.warnings.length === 0) {
    return "Schema drift validation passed. No issues found.";
  }

  lines.push(fail ? "Schema drift validation FAILED." : "Schema drift validation passed with warnings.");
  if (result.errors.length) {
    lines.push("");
    for (const [group, msgs] of groupBy(result.errors)) {
      lines.push(`${group}:`);
      for (const msg of msgs) lines.push(`- ${msg}`);
      lines.push("");
    }
  }
  if (result.warnings.length) {
    lines.push(`Warnings${opts.strict ? " (failing: --strict)" : " (non-failing)"}:`);
    for (const [group, msgs] of groupBy(result.warnings)) {
      lines.push(`${group}:`);
      for (const msg of msgs) lines.push(`- ${msg}`);
      lines.push("");
    }
  }
  return lines.join("\n").trimEnd();
}
