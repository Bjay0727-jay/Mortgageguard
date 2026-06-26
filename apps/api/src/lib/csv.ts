// ─────────────────────────────────────────────────────
// MortgageGuard — RFC 4180 CSV serialization
// Safe escaping for quotes, commas, and newlines so exam exports never corrupt.
// ─────────────────────────────────────────────────────

// UTF-8 byte-order mark — prepended to exports so Excel detects UTF-8 and
// renders accented borrower/property names correctly.
export const UTF8_BOM = "﻿";

export interface CsvOptions {
  // Neutralize spreadsheet formula injection (CSV/DDE) by prefixing any cell
  // that begins with =, +, -, or @ (after optional whitespace) with a single
  // quote so the spreadsheet treats it as text, not a formula.
  formulaSafe?: boolean;
  // Prepend a UTF-8 BOM for Excel compatibility.
  bom?: boolean;
}

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

// Guard a raw string value against formula injection before RFC 4180 quoting.
function neutralizeFormula(s: string): string {
  return FORMULA_TRIGGER.test(s) ? `'${s}` : s;
}

// Quote a single field when it contains a delimiter, quote, or newline, and
// double any embedded quotes (RFC 4180). null/undefined become empty strings.
// When formulaSafe is set, leading formula triggers are neutralized first.
export function csvCell(value: unknown, formulaSafe = false): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (formulaSafe) s = neutralizeFormula(s);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Serialize a header row + data rows to a CSV string with CRLF line endings.
export function toCsv(headers: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>, opts: CsvOptions = {}): string {
  const lines = [headers.map((h) => csvCell(h, opts.formulaSafe)).join(",")];
  for (const row of rows) {
    lines.push(row.map((cell) => csvCell(cell, opts.formulaSafe)).join(","));
  }
  const body = lines.join("\r\n");
  return opts.bom ? UTF8_BOM + body : body;
}

// Serialize an array of objects given an ordered column spec.
export function objectsToCsv<T>(columns: { header: string; value: (row: T) => unknown }[], rows: T[], opts: CsvOptions = {}): string {
  return toCsv(
    columns.map((c) => c.header),
    rows.map((row) => columns.map((c) => c.value(row))),
    opts,
  );
}
