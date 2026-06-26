import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Lightweight file-content guardrails for Prompt 20 (CI/CD production readiness).
// These assert the delivery-readiness scaffolding exists and stays wired — they
// do not run the workflows. Repo root is four levels up from this test file
// (__tests__ → src → api → apps → repo root).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("CI/CD guardrails", () => {
  it("has a pull request template with the required sections", () => {
    const tpl = read(".github/pull_request_template.md");
    for (const heading of [
      "## Summary",
      "## Type of Change",
      "## Validation",
      "## Database / Schema",
      "## Capabilities / RBAC",
      "## Audit / Outbox",
      "## Compliance Impact",
      "## Cloudflare / Deployment",
      "## PBKDF2 Guardrail",
      "## Rollback Plan",
    ]) {
      expect(tpl).toContain(heading);
    }
  });

  it("ships all five issue templates", () => {
    for (const f of [
      "bug_report.md",
      "feature_request.md",
      "compliance_rule_update.md",
      "schema_migration_issue.md",
      "security_issue.md",
    ]) {
      expect(existsSync(resolve(ROOT, ".github/ISSUE_TEMPLATE", f))).toBe(true);
    }
  });

  it("CI runs schema drift validation, api/web/shared tests, and the web build", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toMatch(/validate-schema-drift\.ts/);
    expect(ci).toMatch(/apps\/api && npx vitest run/);
    expect(ci).toMatch(/apps\/web && npx vitest run/);
    expect(ci).toMatch(/packages\/shared && npx vitest run/);
    expect(ci).toMatch(/Build Web \(production\)/);
  });

  it("CI enforces the PBKDF2 workerd guardrail with the exact message", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("PBKDF2_ITERATIONS exceeds Cloudflare Workers workerd limit. Must be <= 100000.");
  });

  it("the actual PBKDF2 iteration count is within the workerd limit", () => {
    const pw = read("apps/api/src/lib/passwords.ts");
    const m = pw.match(/PBKDF2_ITERATIONS\s*=\s*(\d+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(100000);
  });

  it("has a security workflow with secret scan and PBKDF2 guardrail", () => {
    const sec = read(".github/workflows/security.yml");
    expect(sec).toMatch(/Secret Scan/i);
    expect(sec).toMatch(/audit/i);
    expect(sec).toContain("PBKDF2_ITERATIONS exceeds Cloudflare Workers workerd limit. Must be <= 100000.");
  });

  it("deployment docs name the actual Cloudflare bindings", () => {
    const doc = read("docs/deployment.md");
    for (const binding of ["HYPERDRIVE", "mortgageguard-documents", "mortgageguard-exports", "COMPLIANCE_QUEUE", "AUDIT_QUEUE"]) {
      expect(doc).toContain(binding);
    }
  });

  it("stacked-PR docs explain confirming the final merge to main", () => {
    const doc = read("docs/stacked-prs.md");
    expect(doc.toLowerCase()).toContain("merge");
    expect(doc).toContain("main");
    expect(doc.toLowerCase()).toMatch(/branch: main|merged into `main`|merge to `main`|merge to main/);
  });
});
