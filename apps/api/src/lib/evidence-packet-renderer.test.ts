import { describe, it, expect } from "vitest";
import { renderEvidencePacketJson, renderEvidencePacketHtml, escapeHtml } from "./evidence-packet-renderer";
import { buildLoanEvidencePacket, type LoanPacketInput } from "./evidence-packets";

const input: LoanPacketInput = {
  meta: {
    packetId: "pkt-1",
    generatedAt: "2026-06-26T00:00:00.000Z",
    generatedBy: { id: "u1", name: "Casey" },
    company: { id: "company-1", name: "Acme <Mortgage>", nmlsId: "111", entityType: "lender", licensedStates: ["TX"] },
    scope: {},
  },
  loan: { id: "loan-1", loanNumber: "TX-1", applicantName: "O'Brien, <Mary>" },
  txLog: { complete: true, missingFields: [], status: "complete" },
  checklist: [{ documentType: "app", displayName: "Application", isMandatory: true, status: "satisfied" }],
  documents: [],
  conditionalFlags: [],
  gate: { canAdvance: true },
  tasks: [],
  citations: [],
  rulesLoaded: true,
};

describe("renderEvidencePacketJson", () => {
  it("round-trips the payload", () => {
    const p = buildLoanEvidencePacket(input);
    const parsed = JSON.parse(renderEvidencePacketJson(p));
    expect(parsed.packetId).toBe("pkt-1");
    expect(parsed.hash).toBe(p.hash);
  });
});

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml(`<script>"&'`)).toBe("&lt;script&gt;&quot;&amp;&#39;");
    expect(escapeHtml(null)).toBe("");
  });
});

describe("renderEvidencePacketHtml", () => {
  const html = renderEvidencePacketHtml(buildLoanEvidencePacket(input));

  it("produces a complete HTML document with the title", () => {
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("Loan Evidence Packet");
  });
  it("escapes packet data (no raw injection)", () => {
    expect(html).toContain("Acme &lt;Mortgage&gt;");
    expect(html).toContain("O&#39;Brien, &lt;Mary&gt;");
    expect(html).not.toContain("<Mortgage>");
  });
  it("includes the not-SES / not-NMLS disclaimer and hash", () => {
    expect(html).toContain("not a direct SES submission");
    expect(html).toContain("cyrb53:");
  });
});
