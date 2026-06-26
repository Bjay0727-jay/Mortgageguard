import { describe, it, expect } from "vitest";
import { csvCell, toCsv, objectsToCsv, UTF8_BOM } from "./csv";

describe("csvCell", () => {
  it("passes through plain values", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(0)).toBe("0");
  });

  it("renders null/undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
  });

  it("quotes values containing commas", () => {
    expect(csvCell("Smith, John")).toBe('"Smith, John"');
  });

  it("quotes values containing newlines", () => {
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("a\r\nb")).toBe('"a\r\nb"');
  });
});

describe("toCsv / objectsToCsv", () => {
  it("joins header + rows with CRLF", () => {
    const out = toCsv(["A", "B"], [["1", "2"], ["3", "4"]]);
    expect(out).toBe("A,B\r\n1,2\r\n3,4");
  });

  it("escaping survives a round trip through a naive parser", () => {
    const out = toCsv(["name", "note"], [["Smith, John", 'said "hi"\nbye']]);
    // The malicious comma/quote/newline must be contained within quotes.
    expect(out).toBe('name,note\r\n"Smith, John","said ""hi""\nbye"');
  });

  it("objectsToCsv maps columns in order", () => {
    const rows = [{ a: "Smith, John", b: 1 }, { a: "Doe", b: 2 }];
    const out = objectsToCsv([
      { header: "Borrower", value: (r) => r.a },
      { header: "Count", value: (r) => r.b },
    ], rows);
    expect(out).toBe('Borrower,Count\r\n"Smith, John",1\r\nDoe,2');
  });
});

describe("formula-injection safety", () => {
  it("neutralizes leading formula triggers when formulaSafe is set", () => {
    expect(csvCell("=1+1", true)).toBe("'=1+1");
    expect(csvCell("+SUM(A1)", true)).toBe("'+SUM(A1)");
    expect(csvCell("-2", true)).toBe("'-2");
    expect(csvCell("@cmd", true)).toBe("'@cmd");
  });

  it("a comma-bearing formula is both neutralized and quoted", () => {
    // Leading '=' is escaped with a quote, then the comma forces RFC-4180 quoting.
    expect(csvCell("=HYPERLINK(1,2)", true)).toBe('"\'=HYPERLINK(1,2)"');
  });

  it("leaves safe values untouched and is off by default", () => {
    expect(csvCell("=1+1")).toBe("=1+1");
    expect(csvCell("Austin", true)).toBe("Austin");
    expect(csvCell("6.5", true)).toBe("6.5");
  });

  it("toCsv applies formulaSafe to headers and cells and can prepend a BOM", () => {
    const out = toCsv(["Name"], [["=evil"]], { formulaSafe: true, bom: true });
    expect(out.startsWith(UTF8_BOM)).toBe(true);
    expect(out).toContain("'=evil");
  });
});
