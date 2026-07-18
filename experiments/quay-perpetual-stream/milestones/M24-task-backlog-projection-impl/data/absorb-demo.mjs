// One-time demonstration script (M24 iteration-0) — run with CWD = repo root so
// process.cwd() + "/tasks" resolves to the live task store.
import { createStore } from "../../../packages/quay-native/src/store.js";

const store = createStore(process.cwd() + "/tasks");

// ABSORB: this milestone (M24) reaching its own iteration-0 report is the completion event.
// Confirm milestone label, append Execution record, flip status ready -> done.
const before = store.get("exp5-M-TASK-BACKLOG-PROJECTION-IMPL");
const record = `\n## Execution record\nMilestone: M24-task-backlog-projection-impl\nIteration: iteration-0 (single build pass covering Phases 1-4)\nBranch: exp5-m24-iteration-0\nOutcome: Phases 1-4 landed — DIR-projection anti-drift script updated (id-scheme/ignore-sections/resolved-synonym), M01-M12 backfill + forward-looking candidates written, OUTER-LOOP.md SELECT/ABSORB wiring authored, backlog-regen + backlog-projection anti-drift checks built, Web UI verified, test suite run.
Value: Δv̂ = 0 (method infra, no VT chart cell).
`;
const afterRecord = store.write("exp5-M-TASK-BACKLOG-PROJECTION-IMPL", {
  body: before.body + record,
});
const after = store.write("exp5-M-TASK-BACKLOG-PROJECTION-IMPL", {
  labels: afterRecord.labels,
  status: "done",
});
console.log("=== ABSORBED task (status ready -> done, Execution record appended) ===");
console.log(JSON.stringify(after, null, 2));
