import { describe, it, expect } from "vitest";
import {
  getRequiredDocuments,
  getDocumentsByCategory,
  TX_DOCUMENT_CATEGORIES,
} from "./tx-documents";

describe("tx-documents service", () => {
  describe("TX_DOCUMENT_CATEGORIES", () => {
    it("has 5 categories", () => {
      expect(TX_DOCUMENT_CATEGORIES).toHaveLength(5);
    });

    it("includes federal disclosures, underwriting, TX state, TX home equity, and reporting", () => {
      const ids = TX_DOCUMENT_CATEGORIES.map((c) => c.id);
      expect(ids).toEqual([
        "fed_disclosures",
        "fed_underwriting",
        "tx_state",
        "tx_homeequity",
        "tx_reporting",
      ]);
    });

    it("every document has required fields", () => {
      for (const cat of TX_DOCUMENT_CATEGORIES) {
        for (const doc of cat.docs) {
          expect(doc.name).toBeTruthy();
          expect(doc.rule).toBeTruthy();
          expect(doc.timing).toBeTruthy();
          expect(typeof doc.required).toBe("boolean");
          expect(doc.stage).toBeTruthy();
          expect(doc.loanTypes.length).toBeGreaterThan(0);
          expect(doc.category).toBe(cat.id);
        }
      }
    });
  });

  describe("getRequiredDocuments", () => {
    it("returns all universal documents for a standard purchase", () => {
      const docs = getRequiredDocuments("purchase", "fixed");
      // Should include docs with loanTypes: ["all"]
      const universalCount = TX_DOCUMENT_CATEGORIES.flatMap((c) => c.docs).filter(
        (d) => d.loanTypes.includes("all"),
      ).length;
      expect(docs.length).toBeGreaterThanOrEqual(universalCount);
    });

    it("includes ARM disclosure for ARM loan type", () => {
      const docs = getRequiredDocuments("purchase", "arm");
      const armDoc = docs.find((d) => d.name.includes("ARM Program"));
      expect(armDoc).toBeDefined();
      expect(armDoc!.rule).toContain("1026.19(b)");
    });

    it("includes home equity docs for home_equity_50a6 purpose", () => {
      const docs = getRequiredDocuments("home_equity_50a6", "fixed");
      const heDoc = docs.find((d) => d.name.includes("12-Day Notice"));
      expect(heDoc).toBeDefined();
    });

    it("includes rescission for refinance", () => {
      const docs = getRequiredDocuments("refinance", "fixed");
      const rescission = docs.find((d) => d.name.includes("Right to Rescind"));
      expect(rescission).toBeDefined();
    });

    it("excludes home equity 50(a)(6) docs for standard purchase", () => {
      const docs = getRequiredDocuments("purchase", "fixed");
      const heDoc = docs.find((d) => d.name.includes("12-Day Notice"));
      expect(heDoc).toBeUndefined();
    });

    it("returns at least 20 documents for any loan", () => {
      const docs = getRequiredDocuments("purchase", "fixed");
      expect(docs.length).toBeGreaterThanOrEqual(20);
    });
  });

  describe("getDocumentsByCategory", () => {
    it("returns the same categories as TX_DOCUMENT_CATEGORIES", () => {
      const categories = getDocumentsByCategory();
      expect(categories).toEqual(TX_DOCUMENT_CATEGORIES);
    });
  });
});
