import { describe, it, expect } from "vitest";
import {
  parseTab,
  checklistRowState,
  filterChecklist,
  filterTasks,
  isTaskOverdue,
  deriveTxLogFields,
  txLogMissingFields,
  splitGateReadiness,
  validateNote,
  timelineEventLabel,
  timelineCategory,
  nextActionTab,
  type ChecklistRow,
  type TaskRow,
} from "./loan-workspace";

describe("parseTab", () => {
  it("maps a valid query param, falls back to overview", () => {
    expect(parseTab("tasks")).toBe("tasks");
    expect(parseTab("transaction-log")).toBe("transaction-log");
    expect(parseTab("bogus")).toBe("overview");
    expect(parseTab(null)).toBe("overview");
  });
});

const row = (o: Partial<ChecklistRow>): ChecklistRow => ({ documentType: "d", displayName: "Doc", isMandatory: true, source: "state", pipelineStage: "processing", uploaded: false, status: null, uploadStatus: null, ...o });

describe("checklistRowState + filterChecklist", () => {
  it("derives row state and never lets invalid documents satisfy", () => {
    expect(checklistRowState(row({ uploaded: true, uploadStatus: "uploaded" }))).toBe("uploaded");
    expect(checklistRowState(row({ uploaded: true, uploadStatus: "rejected" }))).toBe("invalid");
    expect(checklistRowState(row({ status: "na" }))).toBe("not_applicable");
    expect(checklistRowState(row({}))).toBe("missing");
  });

  it("filters by missing / required / invalid / federal / current stage", () => {
    const items = [
      row({ displayName: "App", source: "federal", uploaded: true, uploadStatus: "signed" }),
      row({ displayName: "Flood", source: "state", isMandatory: false }),
      row({ displayName: "ID", source: "state", uploaded: true, uploadStatus: "expired" }),
      row({ displayName: "Survey", source: "state", pipelineStage: "closing" }),
    ];
    expect(filterChecklist(items, "missing", "").map((i) => i.displayName)).toEqual(["Flood", "Survey"]);
    expect(filterChecklist(items, "required", "").length).toBe(3);
    expect(filterChecklist(items, "invalid", "").map((i) => i.displayName)).toEqual(["ID"]);
    expect(filterChecklist(items, "federal", "").map((i) => i.displayName)).toEqual(["App"]);
    expect(filterChecklist(items, "current_stage", "", "processing").map((i) => i.displayName)).toEqual(["App", "Flood", "ID"]);
  });

  it("searches by name and type", () => {
    const items = [row({ displayName: "Flood Cert", documentType: "flood" }), row({ displayName: "Appraisal", documentType: "appraisal" })];
    expect(filterChecklist(items, "all", "flood").map((i) => i.displayName)).toEqual(["Flood Cert"]);
  });
});

describe("filterTasks", () => {
  const now = new Date("2026-06-26T00:00:00Z");
  const tasks: TaskRow[] = [
    { status: "open", auto_key: "auto:doc", due_at: "2026-06-01" },   // auto, overdue
    { status: "complete", auto_key: null, due_at: null },              // manual, complete
    { status: "in_progress", auto_key: null, due_at: "2026-12-01" },  // manual, open, not overdue
  ];
  it("filters open / overdue / auto / manual / complete", () => {
    expect(filterTasks(tasks, "open", now).length).toBe(2);
    expect(filterTasks(tasks, "overdue", now).length).toBe(1);
    expect(filterTasks(tasks, "auto", now).length).toBe(1);
    expect(filterTasks(tasks, "manual", now).length).toBe(2);
    expect(filterTasks(tasks, "complete", now).length).toBe(1);
  });
  it("isTaskOverdue ignores completed tasks", () => {
    expect(isTaskOverdue({ status: "complete", auto_key: null, due_at: "2020-01-01" }, now)).toBe(false);
  });
});

describe("transaction-log fields", () => {
  it("derives all 21 fields and flags missing required ones", () => {
    const fields = deriveTxLogFields({ loan_number: "TX-1", borrower_last_name: "Lee", borrower_first_name: "Sam", property_state: "TX" });
    expect(fields.length).toBe(21);
    expect(fields.find((f) => f.key === "applicantName")?.value).toBe("Lee, Sam");
    const missing = txLogMissingFields({ loan_number: "TX-1" });
    // cash-out (conditional) is never counted as missing
    expect(missing.some((f) => f.key === "texasCashOut")).toBe(false);
    expect(missing.some((f) => f.key === "propertyStreet")).toBe(true);
  });
  it("maps Texas cash-out classification", () => {
    expect(deriveTxLogFields({ texas_cashout_type: "tx_50a6" }).find((f) => f.key === "texasCashOut")?.value).toBe("50(a)(6)");
  });
});

describe("splitGateReadiness", () => {
  it("separates blockers/warnings and forbids overriding invalid transitions", () => {
    const ok = splitGateReadiness({ canAdvance: false, transitionValid: true, blockers: ["b"], warnings: ["w"], unsatisfied: [{ documentType: "x", displayName: "X" }] });
    expect(ok.blockers).toEqual(["b"]);
    expect(ok.warnings).toEqual(["w"]);
    expect(ok.canOverride).toBe(true);
    const invalid = splitGateReadiness({ canAdvance: false, transitionValid: false });
    expect(invalid.invalidTransition).toBe(true);
    expect(invalid.canOverride).toBe(false);
  });
});

describe("validateNote", () => {
  it("rejects empty notes, accepts content", () => {
    expect(validateNote("   ")).toBeTruthy();
    expect(validateNote("")).toBeTruthy();
    expect(validateNote("Called borrower")).toBeNull();
  });
});

describe("timeline labels + categories", () => {
  it("labels known events and categorizes them", () => {
    expect(timelineEventLabel("document_uploaded")).toBe("Document uploaded");
    expect(timelineEventLabel("mystery_event")).toBe("Mystery Event");
    expect(timelineCategory("document_uploaded")).toBe("documents");
    expect(timelineCategory("note_created")).toBe("notes");
    expect(timelineCategory("stage_advanced")).toBe("stage");
    expect(timelineCategory("loan_created")).toBe("loan");
  });
});

describe("nextActionTab", () => {
  it("routes overview actions to the right tab", () => {
    expect(nextActionTab({ label: "Resolve overdue tasks", href: "/loans/1?tab=tasks" })).toBe("tasks");
    expect(nextActionTab({ label: "Upload 2 required document(s)", href: "/loans/1" })).toBe("checklist");
    expect(nextActionTab({ label: "Complete transaction log fields", href: "/loans/1" })).toBe("transaction-log");
    expect(nextActionTab({ label: "Clear closing conditions", href: "/loans/1" })).toBe("stage-gate");
  });
});
