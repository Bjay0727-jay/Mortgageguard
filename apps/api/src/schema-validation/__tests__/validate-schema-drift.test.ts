import { describe, it, expect } from "vitest";
import { parseDrizzleTables, parseSetupSql, parseCapabilityCatalog, extractCapabilityRefs } from "../parse";
import {
  validateTables, validateColumns, validateIndexes, validateIdempotency,
  validateCapabilities, validateSeeds, validatePbkdf2, validateSchemaDrift, formatReport,
} from "../index";
import * as F from "../__fixtures__/fixtures";

const drizzle = () => parseDrizzleTables(F.VALID_DRIZZLE);

describe("parsers", () => {
  it("parses Drizzle tables + columns (incl. enum columns)", () => {
    const t = drizzle();
    expect([...t.keys()]).toEqual(["companies", "loans"]);
    expect([...t.get("loans")!]).toEqual(expect.arrayContaining(["company_id", "lender_name", "status"]));
  });
  it("parses setup SQL CREATE + ALTER columns", () => {
    const s = parseSetupSql(F.VALID_SETUP);
    expect(s.get("loans")).toEqual(new Set(["id", "company_id", "status", "lender_name"]));
  });
});

describe("table + column coverage", () => {
  it("valid schema/setup passes", () => {
    expect(validateTables(drizzle(), parseSetupSql(F.VALID_SETUP))).toEqual([]);
    expect(validateColumns(drizzle(), parseSetupSql(F.VALID_SETUP))).toEqual([]);
  });
  it("missing table fails", () => {
    const errs = validateTables(drizzle(), parseSetupSql(F.MISSING_TABLE_SETUP));
    expect(errs.map((e) => e.message)).toContain("loans");
  });
  it("missing column fails", () => {
    const errs = validateColumns(drizzle(), parseSetupSql(F.MISSING_COLUMN_SETUP));
    expect(errs.map((e) => e.message)).toContain("loans.lender_name");
  });
});

describe("index coverage", () => {
  it("missing index/unique constraint fails", () => {
    expect(validateIndexes("").length).toBe(8);
  });
  it("all required indexes present passes", () => {
    expect(validateIndexes(F.REQUIRED_INDEXES_SQL)).toEqual([]);
  });
});

describe("idempotency", () => {
  it("non-idempotent CREATE TABLE fails", () => {
    expect(validateIdempotency(F.NON_IDEMPOTENT_CREATE).length).toBeGreaterThan(0);
  });
  it("non-idempotent ALTER ADD COLUMN fails", () => {
    expect(validateIdempotency(F.NON_IDEMPOTENT_ALTER).length).toBeGreaterThan(0);
  });
  it("non-idempotent CREATE INDEX fails", () => {
    expect(validateIdempotency(F.NON_IDEMPOTENT_INDEX).length).toBeGreaterThan(0);
  });
  it("unguarded INSERT fails, guarded passes", () => {
    expect(validateIdempotency(F.NON_IDEMPOTENT_INSERT).length).toBe(1);
    expect(validateIdempotency(F.IDEMPOTENT_INSERT)).toEqual([]);
  });
});

describe("capabilities", () => {
  it("capability referenced but missing from catalog fails", () => {
    const catalog = parseCapabilityCatalog(F.CAPABILITIES_SRC);
    const refs = extractCapabilityRefs([`requireCapability("manageLoanNotes"); can("ghostCapability");`]);
    const errs = validateCapabilities(catalog, refs);
    expect(errs.filter((e) => e.severity === "error").map((e) => e.message.split(" ")[0])).toContain("ghostCapability");
  });
  it("unused catalog capability is a warning, not an error", () => {
    const catalog = parseCapabilityCatalog(F.CAPABILITIES_SRC);
    const refs = extractCapabilityRefs([`requireCapability("viewLoans");`]);
    const errs = validateCapabilities(catalog, refs);
    expect(errs.some((e) => e.severity === "error")).toBe(false);
    expect(errs.some((e) => e.severity === "warning" && e.message === "viewOutbox")).toBe(true);
  });
});

describe("seeds", () => {
  const catalogs = { compliance: F.COMPLIANCE_CATALOG, reportingDeadlines: F.REPORTING_CATALOG, evidencePackets: F.PACKETS_CATALOG, outbox: F.OUTBOX_CATALOG };
  it("complete catalogs pass", () => {
    expect(validateSeeds(catalogs)).toEqual([]);
  });
  it("missing required compliance program key fails", () => {
    expect(validateSeeds({ ...catalogs, compliance: F.COMPLIANCE_CATALOG.replace("information_security_program", "") }).some((e) => e.message.includes("information_security_program"))).toBe(true);
  });
  it("missing reporting obligation key fails", () => {
    expect(validateSeeds({ ...catalogs, reportingDeadlines: "sssf financial_condition" }).some((e) => e.message.includes("rmla"))).toBe(true);
  });
  it("missing regulatory source key fails", () => {
    expect(validateSeeds({ ...catalogs, compliance: F.COMPLIANCE_CATALOG.replace("red_flags_16_cfr_681_1 ", "") }).some((e) => e.message.includes("red_flags_16_cfr_681_1"))).toBe(true);
  });
});

describe("pbkdf2 guardrail", () => {
  it("<= 100000 passes", () => {
    expect(validatePbkdf2([F.PBKDF2_OK])).toEqual([]);
  });
  it("> 100000 fails with actionable message", () => {
    const errs = validatePbkdf2([F.PBKDF2_TOO_HIGH]);
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/exceeds Cloudflare Workers workerd limit/);
  });
});

describe("orchestrator + report", () => {
  const validInputs = {
    drizzleSource: F.VALID_DRIZZLE,
    setupSql: F.VALID_SETUP + F.REQUIRED_INDEXES_SQL,
    capabilitiesSource: F.CAPABILITIES_SRC,
    capabilityRefSources: [`requireCapability("viewLoans"); can("manageLoanNotes"); can("viewOutbox");`],
    catalogs: { compliance: F.COMPLIANCE_CATALOG, reportingDeadlines: F.REPORTING_CATALOG, evidencePackets: F.PACKETS_CATALOG, outbox: F.OUTBOX_CATALOG },
    pbkdf2Sources: [F.PBKDF2_OK],
  };

  it("valid inputs produce ok=true with no errors (JSON-mode shape)", () => {
    const r = validateSchemaDrift(validInputs);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(JSON.parse(JSON.stringify({ ok: r.ok, errors: r.errors, warnings: r.warnings })).ok).toBe(true);
  });

  it("drift produces ok=false and actionable grouped output", () => {
    const r = validateSchemaDrift({ ...validInputs, setupSql: F.MISSING_TABLE_SETUP + F.REQUIRED_INDEXES_SQL, pbkdf2Sources: [F.PBKDF2_TOO_HIGH] });
    expect(r.ok).toBe(false);
    const report = formatReport(r);
    expect(report).toContain("Missing tables in db-setup.sql:");
    expect(report).toContain("PBKDF2 guardrail:");
    expect(report).toContain("- loans");
  });

  it("strict mode converts warnings into failure", () => {
    const r = validateSchemaDrift({ ...validInputs, capabilityRefSources: [`requireCapability("viewLoans");`] });
    expect(r.ok).toBe(true); // unused-capability is a warning
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(formatReport(r, { strict: true })).toContain("FAILED");
  });
});
