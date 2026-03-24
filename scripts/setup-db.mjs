#!/usr/bin/env node
// ─────────────────────────────────────────────────────
// MortgageGuard — Database Setup Script
// Runs the schema SQL against the DATABASE_URL.
// Usage: DATABASE_URL="postgres://..." node scripts/setup-db.mjs
// ─────────────────────────────────────────────────────
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "db-setup.sql");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });
const schema = readFileSync(schemaPath, "utf8");

// Split by semicolons, filter blanks/comments
const statements = schema
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("--"));

let ok = 0;
let errs = 0;

for (const stmt of statements) {
  try {
    await sql.unsafe(stmt);
    ok++;
    const preview = stmt.replace(/\n/g, " ").slice(0, 70);
    console.log(`  OK: ${preview}...`);
  } catch (e) {
    errs++;
    console.error(`  ERR: ${e.message.slice(0, 120)}`);
  }
}

await sql.end();
console.log(`\nDone: ${ok} succeeded, ${errs} failed`);
if (errs > 0) process.exit(1);
