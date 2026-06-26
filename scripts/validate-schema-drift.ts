#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────
// MortgageGuard — Schema drift validator CLI
//
// Reads the source-of-truth files from the repo and runs the pure validator.
//   pnpm db:validate            # fail on hard issues
//   pnpm db:validate -- --strict  # also fail on warnings
//   pnpm db:validate -- --json    # machine-readable output
// ─────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { validateSchemaDrift, formatReport } from "../apps/api/src/schema-validation/index";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  const p = join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

// Recursively collect source file contents under a directory.
function collect(rel: string, exts: string[]): string[] {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
      const full = join(d, entry);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (exts.some((e) => entry.endsWith(e))) out.push(readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const asJson = args.includes("--json");

  const result = validateSchemaDrift({
    drizzleSource: read("apps/api/src/db/schema/index.ts"),
    setupSql: read("scripts/db-setup.sql"),
    capabilitiesSource: read("packages/shared/src/index.ts"),
    capabilityRefSources: [
      ...collect("apps/api/src/routes", [".ts"]),
      ...collect("apps/api/src/middleware", [".ts"]),
      ...collect("apps/web/src", [".ts", ".tsx"]),
    ],
    catalogs: {
      compliance: read("apps/api/src/lib/compliance-catalog.ts"),
      // rmla/sssf obligation keys live in the reports route; financial_condition in the helper.
      reportingDeadlines: read("apps/api/src/lib/reporting-deadlines.ts") + "\n" + read("apps/api/src/routes/reports.ts"),
      evidencePackets: read("apps/api/src/lib/evidence-packets.ts"),
      outbox: read("apps/api/src/lib/outbox.ts"),
      conditionalDocs: read("apps/api/src/lib/loan-conditional-docs.ts"),
    },
    pbkdf2Sources: collect("apps/api/src/lib", [".ts"]),
  });

  const failed = !result.ok || (strict && result.warnings.length > 0);

  if (asJson) {
    console.log(JSON.stringify({ ok: !failed, errors: result.errors, warnings: result.warnings }, null, 2));
  } else {
    console.log(formatReport(result, { strict }));
  }
  process.exit(failed ? 1 : 0);
}

main();
