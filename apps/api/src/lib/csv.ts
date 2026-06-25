// ─────────────────────────────────────────────────────
// MortgageGuard — RFC 4180 CSV serialization
// Safe escaping for quotes, commas, and newlines so exam exports never corrupt.
// ─────────────────────────────────────────────────────

// Quote a single field when it contains a delimiter, quote, or newline, and
// double any embedded quotes (RFC 4180). null/undefined become empty strings.
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// Serialize a header row + data rows to a CSV string with CRLF line endings.
export function toCsv(headers: string[], rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

// Serialize an array of objects given an ordered column spec.
export function objectsToCsv<T>(columns: { header: string; value: (row: T) => unknown }[], rows: T[]): string {
  return toCsv(
    columns.map((c) => c.header),
    rows.map((row) => columns.map((c) => c.value(row))),
  );
}
