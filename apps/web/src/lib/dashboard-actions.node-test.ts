import assert from "node:assert/strict";
import { buildDashboardQuery, deriveTopActions, hasActionableWork } from "./dashboard-setup";

// ─── buildDashboardQuery ───
assert.equal(buildDashboardQuery({}), "", "no filters => empty query");
assert.equal(buildDashboardQuery({ state: "TX" }), "?state=TX");
assert.equal(
  buildDashboardQuery({ state: "TX", status: "processing", from: "2026-01-01", to: "2026-03-31" }),
  "?state=TX&status=processing&from=2026-01-01&to=2026-03-31",
);
// empty strings are treated as unset
assert.equal(buildDashboardQuery({ state: "", status: "" }), "");

// ─── deriveTopActions ───
const empty = deriveTopActions({ attentionLoans: [], programs: [], upcomingDeadlines: [], passingLoans: 0 });
assert.deepEqual(empty.map((a) => a.id), ["upload-docs", "overdue-programs", "file-reports", "advance-loans"]);
assert.equal(empty.every((a) => a.count === 0), true);
assert.equal(hasActionableWork({ attentionLoans: [], programs: [], upcomingDeadlines: [], passingLoans: 0 }), false);

const populated = deriveTopActions({
  attentionLoans: [
    { id: "loan-1", docs_required: 5, docs_complete: 2 }, // missing docs
    { id: "loan-2", docs_required: 3, docs_complete: 3 }, // complete, not counted
  ],
  programs: [{ status: "overdue", count: 2 }, { status: "current", count: 1 }],
  upcomingDeadlines: [{}, {}, {}],
  passingLoans: 4,
});
const byId = Object.fromEntries(populated.map((a) => [a.id, a]));
assert.equal(byId["upload-docs"].count, 1, "one loan has missing docs");
assert.equal(byId["overdue-programs"].count, 2);
assert.equal(byId["file-reports"].count, 3);
assert.equal(byId["advance-loans"].count, 4);
// single missing-doc loan links straight to that loan; otherwise to the filtered list
assert.equal(byId["upload-docs"].href, "/loans/loan-1");

const multi = deriveTopActions({
  attentionLoans: [
    { id: "a", docs_required: 5, docs_complete: 0 },
    { id: "b", docs_required: 5, docs_complete: 0 },
  ],
  programs: [],
  upcomingDeadlines: [],
  passingLoans: 0,
});
assert.equal(multi.find((a) => a.id === "upload-docs")!.href, "/loans?score=critical");
assert.equal(hasActionableWork({ attentionLoans: [{ id: "a", docs_required: 1, docs_complete: 0 }], programs: [], upcomingDeadlines: [], passingLoans: 0 }), true);

console.log("dashboard-actions.node-test.ts passed");
