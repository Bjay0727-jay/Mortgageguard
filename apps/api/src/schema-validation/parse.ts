// ─────────────────────────────────────────────────────────────
// MortgageGuard — Schema-drift parsers (pure, deterministic)
//
// Lightweight string/regex parsers for the Drizzle schema, db-setup.sql, and
// the capability catalog. No live database, no Cloudflare creds. The Drizzle
// schema is the source of truth; db-setup.sql is validated against it.
// ─────────────────────────────────────────────────────────────

export type TableColumns = Map<string, Set<string>>;

// Scan from the index of an opening brace/paren and return the index just past
// its balanced match (handles nesting). Returns -1 if unbalanced.
function matchBalanced(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Parse `pgTable("name", { col: builder("db_col") ... })` definitions into a
// map of table name → set of DB column names. Enum-typed columns
// (`entityTypeEnum("entity_type")`) are captured too.
export function parseDrizzleTables(src: string): TableColumns {
  const tables: TableColumns = new Map();
  const re = /pgTable\(\s*"([^"]+)"\s*,\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tableName = m[1];
    const braceIdx = src.indexOf("{", m.index);
    const end = matchBalanced(src, braceIdx, "{", "}");
    if (end < 0) continue;
    const body = src.slice(braceIdx + 1, end);
    const cols = new Set<string>();
    // Each column line: `  propName: builder("db_col_name"...`. The first string
    // arg after the builder call is the DB column name.
    const colRe = /^\s*\w+\s*:\s*\w+\(\s*"([a-zA-Z0-9_]+)"/gm;
    let cm: RegExpExecArray | null;
    while ((cm = colRe.exec(body))) cols.add(cm[1]);
    tables.set(tableName, cols);
    re.lastIndex = end;
  }
  return tables;
}

const CONSTRAINT_KEYWORDS = new Set(["constraint", "primary", "unique", "foreign", "check"]);

// Parse db-setup.sql into table → set of column names, combining CREATE TABLE
// bodies with ALTER TABLE ... ADD COLUMN statements.
export function parseSetupSql(sql: string): TableColumns {
  const tables: TableColumns = new Map();

  // CREATE TABLE [IF NOT EXISTS] name ( ... )
  const createRe = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(sql))) {
    const table = m[1].toLowerCase();
    const parenIdx = sql.indexOf("(", m.index + m[0].length - 1);
    const end = matchBalanced(sql, parenIdx, "(", ")");
    if (end < 0) continue;
    const body = sql.slice(parenIdx + 1, end);
    const cols = tables.get(table) ?? new Set<string>();
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("--")) continue;
      const first = line.split(/[\s(]/)[0].toLowerCase();
      if (!first || CONSTRAINT_KEYWORDS.has(first)) continue;
      if (/^[a-z_][a-z0-9_]*$/.test(first)) cols.add(first);
    }
    tables.set(table, cols);
    createRe.lastIndex = end;
  }

  // ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col ...
  const alterRe = /ALTER TABLE\s+(\w+)\s+ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)/gi;
  while ((m = alterRe.exec(sql))) {
    const table = m[1].toLowerCase();
    const col = m[2].toLowerCase();
    const cols = tables.get(table) ?? new Set<string>();
    cols.add(col);
    tables.set(table, cols);
  }

  return tables;
}

// Extract the string literals of the `CAPABILITIES` array.
export function parseCapabilityCatalog(sharedSrc: string): Set<string> {
  const out = new Set<string>();
  const m = sharedSrc.match(/CAPABILITIES\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) return out;
  const re = /"([a-zA-Z0-9_]+)"/g;
  let cm: RegExpExecArray | null;
  while ((cm = re.exec(m[1]))) out.add(cm[1]);
  return out;
}

// Find capabilities referenced in route/UI source via requireCapability("X"),
// can("X"), or `capability: "X"`.
export function extractCapabilityRefs(sources: string[]): Set<string> {
  const out = new Set<string>();
  const re = /(?:requireCapability|can|hasCapability)\(\s*"([a-zA-Z0-9_]+)"|capability:\s*"([a-zA-Z0-9_]+)"/g;
  for (const src of sources) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.add(m[1] || m[2]);
  }
  return out;
}
