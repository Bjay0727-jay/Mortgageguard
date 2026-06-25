import assert from "node:assert/strict";
import { buildSetupChecklist, getSetupProgress, isDefaultAdmin } from "./dashboard-setup";

const emptyItems = buildSetupChecklist({
  totalLoans: 0,
  upcomingDeadlinesCount: 0,
  programs: [],
  user: { name: "Administrator", email: "admin@example.com" },
});

assert.deepEqual(emptyItems.map((item) => item.title), [
  "Change default admin password",
  "Confirm company profile",
  "Load Texas compliance rules",
  "Create first loan",
  "Upload required compliance program documents",
  "Invite team members",
  "Connect LOS integration",
]);
assert.equal(emptyItems.every((item) => item.complete === false), true);

const progressedItems = buildSetupChecklist({
  totalLoans: 1,
  upcomingDeadlinesCount: 0,
  programs: [{ status: "current", count: 1 }],
  user: { name: "Compliance Admin", email: "user@example.com" },
});
assert.deepEqual(getSetupProgress(progressedItems), { complete: 3, total: 7, percent: 43 });
assert.equal(isDefaultAdmin({ name: "Administrator", email: "admin@example.com" }), true);
assert.equal(isDefaultAdmin({ name: "Jane Smith", email: "jane@example.com" }), false);
