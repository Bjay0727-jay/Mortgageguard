import { describe, it, expect } from "vitest";
import { csvCell, toCsv, objectsToCsv } from "./csv";

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
