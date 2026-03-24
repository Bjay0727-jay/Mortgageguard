import { describe, it, expect } from "vitest";
import {
  PIPELINE_STAGES,
  LOAN_PURPOSES,
  LOAN_PRODUCTS,
  LOAN_TYPES,
  USER_ROLES,
  SCORE_THRESHOLDS,
  getScoreStatus,
  DOC_WEIGHTS,
  TX_LOG_FIELDS,
  QUARTERLY_DEADLINES,
  REQUIRED_PROGRAMS,
  BRAND,
} from "./index";

describe("PIPELINE_STAGES", () => {
  it("has 5 ordered stages", () => {
    expect(PIPELINE_STAGES).toEqual([
      "application",
      "processing",
      "underwriting",
      "closing",
      "post_close",
    ]);
  });
});

describe("LOAN_PURPOSES", () => {
  it("includes purchase and refinance", () => {
    expect(LOAN_PURPOSES).toContain("purchase");
    expect(LOAN_PURPOSES).toContain("refinance");
  });

  it("includes TX-specific home_equity_50a6", () => {
    expect(LOAN_PURPOSES).toContain("home_equity_50a6");
  });
});

describe("LOAN_PRODUCTS", () => {
  it("includes major GSE products", () => {
    expect(LOAN_PRODUCTS).toContain("conventional");
    expect(LOAN_PRODUCTS).toContain("fha");
    expect(LOAN_PRODUCTS).toContain("va");
    expect(LOAN_PRODUCTS).toContain("usda");
  });
});

describe("LOAN_TYPES", () => {
  it("includes fixed and arm", () => {
    expect(LOAN_TYPES).toContain("fixed");
    expect(LOAN_TYPES).toContain("arm");
  });
});

describe("USER_ROLES", () => {
  it("has 6 roles", () => {
    expect(USER_ROLES).toHaveLength(6);
  });

  it("includes company_admin and compliance_officer", () => {
    expect(USER_ROLES).toContain("company_admin");
    expect(USER_ROLES).toContain("compliance_officer");
  });
});

describe("getScoreStatus", () => {
  it("returns passing for score >= 80", () => {
    expect(getScoreStatus(80)).toBe("passing");
    expect(getScoreStatus(100)).toBe("passing");
    expect(getScoreStatus(95)).toBe("passing");
  });

  it("returns warning for score >= 50 and < 80", () => {
    expect(getScoreStatus(50)).toBe("warning");
    expect(getScoreStatus(79)).toBe("warning");
    expect(getScoreStatus(65)).toBe("warning");
  });

  it("returns critical for score < 50", () => {
    expect(getScoreStatus(0)).toBe("critical");
    expect(getScoreStatus(49)).toBe("critical");
    expect(getScoreStatus(25)).toBe("critical");
  });
});

describe("DOC_WEIGHTS", () => {
  it("mandatory > state_specific > recommended", () => {
    expect(DOC_WEIGHTS.mandatory).toBeGreaterThan(DOC_WEIGHTS.state_specific);
    expect(DOC_WEIGHTS.state_specific).toBeGreaterThan(DOC_WEIGHTS.recommended);
  });
});

describe("TX_LOG_FIELDS", () => {
  it("has 17 fields per TX-SML requirement", () => {
    expect(TX_LOG_FIELDS).toHaveLength(17);
  });

  it("includes loan_number and borrower_name", () => {
    expect(TX_LOG_FIELDS).toContain("loan_number");
    expect(TX_LOG_FIELDS).toContain("borrower_name");
  });
});

describe("QUARTERLY_DEADLINES", () => {
  it("has all 4 quarters", () => {
    expect(QUARTERLY_DEADLINES.Q1).toBeDefined();
    expect(QUARTERLY_DEADLINES.Q2).toBeDefined();
    expect(QUARTERLY_DEADLINES.Q3).toBeDefined();
    expect(QUARTERLY_DEADLINES.Q4).toBeDefined();
  });

  it("each quarter has period and due date", () => {
    for (const q of Object.values(QUARTERLY_DEADLINES)) {
      expect(q.period).toBeTruthy();
      expect(q.due).toBeTruthy();
    }
  });
});

describe("REQUIRED_PROGRAMS", () => {
  it("has 5 required programs", () => {
    expect(REQUIRED_PROGRAMS).toHaveLength(5);
  });

  it("includes AML program", () => {
    const aml = REQUIRED_PROGRAMS.find((p) => p.name.includes("Anti-Money"));
    expect(aml).toBeDefined();
    expect(aml!.requiredBy).toBe("federal");
  });
});

describe("BRAND", () => {
  it("has royal blue as primary color", () => {
    expect(BRAND.royal).toBe("#1B3A6B");
  });

  it("all colors are valid hex", () => {
    for (const color of Object.values(BRAND)) {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
