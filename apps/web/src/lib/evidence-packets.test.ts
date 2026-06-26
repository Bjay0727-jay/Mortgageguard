import { describe, it, expect } from "vitest";
import {
  PACKET_TYPES,
  packetTypeFields,
  buildGenerateRequest,
  canGenerate,
  packetStatusVariant,
  summaryStatusVariant,
  packetFormats,
} from "./evidence-packets";

describe("packetTypeFields", () => {
  it("loan packet shows the loan selector + document/audit toggles, no date range", () => {
    const f = packetTypeFields("loan");
    expect(f.loanSelector).toBe(true);
    expect(f.dateRange).toBe(false);
    expect(f.includeDocuments).toBe(true);
  });
  it("reporting/examination packets show date range + jurisdiction", () => {
    expect(packetTypeFields("reporting").dateRange).toBe(true);
    expect(packetTypeFields("examination").dateRange).toBe(true);
    expect(packetTypeFields("reporting").jurisdiction).toBe(true);
    expect(packetTypeFields("programs").dateRange).toBe(false);
    expect(packetTypeFields("programs").loanSelector).toBe(false);
  });
  it("there are four packet types", () => {
    expect(PACKET_TYPES.map((t) => t.key)).toEqual(["loan", "programs", "reporting", "examination"]);
  });
});

describe("buildGenerateRequest", () => {
  it("builds the loan route with the loan id and document toggles", () => {
    const req = buildGenerateRequest("loan", { loanId: "loan-9", includeDocuments: false });
    expect(req.path).toBe("/api/v1/evidence-packets/loan/loan-9");
    expect(req.body).toMatchObject({ includeDocuments: false, includeAuditTrail: true });
    expect(req.body).not.toHaveProperty("jurisdiction");
  });
  it("builds the reporting route with jurisdiction + date range", () => {
    const req = buildGenerateRequest("reporting", { jurisdiction: "TX", periodStart: "2026-01-01", periodEnd: "2026-03-31", includeReceipts: false });
    expect(req.path).toBe("/api/v1/evidence-packets/reporting");
    expect(req.body).toMatchObject({ jurisdiction: "TX", periodStart: "2026-01-01", periodEnd: "2026-03-31", includeReceipts: false });
  });
  it("examination route includes recommended-program flag only for programs type", () => {
    expect(buildGenerateRequest("programs", { includeRecommendedPrograms: true }).body).toMatchObject({ includeRecommendedPrograms: true });
    expect(buildGenerateRequest("examination", {}).body).not.toHaveProperty("includeRecommendedPrograms");
  });
});

describe("canGenerate", () => {
  it("requires a loan for loan packets", () => {
    expect(canGenerate("loan", {})).toBe(false);
    expect(canGenerate("loan", { loanId: "x" })).toBe(true);
    expect(canGenerate("examination", {})).toBe(true);
  });
});

describe("status + formats", () => {
  it("maps packet + summary statuses to badge variants", () => {
    expect(packetStatusVariant("generated")).toBe("green");
    expect(packetStatusVariant("failed")).toBe("red");
    expect(summaryStatusVariant("critical")).toBe("red");
    expect(summaryStatusVariant("ready")).toBe("green");
  });
  it("exposes download formats only for generated packets", () => {
    expect(packetFormats("generated")).toEqual(["json", "html"]);
    expect(packetFormats("failed")).toEqual([]);
    expect(packetFormats("deleted")).toEqual([]);
  });
});
