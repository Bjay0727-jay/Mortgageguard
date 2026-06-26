#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// MortgageGuard — Cloudflare config validator
//
// Confirms apps/api/wrangler.toml and apps/web/wrangler.toml declare every
// binding the code expects (R2 / KV / Queues / Hyperdrive / services). This is
// a static check — it reads ONLY the committed wrangler.toml files and requires
// NO secrets and NO Cloudflare API access.
//
//   npx tsx scripts/validate-cloudflare-config.ts          # report
//   npx tsx scripts/validate-cloudflare-config.ts --json   # machine-readable
//
// Exit 0 = all expected bindings present; 1 = something is missing.
// ─────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JSON_OUT = process.argv.includes("--json");

interface Expectation {
  file: string;
  // substrings that must all appear in the file
  bindings: { label: string; needles: string[] }[];
}

const EXPECTATIONS: Expectation[] = [
  {
    file: "apps/api/wrangler.toml",
    bindings: [
      { label: "Hyperdrive HYPERDRIVE", needles: ['binding = "HYPERDRIVE"'] },
      { label: "R2 DOCUMENTS (mortgageguard-documents)", needles: ['binding = "DOCUMENTS"', 'bucket_name = "mortgageguard-documents"'] },
      { label: "R2 EXPORTS (mortgageguard-exports)", needles: ['binding = "EXPORTS"', 'bucket_name = "mortgageguard-exports"'] },
      { label: "KV RULE_CACHE", needles: ['binding = "RULE_CACHE"'] },
      { label: "KV SESSIONS", needles: ['binding = "SESSIONS"'] },
      { label: "Queue COMPLIANCE_QUEUE (compliance-events)", needles: ['binding = "COMPLIANCE_QUEUE"', 'queue = "compliance-events"'] },
      { label: "Queue AUDIT_QUEUE (audit-events)", needles: ['binding = "AUDIT_QUEUE"', 'queue = "audit-events"'] },
      { label: "Queue consumer compliance-events", needles: ["[[queues.consumers]]"] },
    ],
  },
  {
    file: "apps/web/wrangler.toml",
    bindings: [
      { label: "Assets ASSETS", needles: ['binding = "ASSETS"'] },
      { label: "Service WORKER_SELF_REFERENCE", needles: ['binding = "WORKER_SELF_REFERENCE"'] },
    ],
  },
];

function validate() {
  const problems: string[] = [];
  const ok: string[] = [];

  for (const exp of EXPECTATIONS) {
    let content = "";
    try {
      content = readFileSync(resolve(ROOT, exp.file), "utf8");
    } catch {
      problems.push(`${exp.file}: file not found`);
      continue;
    }
    for (const b of exp.bindings) {
      const missing = b.needles.filter((n) => !content.includes(n));
      if (missing.length) {
        problems.push(`${exp.file}: missing ${b.label}`);
      } else {
        ok.push(`${exp.file}: ${b.label}`);
      }
    }
  }

  return { problems, ok };
}

const { problems, ok } = validate();

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: problems.length === 0, passed: ok, problems }, null, 2));
} else {
  for (const o of ok) console.log(`OK   ${o}`);
  for (const p of problems) console.error(`MISS ${p}`);
  console.log(`\n${ok.length} bindings OK, ${problems.length} missing`);
}

process.exit(problems.length === 0 ? 0 : 1);
