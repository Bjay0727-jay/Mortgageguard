#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// MortgageGuard — Production smoke test
//
// Hits safe, read-only endpoints to confirm a deploy is healthy. Credentials
// are NEVER hardcoded — supply them at runtime:
//
//   API_BASE_URL   (required)  e.g. https://api.mortgageguard.example
//   SMOKE_JWT      (optional)  short-lived admin JWT for authenticated checks
//
// Exit code 0 = all run checks passed; 1 = a check failed or config missing.
// This script does NOT mutate data (it never POSTs load-rules).
// ─────────────────────────────────────────────────────────────

const BASE = process.env.API_BASE_URL?.replace(/\/$/, "");
const JWT = process.env.SMOKE_JWT;

interface Check {
  name: string;
  path: string;
  auth: boolean;
  expect: (status: number, body: any) => boolean;
}

const CHECKS: Check[] = [
  {
    name: "Health",
    path: "/health",
    auth: false,
    expect: (s, b) => s === 200 && b?.status === "ok",
  },
  {
    name: "Readiness (DB)",
    path: "/ready",
    auth: false,
    // /ready may report degraded; treat any JSON response with a 200 as healthy.
    expect: (s) => s === 200,
  },
  {
    name: "Setup status",
    path: "/api/v1/setup/status",
    auth: true,
    expect: (s, b) => s === 200 && Array.isArray(b?.steps),
  },
  {
    name: "Rules status (TX)",
    path: "/api/v1/setup/rules-status?state=TX",
    auth: true,
    expect: (s, b) => s === 200 && typeof b?.loaded === "boolean",
  },
  {
    name: "Compliance dashboard",
    path: "/api/v1/compliance/dashboard",
    auth: true,
    expect: (s) => s === 200,
  },
];

async function run(): Promise<void> {
  if (!BASE) {
    console.error("ERROR: API_BASE_URL is required (e.g. https://api.mortgageguard.example)");
    process.exit(1);
  }
  console.log(`Smoke testing: ${BASE}`);
  if (!JWT) {
    console.log("(no SMOKE_JWT set — authenticated checks will be skipped)\n");
  }

  let failed = 0;
  let skipped = 0;

  for (const check of CHECKS) {
    if (check.auth && !JWT) {
      console.log(`SKIP  ${check.name} (no JWT)`);
      skipped++;
      continue;
    }
    try {
      const res = await fetch(`${BASE}${check.path}`, {
        headers: check.auth ? { Authorization: `Bearer ${JWT}` } : {},
      });
      let body: any = null;
      try {
        body = await res.json();
      } catch {
        /* non-JSON response */
      }
      if (check.expect(res.status, body)) {
        console.log(`PASS  ${check.name} (${res.status})`);
      } else {
        console.error(`FAIL  ${check.name} (${res.status})`);
        failed++;
      }
    } catch (err) {
      console.error(`FAIL  ${check.name} (request error: ${(err as Error).message})`);
      failed++;
    }
  }

  console.log(`\n${CHECKS.length - skipped - failed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
