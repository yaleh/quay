// Unit tests for milestone-preparation-check.mjs — DIR-117 unit C. Exercises the fixture-fresh
// PASS path plus 4 independent negative mutations (Proposal, charter, Plan, checked source file),
// each expected to fail with its OWN distinct actionable code, and confirms an unrelated-file
// change does not cause a false invalidation (the check never even reads unrelated files).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildReceipt, checkPreparation, sha256,
  computeTouchesExpansion, parsePlanStages, validatePlanStructure, checkProvenanceDistinctness,
  computeMetricsForReceipt, queryTelemetryReport,
  computeCapacityReport, percentile, isCacheableTerminalShape, _walkJsonFiles,
} from "../scripts/milestone-preparation-check.ts";
import { CACHEABLE_TERMINALS } from "../scripts/proposal-convergence.ts";

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures", "preparation");
const TASK = path.join(FIXTURES, "fixture-task.md");
const CHARTER = path.join(FIXTURES, "fixture-charter.md");
const PLAN = path.join(FIXTURES, "fixture-plan.md");
const PLAN_MALFORMED = path.join(FIXTURES, "fixture-plan-malformed.md");
const SOURCE = path.join(FIXTURES, "fixture-source.ts");

function freshTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prep-check-"));
}

// DIR-117 iteration-2 item 2: a real, DISTINCT run-identity provenance object — mirrors what
// prepare-milestone.js's Receipt phase now builds from each phase's own captured
// `$CLAUDE_CODE_SESSION_ID` (never a caller-asserted "trust me" boolean).
function makeDistinctProvenance() {
  return {
    proposalAuthors: [{ authorIdx: 1, sessionId: "sess-author-1" }, { authorIdx: 2, sessionId: "sess-author-2" }],
    adjudicator: { sessionId: "sess-adjudicator" },
    proposalReviewer: { sessionId: "sess-reviewer" },
    planAuthor: { sessionId: "sess-plan-author" },
    planCheckers: [{ round: 1, sessionId: "sess-plan-checker-1" }],
  };
}

function makeFreshReceipt() {
  return buildReceipt({
    taskId: "FIXTURE-PREP-1",
    milestoneId: "M-FIXTURE",
    charterFile: CHARTER,
    taskFile: TASK,
    planFile: PLAN,
    sourceFiles: [SOURCE],
    review: { findings: 0 },
    planCheck: { rounds: 1, findings: 0 },
    touches: [SOURCE],
    provenance: makeDistinctProvenance(),
  });
}

test("sha256: deterministic and content-sensitive", () => {
  assert.equal(sha256("a"), sha256("a"));
  assert.notEqual(sha256("a"), sha256("b"));
});

test("checkPreparation: PASS — fresh receipt matches current fixture state", () => {
  const dir = freshTmpDir();
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.code, "prepared");
});

test("checkPreparation: FAIL — missing receipt file", () => {
  const dir = freshTmpDir();
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile: path.join(dir, "nope.json") });
  assert.equal(result.ok, false);
  assert.equal(result.code, "receipt-missing");
});

test("checkPreparation: FAIL — Proposal changed since preparation (proposal-stale)", () => {
  const dir = freshTmpDir();
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  const mutatedTask = path.join(dir, "task.md");
  fs.writeFileSync(mutatedTask, fs.readFileSync(TASK, "utf8").replace("This is a substantive", "MUTATED substantive"));
  const result = checkPreparation({ taskFile: mutatedTask, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "proposal-stale");
});

test("checkPreparation: FAIL — charter changed since preparation (charter-stale)", () => {
  const dir = freshTmpDir();
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  const mutatedCharter = path.join(dir, "charter.md");
  fs.writeFileSync(mutatedCharter, fs.readFileSync(CHARTER, "utf8") + "\nMUTATED\n");
  const result = checkPreparation({ taskFile: TASK, charterFile: mutatedCharter, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "charter-stale");
});

test("checkPreparation: FAIL — checked Plan file changed since preparation (plan-stale)", () => {
  const dir = freshTmpDir();
  const receipt = makeFreshReceipt();
  const mutatedPlan = path.join(dir, "plan.md");
  fs.copyFileSync(PLAN, mutatedPlan);
  receipt.planFile = mutatedPlan;
  // Rewrite the task's Plan reference so it points at the mutated path (mirrors what a real
  // prepared task would do), then mutate the plan file's content AFTER the receipt was built.
  const taskWithPlanRef = path.join(dir, "task.md");
  fs.writeFileSync(taskWithPlanRef, fs.readFileSync(TASK, "utf8").replace(PLAN, mutatedPlan));
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  fs.writeFileSync(mutatedPlan, fs.readFileSync(mutatedPlan, "utf8") + "\nMUTATED\n");
  const result = checkPreparation({ taskFile: taskWithPlanRef, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "plan-stale");
});

test("checkPreparation: FAIL — checked source file changed since preparation (source-stale)", () => {
  const dir = freshTmpDir();
  const mutatedSource = path.join(dir, "source.ts");
  fs.copyFileSync(SOURCE, mutatedSource);
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1",
    milestoneId: "M-FIXTURE",
    charterFile: CHARTER,
    taskFile: TASK,
    planFile: PLAN,
    sourceFiles: [mutatedSource],
  });
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  fs.writeFileSync(mutatedSource, fs.readFileSync(mutatedSource, "utf8") + "\nexport const extra = 2;\n");
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "source-stale");
});

test("checkPreparation: unrelated file change does NOT invalidate preparation (still PASS)", () => {
  const dir = freshTmpDir();
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  // "Change" a file the receipt never named at all.
  const unrelated = path.join(dir, "unrelated.md");
  fs.writeFileSync(unrelated, "irrelevant content");
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
});

test("checkPreparation: FAIL — nonzero review findings blocks preparation", () => {
  const dir = freshTmpDir();
  const receipt = makeFreshReceipt();
  receipt.review = { findings: 2 };
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "review-nonzero-findings");
});

test("checkPreparation: FAIL — nonzero plan-check findings blocks preparation", () => {
  const dir = freshTmpDir();
  const receipt = makeFreshReceipt();
  receipt.planCheck = { rounds: 3, findings: 1 };
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "plancheck-nonzero-findings");
});

test("checkPreparation: FAIL — Plan still N/A (not yet checked)", () => {
  const dir = freshTmpDir();
  const naTask = path.join(dir, "task-na.md");
  fs.writeFileSync(naTask, fs.readFileSync(TASK, "utf8").replace(/## Plan\n[\s\S]*?\n\n/, "## Plan\nN/A — directive resolved via a milestone\n\n"));
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  const result = checkPreparation({ taskFile: naTask, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "plan-not-checked");
});

test("checkPreparation: FAIL — checked Plan's touch set expands beyond the declared '## Touches'", () => {
  const dir = freshTmpDir();
  const receipt = makeFreshReceipt();
  receipt.touches = [SOURCE, "some/undeclared/path.ts"];
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile, declaredTouches: [SOURCE] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "touches-expanded");
});

// ── DIR-117 iteration-2 item 2: provenance distinctness ────────────────────────────────────────────
test("checkProvenanceDistinctness: FAIL — no provenance at all recorded", () => {
  const r = checkProvenanceDistinctness(null);
  assert.equal(r.ok, false);
  assert.equal(r.code, "provenance-missing");
});

test("checkProvenanceDistinctness: FAIL — incomplete (missing plan-checker)", () => {
  const r = checkProvenanceDistinctness({
    proposalAuthors: [{ authorIdx: 1, sessionId: "a" }],
    adjudicator: { sessionId: "adj" },
    proposalReviewer: { sessionId: "rev" },
    planAuthor: { sessionId: "pa" },
    planCheckers: [],
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "provenance-incomplete");
});

// gap-provenance-sessionid-not-independence-signal (2026-07-28): a shared session id across roles
// is EXPECTED for real prepare-milestone.js dispatches (every agent() sub-dispatch in one Workflow
// run shares the parent session id by construction) and is no longer treated as a failure — the
// check only verifies each role's run identity was recorded, not that ids differ across roles.
test("checkProvenanceDistinctness: PASS — reviewer session equals an author's session (real agent()-in-Workflow shape; presence is what matters, not distinctness)", () => {
  const r = checkProvenanceDistinctness({
    proposalAuthors: [{ authorIdx: 1, sessionId: "same-session" }],
    adjudicator: { sessionId: "adj" },
    proposalReviewer: { sessionId: "same-session" },
    planAuthor: { sessionId: "pa" },
    planCheckers: [{ round: 1, sessionId: "pc" }],
  });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.code, "provenance-recorded");
});

test("checkProvenanceDistinctness: PASS — plan-checker session equals plan-author's session (real agent()-in-Workflow shape; presence is what matters, not distinctness)", () => {
  const r = checkProvenanceDistinctness({
    proposalAuthors: [{ authorIdx: 1, sessionId: "a1" }],
    adjudicator: { sessionId: "adj" },
    proposalReviewer: { sessionId: "rev" },
    planAuthor: { sessionId: "same-session" },
    planCheckers: [{ round: 1, sessionId: "same-session" }],
  });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.code, "provenance-recorded");
});

test("checkProvenanceDistinctness: PASS — every role has its own distinct session id (distinct ids are a valid, just non-required, shape)", () => {
  const r = checkProvenanceDistinctness({
    proposalAuthors: [{ authorIdx: 1, sessionId: "a1" }, { authorIdx: 2, sessionId: "a2" }],
    adjudicator: { sessionId: "adj" },
    proposalReviewer: { sessionId: "rev" },
    planAuthor: { sessionId: "pa" },
    planCheckers: [{ round: 1, sessionId: "pc1" }],
  });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.code, "provenance-recorded");
});

test("checkPreparation: FAIL — receipt has no provenance recorded at all", () => {
  const dir = freshTmpDir();
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    // provenance omitted — this is the exact iteration-0 REFUTED gap.
  });
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "provenance-missing");
});

test("checkPreparation: PASS — receipt's proposal reviewer session matches an author's (real agent()-in-Workflow shape; no longer a failure)", () => {
  const dir = freshTmpDir();
  const receipt = makeFreshReceipt();
  receipt.provenance.proposalReviewer.sessionId = receipt.provenance.proposalAuthors[0].sessionId;
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
});

test("checkPreparation: PASS — fresh receipt with distinct provenance still passes (no false positive)", () => {
  const dir = freshTmpDir();
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
});

// ── DIR-117 iteration-2 item 3: real structural Plan validation ────────────────────────────────────
test("parsePlanStages: extracts stage number/title/AC/files/check from the real fixture Plan", () => {
  const stages = parsePlanStages(fs.readFileSync(PLAN, "utf8"));
  assert.equal(stages.length, 2);
  assert.deepEqual(stages[0].ac, [1]);
  assert.match(stages[0].files, /fixture-source\.ts/);
  assert.match(stages[0].check, /node --check/);
  assert.deepEqual(stages[1].ac, [2]);
  assert.match(stages[1].check, /node --check/); // stage 2 uses "Check:" synonym
});

test("validatePlanStructure: FAIL — no '### Stage N:' blocks at all", () => {
  const r = validatePlanStructure("just prose, no stages", 2);
  assert.equal(r.ok, false);
  assert.equal(r.code, "plan-no-stages");
});

test("validatePlanStructure: FAIL — a stage has no '- AC:' mapping", () => {
  const r = validatePlanStructure("### Stage 1: x\n- Files: a.ts\n- Command: `node a.ts`\n", 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, "plan-stage-missing-ac");
});

test("validatePlanStructure: FAIL — a stage has no '- Files:' entry", () => {
  const r = validatePlanStructure("### Stage 1: x\n- AC: 1\n- Command: `node a.ts`\n", 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, "plan-stage-missing-files");
});

test("validatePlanStructure: FAIL — a stage has no '- Command:'/'- Check:' entry", () => {
  const r = validatePlanStructure("### Stage 1: x\n- AC: 1\n- Files: a.ts\n", 1);
  assert.equal(r.ok, false);
  assert.equal(r.code, "plan-stage-missing-command");
});

test("validatePlanStructure: FAIL — a task AC item is never mapped to any stage (real malformed fixture)", () => {
  const r = validatePlanStructure(fs.readFileSync(PLAN_MALFORMED, "utf8"), 2);
  assert.equal(r.ok, false);
  assert.equal(r.code, "plan-ac-not-mapped");
  assert.match(r.message, /#2/);
});

test("validatePlanStructure: PASS — real fixture Plan maps every AC item to a stage", () => {
  const r = validatePlanStructure(fs.readFileSync(PLAN, "utf8"), 2);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.code, "plan-structure-ok");
});

test("checkPreparation: FAIL — real malformed-Plan fixture is rejected mechanically (plan-ac-not-mapped)", () => {
  const dir = freshTmpDir();
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN_MALFORMED,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(),
  });
  const taskWithMalformedPlanRef = path.join(dir, "task.md");
  fs.writeFileSync(taskWithMalformedPlanRef, fs.readFileSync(TASK, "utf8").replace("fixture-plan.md", "fixture-plan-malformed.md"));
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: taskWithMalformedPlanRef, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "plan-ac-not-mapped");
});

// ── DIR-117 iteration-2 item 4: touches-expansion single-source, reused by concurrent-batch-
// scheduler.ts's real batch re-assembly loop (see concurrent-batch-scheduler.test.mjs) ─────────────
test("computeTouchesExpansion: no receipt touches → no expansion", () => {
  assert.deepEqual(computeTouchesExpansion([], ["a.ts"]), { expanded: [] });
});

test("computeTouchesExpansion: receipt touches fully covered by declared → no expansion", () => {
  assert.deepEqual(computeTouchesExpansion(["a.ts"], ["a.ts", "b.ts"]), { expanded: [] });
});

test("computeTouchesExpansion: receipt touches a path NOT in the declared set → expansion reported", () => {
  assert.deepEqual(computeTouchesExpansion(["a.ts", "c.ts"], ["a.ts"]), { expanded: ["c.ts"] });
});

// ── DIR-125: finding-ledger hash-binding + mechanical convergence-cap re-check ─────────────────────
function makeLedgerFile(dir, ledger, name = "proposal-ledger.json") {
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify(ledger, null, 2));
  return f;
}

test("buildReceipt + checkPreparation: PASS — a zero-blocking ledger hash-binds cleanly", () => {
  const dir = freshTmpDir();
  const ledgerFile = makeLedgerFile(dir, [
    { id: "abc123", subsystem: "s", summary: "x", severity: "minor", blocking: false, everBlocking: false, disposition: "backlog", status: "open" },
  ]);
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), ledgerFile,
    convergence: { highRisk: false, fullSynthesisCount: 1, deltaRounds: 0 },
  });
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.code, "prepared");
});

test("checkPreparation: FAIL — ledger file no longer exists (ledger-missing)", () => {
  const dir = freshTmpDir();
  const ledgerFile = makeLedgerFile(dir, []);
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), ledgerFile,
  });
  fs.unlinkSync(ledgerFile);
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ledger-missing");
});

test("checkPreparation: FAIL — ledger tampered/swapped after preparation (ledger-stale)", () => {
  const dir = freshTmpDir();
  const ledgerFile = makeLedgerFile(dir, [
    { id: "abc123", subsystem: "s", summary: "x", severity: "minor", blocking: false, everBlocking: false, disposition: "backlog", status: "open" },
  ]);
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), ledgerFile,
  });
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  // Tamper: swap in a DIFFERENT ledger content at the same path after the receipt was built —
  // exactly the "pairing a stale ledger with a newer Proposal" failure mode DIR-125 names.
  fs.writeFileSync(ledgerFile, JSON.stringify([{ id: "xyz999", subsystem: "s", summary: "different", blocking: false, disposition: "backlog", status: "open" }]));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ledger-stale");
});

test("checkPreparation: FAIL — ledger still has an open blocking finding (ledger-blocking-findings-open)", () => {
  const dir = freshTmpDir();
  const ledgerFile = makeLedgerFile(dir, [
    { id: "abc123", subsystem: "s", summary: "still open", severity: "blocker", blocking: true, everBlocking: true, disposition: "unresolved", status: "open" },
  ]);
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), ledgerFile,
  });
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "ledger-blocking-findings-open");
});

test("checkPreparation: FAIL — convergence counters exceed the ordinary policy cap (convergence-delta-rounds-exceeded)", () => {
  const dir = freshTmpDir();
  const receipt = makeFreshReceipt();
  receipt.convergence = { highRisk: false, fullSynthesisCount: 1, deltaRounds: 3 };
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "convergence-delta-rounds-exceeded");
});

test("checkPreparation: FAIL — convergence counters record more than one full synthesis (convergence-full-synthesis-exceeded)", () => {
  const dir = freshTmpDir();
  const receipt = makeFreshReceipt();
  receipt.convergence = { highRisk: true, fullSynthesisCount: 2, deltaRounds: 0 };
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "convergence-full-synthesis-exceeded");
});

test("checkPreparation: PASS — highRisk convergence counters at the widened cap (3 delta rounds) are accepted", () => {
  const dir = freshTmpDir();
  const ledgerFile = makeLedgerFile(dir, []);
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), ledgerFile,
    convergence: { highRisk: true, fullSynthesisCount: 1, deltaRounds: 3 },
  });
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
});

test("checkPreparation: backward-compatible — a receipt with NO ledgerFile/convergence at all (pre-DIR-125 shape) still passes on the scalar checks alone", () => {
  const dir = freshTmpDir();
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.code, "prepared");
});

// ── DIR-125: computeMetricsForReceipt — the ONE mechanically-queryable metrics surface ────────────
test("computeMetricsForReceipt: FAIL — no receipt at all (receipt-missing)", () => {
  const dir = freshTmpDir();
  const r = computeMetricsForReceipt({ receiptFile: path.join(dir, "nope.json") });
  assert.equal(r.ok, false);
  assert.equal(r.code, "receipt-missing");
});

test("computeMetricsForReceipt: FAIL — a pre-DIR-125 receipt with no 'convergence' block (convergence-not-recorded)", () => {
  const dir = freshTmpDir();
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  const r = computeMetricsForReceipt({ receiptFile });
  assert.equal(r.ok, false);
  assert.equal(r.code, "convergence-not-recorded");
});

test("computeMetricsForReceipt: PASS — derives all named metrics from a real receipt + ledger", () => {
  const dir = freshTmpDir();
  const ledgerFile = makeLedgerFile(dir, [
    { id: "a", subsystem: "s", summary: "x", severity: "blocker", blocking: false, everBlocking: true, disposition: "backlog", status: "resolved" },
    { id: "b", subsystem: "s", summary: "y", severity: "minor", blocking: false, everBlocking: false, disposition: "plan", status: "open" },
  ]);
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), ledgerFile,
    convergence: {
      highRisk: false, fullSynthesisCount: 1, deltaRounds: 1, proposalReviewRounds: 2,
      terminalReason: "zero-finding", reachedPlanAuthor: true,
      startedAtMs: 1000, endedAtMs: 1000 + 20 * 60 * 1000,
      proposalHashes: [{ round: 0, hash: "h0" }, { round: 1, hash: "h1" }],
    },
  });
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const r = computeMetricsForReceipt({ receiptFile });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.taskId, "FIXTURE-PREP-1");
  assert.equal(r.metrics.fullSynthesisCount, 1);
  assert.equal(r.metrics.proposalReviewRounds, 2);
  assert.equal(r.metrics.reachedPlanAuthor, true);
  assert.equal(r.metrics.prepareWallTimeMs, 20 * 60 * 1000);
  assert.equal(typeof r.metrics.blockingFindingYield, "number");
  assert.equal(typeof r.metrics.proposalChurnRatio, "number");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── DIR-126-D/M203 Claim A.5 — --telemetry / telemetry-stale / telemetry-missing (mirrors the
// existing ledger tests above verbatim, structurally). ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function makeTelemetryFile(dir, record, name = "telemetry-record.json") {
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify(record, null, 2));
  return f;
}
function fixtureTelemetryRecord(overrides = {}) {
  return {
    schemaVersion: 2, recordId: "r1", attemptId: "r1", generationId: "g1",
    admission: { key: "k", ownerExecutionId: "o", fencingToken: 0, acquiredAt: 1000 },
    workspace: ".", taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", class: "development", highRisk: false,
    hashes: { charter: "c", taskContract: "t", proposal: "p", reviewPolicy: "r" },
    decision: { kind: "not-evaluated" },
    contentAgentDispatchCount: 0, contentAgentMs: 0,
    terminal: { outcome: "prepared", reason: "prepared", phase: "Receipt", cacheable: false },
    leaseRelease: { attempted: true, ok: true, reason: "prepared" },
    sessionId: null, recordedAtMs: 1000, telemetryWriteOk: true,
    ...overrides,
  };
}

test("buildReceipt + checkPreparation: PASS — a telemetry record hash-binds cleanly (Claim A.5)", () => {
  const dir = freshTmpDir();
  const telemetryFile = makeTelemetryFile(dir, fixtureTelemetryRecord());
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), telemetryFile,
  });
  assert.ok(receipt.hashes.telemetry);
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.code, "prepared");
});

test("checkPreparation: FAIL — telemetry file no longer exists (telemetry-missing)", () => {
  const dir = freshTmpDir();
  const telemetryFile = makeTelemetryFile(dir, fixtureTelemetryRecord());
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), telemetryFile,
  });
  fs.unlinkSync(telemetryFile);
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "telemetry-missing");
});

test("checkPreparation: FAIL — telemetry record hand-tampered post-receipt (telemetry-stale) — instrumentation can never turn a failed preparation into a falsely-certified prepared", () => {
  const dir = freshTmpDir();
  const telemetryFile = makeTelemetryFile(dir, fixtureTelemetryRecord());
  const receipt = buildReceipt({
    taskId: "FIXTURE-PREP-1", milestoneId: "M-FIXTURE", charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
    sourceFiles: [SOURCE], review: { findings: 0 }, planCheck: { rounds: 1, findings: 0 }, touches: [SOURCE],
    provenance: makeDistinctProvenance(), telemetryFile,
  });
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  fs.writeFileSync(telemetryFile, JSON.stringify(fixtureTelemetryRecord({ terminal: { outcome: "needs-human", reason: "TAMPERED", phase: "Receipt", cacheable: false } })));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "telemetry-stale");
});

test("checkPreparation: backward-compatible — a receipt naming NO telemetryFile (pre-DIR-126-D shape) skips the telemetry block entirely and still passes (AC23)", () => {
  const receiptFile = path.join(freshTmpDir(), "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(makeFreshReceipt(), null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, true, result.message);
  assert.equal(result.code, "prepared");
});

// AC23: existing M195/M197/M200/M201/M202-shaped fixtures (predating this child, none passing
// --telemetry) are re-run and stay GREEN unmodified. The 5 real, already-landed receipts on disk
// (milestones/{M195,M197,M200,M201,M202}/preparation.json) can't literally be re-checked against
// their own historical hashes — the tasks/charters/plans they were computed against have since
// evolved (landed, edited) — so "re-run" here means: reconstruct the REAL field-shape each of
// those 5 receipts actually has (confirmed via direct read of the real files on disk), as a fresh
// fixture hashed against CURRENT fixture files, and confirm checkPreparation still accepts each
// shape unmodified. Two real, distinct historical shapes exist: M195/M200 (ledgerFile + hashes.ledger
// present) and M197/M201/M202 (no ledger at all) — both always predate telemetryFile, confirmed via
// `python3 -c "import json; ..."` reading all 5 real files: zero have a telemetryFile key.
for (const m of ["M195", "M197", "M200", "M201", "M202"]) {
  const hasLedger = m === "M195" || m === "M200";
  test(`checkPreparation: backward-compat regression — ${m}-shaped receipt (${hasLedger ? "with" : "without"} ledger, no telemetryFile, real historical shape) stays GREEN unmodified (AC23)`, () => {
    const real = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "..", "..", "milestones", m, "preparation.json"), "utf8"));
    assert.equal("telemetryFile" in real, false, `${m}'s real receipt must predate telemetryFile for this regression fixture to be honest`);
    assert.equal(("ledger" in (real.hashes || {})), hasLedger, `${m}'s real hashes.ledger presence must match the historical shape being tested`);

    const dir = freshTmpDir();
    const ledgerFile = hasLedger ? makeLedgerFile(dir, [{ id: "hist1", subsystem: "s", summary: "historical finding", blocking: false, disposition: "backlog", status: "open" }]) : undefined;
    const receipt = buildReceipt({
      taskId: `FIXTURE-${m}-SHAPE`, milestoneId: m, charterFile: CHARTER, taskFile: TASK, planFile: PLAN,
      sourceFiles: [SOURCE], review: real.review, planCheck: real.planCheck, touches: [SOURCE],
      provenance: makeDistinctProvenance(), ledgerFile,
    });
    assert.equal("telemetryFile" in receipt ? receipt.telemetryFile : null, null, "reconstructed fixture must also have no telemetryFile — matching the real historical shape");
    assert.equal(("ledger" in receipt.hashes), hasLedger);
    const receiptFile = path.join(dir, "preparation.json");
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
    const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
    assert.equal(result.ok, true, result.message);
    assert.equal(result.code, "prepared");
  });
}

// ── Claim B.1 — queryTelemetryReport / --telemetry-report <milestoneId> ────────────────────────
test("queryTelemetryReport: zero matching records -> {ok:true, code:'no-records'}, never a crash (AC22)", () => {
  const dir = freshTmpDir();
  const result = queryTelemetryReport({ workspace: dir, milestoneId: "M-NOTHING-HERE" });
  assert.equal(result.ok, true);
  assert.equal(result.code, "no-records");
  assert.equal(result.milestoneId, "M-NOTHING-HERE");
});

test("queryTelemetryReport: filters by the record's OWN embedded milestoneId, not directory layout — a re-charter'd taskId under the same dir with a different milestoneId is excluded", () => {
  const dir = freshTmpDir();
  const taskDir = path.join(dir, "milestones", "prepare-telemetry", "DIR-X");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "rec-m203.json"), JSON.stringify(fixtureTelemetryRecord({ recordId: "rec-m203", milestoneId: "M203" })));
  fs.writeFileSync(path.join(taskDir, "rec-m204.json"), JSON.stringify(fixtureTelemetryRecord({ recordId: "rec-m204", milestoneId: "M204" })));
  const result = queryTelemetryReport({ workspace: dir, milestoneId: "M203" });
  assert.equal(result.ok, true);
  assert.equal(result.code, "records-found");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].recordId, "rec-m203");
});

test("queryTelemetryReport: malformed JSON files under the tree are skipped, never crash the scan", () => {
  const dir = freshTmpDir();
  const taskDir = path.join(dir, "milestones", "prepare-telemetry", "DIR-X");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "good.json"), JSON.stringify(fixtureTelemetryRecord({ recordId: "good", milestoneId: "M203" })));
  fs.writeFileSync(path.join(taskDir, "bad.json"), "{ not valid json");
  const result = queryTelemetryReport({ workspace: dir, milestoneId: "M203" });
  assert.equal(result.ok, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].recordId, "good");
});

// ── AC21: end-to-end via the REAL write path (proposal-convergence.ts's --record-generation CLI)
// then read back via THIS module's --telemetry-report CLI — not a mocked reader on either side.
test("AC21: --telemetry-report end-to-end — write via the real proposal-convergence.ts CLI, read back via THIS module's --telemetry-report CLI, byte-for-byte match", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const CONVERGENCE_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "proposal-convergence.ts");
  const PREP_CHECK_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "milestone-preparation-check.ts");
  const dir = freshTmpDir();
  const taskId = "DIR-126-D-E2E-FIXTURE";
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), `---\nid: ${taskId}\ntitle: e2e fixture\nstatus: todo\n---\n## Proposal\n\nfixture\n\n## Acceptance Criteria\n\n- [ ] x\n\n## Definition of Done\n\n- [ ] x\n\n## Touches\n\n- x\n`);
  const charterFile = path.join(dir, "charter.md");
  fs.writeFileSync(charterFile, "fixture charter\n");
  const leaseFile = path.join(dir, ".quay", "prepare-leases", `${taskId}.json`);
  fs.mkdirSync(path.dirname(leaseFile), { recursive: true });
  fs.writeFileSync(leaseFile, JSON.stringify({ ownerExecutionId: "sess-e2e", fencingToken: 0, acquiredAt: 1000, key: "e2e-key" }));

  const writeOut = JSON.parse(execFileSync("node", ["--experimental-strip-types", CONVERGENCE_SCRIPT,
    "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
    "--terminalPhase", "PlanAuthor", "--outcome", "revision-needed", "--reason", "plan-author-failed", "--cacheable", "false",
    "--milestoneId", "M-E2E-REPORT",
  ], { encoding: "utf8" }).trim());
  assert.equal(writeOut.ok, true);
  assert.equal(writeOut.telemetryWriteOk, true);
  const writtenRecord = JSON.parse(fs.readFileSync(writeOut.telemetryFile, "utf8"));

  const reportOut = JSON.parse(execFileSync("node", ["--experimental-strip-types", PREP_CHECK_SCRIPT,
    "--telemetry-report", "M-E2E-REPORT", "--workspace", dir,
  ], { encoding: "utf8" }));
  assert.equal(reportOut.ok, true);
  assert.equal(reportOut.code, "records-found");
  assert.equal(reportOut.records.length, 1);
  assert.deepEqual(reportOut.records[0], writtenRecord);
});

test("AC22 (CLI): --telemetry-report <milestoneId> with zero matches returns {ok:true, code:'no-records'} via the real CLI, exit 0", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const PREP_CHECK_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "milestone-preparation-check.ts");
  const dir = freshTmpDir();
  const out = execFileSync("node", ["--experimental-strip-types", PREP_CHECK_SCRIPT, "--telemetry-report", "M-NOTHING", "--workspace", dir], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.code, "no-records");
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── DIR-126-E/M204 — --capacity-report / computeCapacityReport: read-only capacity aggregation
// over BOTH checked-in artifact populations (telemetry records + preparation receipts). Every
// fixture below is a distinct AC/DoD clause of tasks/DIR-126-E.md; the pre-existing
// queryTelemetryReport tests ABOVE double as the C7 byte-for-byte regression suite for the
// _walkJsonFiles extraction (they were written before the refactor and pass against it unchanged).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const REPO_ROOT_E = path.resolve(import.meta.dirname, "..", "..", "..");
const PREP_CHECK_SCRIPT_E = path.join(REPO_ROOT_E, "experiments", "quay-perpetual-stream", "scripts", "milestone-preparation-check.ts");
const MIRROR_SCRIPT_E = path.join(REPO_ROOT_E, "plugin", "scripts", "milestone-preparation-check.ts");

// A cold telemetry record with the CURRENT schema's real shape: contentAgentDispatchCount/
// contentAgentMs null (never 0 — that shape is reuse-terminal/not-evaluated only).
function capRecord(overrides = {}) {
  return fixtureTelemetryRecord({
    decision: { kind: "cold", reason: null, priorGenerationId: null, priorReason: null, createsContentGeneration: false },
    contentAgentDispatchCount: null,
    contentAgentMs: null,
    terminal: { outcome: "revision-needed", reason: "split-recommended", phase: "ProposalReview", cacheable: true },
    ...overrides,
  });
}

function capReceipt({ taskId, milestoneId, startedAtMs, endedAtMs, highRisk = false, convergence }) {
  return {
    taskId,
    milestoneId,
    convergence: convergence === undefined
      ? {
          fullSynthesisCount: 1, deltaRounds: 0, highRisk,
          startedAtMs, endedAtMs, reachedPlanAuthor: true,
          terminalReason: "zero-finding", proposalHashes: [{ round: 1, hash: "h1" }],
        }
      : convergence,
  };
}

function makeCapacityWorkspace({ telemetry = [], receipts = {}, absorbDirs = [], malformedTelemetryPaths = [] } = {}) {
  const dir = freshTmpDir();
  const tRoot = path.join(dir, "milestones", "prepare-telemetry");
  for (const rec of telemetry) {
    const taskDir = path.join(tRoot, rec.taskId || "TASK-X");
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, `${rec.recordId}.json`), JSON.stringify(rec, null, 2));
  }
  for (const rel of malformedTelemetryPaths) {
    const p = path.join(tRoot, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "{ not valid json");
  }
  for (const [m, receipt] of Object.entries(receipts)) {
    const mDir = path.join(dir, "milestones", m);
    fs.mkdirSync(mDir, { recursive: true });
    fs.writeFileSync(path.join(mDir, "preparation.json"), JSON.stringify(receipt, null, 2));
  }
  for (const m of absorbDirs) {
    const mDir = path.join(dir, "milestones", m);
    fs.mkdirSync(mDir, { recursive: true });
    fs.writeFileSync(path.join(mDir, "absorb-entry.md"), `## ${m} ABSORB entry\n`);
  }
  return dir;
}

// A baseline workspace that clears the --min-samples 3 gate on BOTH populations: 3 telemetry
// records (2 distinct taskIds) + 3 receipts. Fixtures focused on ONE behavior extend this shape.
function baselineWorkspace() {
  return makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "t-a1", taskId: "TASK-A", milestoneId: "M-F1", hashes: { charter: "c1", taskContract: "t1", proposal: "p1", reviewPolicy: "r1" }, admission: { key: ".::TASK-A", ownerExecutionId: "o", fencingToken: 0, acquiredAt: 0 }, recordedAtMs: 60000 }),
      capRecord({ recordId: "t-a2", taskId: "TASK-A", milestoneId: "M-F1", hashes: { charter: "c1", taskContract: "t1", proposal: "p2", reviewPolicy: "r1" }, admission: { key: ".::TASK-A", ownerExecutionId: "o", fencingToken: 1, acquiredAt: 0 }, recordedAtMs: 120000 }),
      capRecord({ recordId: "t-b1", taskId: "TASK-B", milestoneId: "M-F2", hashes: { charter: "c9", taskContract: "t9", proposal: "p9", reviewPolicy: "r9" }, admission: { key: ".::TASK-B", ownerExecutionId: "o", fencingToken: 0, acquiredAt: 0 }, recordedAtMs: 300000 }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "TASK-R1", milestoneId: "M1", startedAtMs: 0, endedAtMs: 120000 }),
      M2: capReceipt({ taskId: "TASK-R2", milestoneId: "M2", startedAtMs: 0, endedAtMs: 240000 }),
      M3: capReceipt({ taskId: "TASK-R3", milestoneId: "M3", startedAtMs: 0, endedAtMs: 3600000, highRisk: true }),
    },
  });
}

test("DIR-126-E C2: _walkJsonFiles is ONE shared recursion primitive used by BOTH queryTelemetryReport and computeCapacityReport", () => {
  // Source-level: both functions' bodies call the same helper (not two independent walks).
  assert.match(queryTelemetryReport.toString(), /_walkJsonFiles\(/, "queryTelemetryReport must traverse via _walkJsonFiles");
  assert.match(computeCapacityReport.toString(), /_walkJsonFiles\(/, "computeCapacityReport must traverse via _walkJsonFiles");
  assert.equal(typeof _walkJsonFiles, "function");
  // Behavioral: nested directories are discovered (the recursion survived the extraction).
  const dir = freshTmpDir();
  const nested = path.join(dir, "milestones", "prepare-telemetry", "TASK-N", "sub");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "deep.json"), JSON.stringify(capRecord({ recordId: "deep", milestoneId: "M-DEEP" })));
  const q = queryTelemetryReport({ workspace: dir, milestoneId: "M-DEEP" });
  assert.equal(q.code, "records-found");
  assert.equal(q.records.length, 1);
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry"), minSamples: 1 });
  assert.equal(report.perPopulation.telemetry.count, 1);
  assert.deepEqual(report.perPopulation.telemetry.sampleIds, ["deep"]);
});

test("DIR-126-E: percentile is pinned nearest-rank (deterministic, no interpolation, named in output)", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([5], 50), 5);
  assert.equal(percentile([5], 85), 5);
  // nearest-rank: rank = ceil(p/100 · n), 1-based → [10,20,30,40]: p50 → idx 2 → 20; p85 → idx 4 → 40
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 85), 40);
  assert.equal(percentile([10, 20, 30], 50), 20); // ceil(1.5)=2
});

test("DIR-126-E AC2: full report over >= 3 real-shaped samples — code ok, correct nearest-rank P50/P85, yield, strata, per-task breakdown across >= 2 taskIds (C10)", () => {
  const dir = baselineWorkspace();
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  assert.equal(report.code, "ok");
  assert.equal(report.sampleCount, 6);
  assert.equal(report.perPopulation.telemetry.count, 3);
  assert.equal(report.perPopulation.receipts.count, 3);
  // Two UNPOOLED wall-time blocks with hand-computed nearest-rank values.
  assert.deepEqual(report.wallTime.receiptPrepareMs, { n: 3, minMs: 120000, p50Ms: 240000, p85Ms: 3600000, maxMs: 3600000, method: "nearest-rank" });
  assert.deepEqual(report.wallTime.telemetryProxyMs, { n: 3, minMs: 60000, p50Ms: 120000, p85Ms: 300000, maxMs: 300000, method: "nearest-rank" });
  // C10: aggregation spans ALL task IDs by default — both appear in the per-task breakdown.
  assert.ok(report.perTask["TASK-A"], "TASK-A must appear in perTask");
  assert.ok(report.perTask["TASK-B"], "TASK-B must appear in perTask");
  assert.equal(report.perTask["TASK-A"].telemetryCount, 2);
  assert.equal(report.perTask["TASK-B"].telemetryCount, 1);
  // Yield: 3 attempts, all split-recommended, none prepared.
  assert.equal(report.yield.attempts, 3);
  assert.equal(report.yield.splitOrPreflightRecommended, 3);
  assert.equal(report.yield.prepared, 0);
  assert.equal(report.yield.preparedOverAttempt, 0);
  assert.equal(report.yield.contentGenerationEligible, 3);
  assert.deepEqual(report.yield.byDecisionKind, { cold: 3 });
  assert.deepEqual(report.yield.byTerminalReason, { "ProposalReview/split-recommended": 3 });
  // highRisk stratum carries the receipt side; terminal/decision strata are telemetry-only.
  assert.equal(report.byStratum.highRisk["false"].receiptCount, 2);
  assert.equal(report.byStratum.highRisk["true"].receiptCount, 1);
  assert.equal(report.byStratum.highRisk["true"].receiptPrepareMs.n, 1);
  assert.equal(report.byStratum.terminal["ProposalReview/split-recommended"].telemetryCount, 3);
  assert.equal(report.byStratum.terminal["ProposalReview/split-recommended"].receiptCount, 0);
  assert.equal(report.byStratum.terminal["ProposalReview/split-recommended"].receiptPrepareMs, null);
  // All 3 telemetry records are cold with null contentAgentMs → notMeasured, never coerced to 0.
  assert.equal(report.agentWork.notMeasured.count, 3);
  assert.equal(report.agentWork.measuredZero.count, 0);
  assert.equal(report.agentWork.measured.count, 0);
  // wallTimeProxyMinutes = (60000+120000+300000)/60000 = 8
  assert.equal(report.agentWork.wallTimeProxyMinutes.totalMinutes, 8);
});

test("DIR-126-E AC: two wall-time distributions are reported separately, NEVER pooled (fixture that fails a blended implementation)", () => {
  // Receipt side ~2 minutes; telemetry proxy ~10 minutes. A pooled P50 would land between them
  // and match NEITHER block — the exact falsification this fixture pins.
  const dir = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "tp1", taskId: "T-P", milestoneId: "M-P", admission: { key: ".::T-P", ownerExecutionId: "o", fencingToken: 0, acquiredAt: 0 }, recordedAtMs: 600000 }),
      capRecord({ recordId: "tp2", taskId: "T-P", milestoneId: "M-P", admission: { key: ".::T-P", ownerExecutionId: "o", fencingToken: 1, acquiredAt: 0 }, recordedAtMs: 600000 }),
      capRecord({ recordId: "tp3", taskId: "T-P", milestoneId: "M-P", admission: { key: ".::T-P", ownerExecutionId: "o", fencingToken: 2, acquiredAt: 0 }, recordedAtMs: 600000 }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-P", milestoneId: "M1", startedAtMs: 0, endedAtMs: 120000 }),
      M2: capReceipt({ taskId: "R-P", milestoneId: "M2", startedAtMs: 0, endedAtMs: 120000 }),
      M3: capReceipt({ taskId: "R-P", milestoneId: "M3", startedAtMs: 0, endedAtMs: 120000 }),
    },
  });
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  const keys = Object.keys(report.wallTime).filter((k) => k !== "note");
  assert.deepEqual(keys.sort(), ["receiptPrepareMs", "telemetryProxyMs"], "exactly two labeled distribution blocks, no pooled block");
  assert.equal(report.wallTime.receiptPrepareMs.p50Ms, 120000);
  assert.equal(report.wallTime.telemetryProxyMs.p50Ms, 600000);
  assert.notEqual(report.wallTime.receiptPrepareMs.p50Ms, report.wallTime.telemetryProxyMs.p50Ms);
});

test("DIR-126-E AC: insufficient-sample honesty — below --min-samples produces the explicit typed result, not a misleadingly precise distribution (combined AND per-population gate)", () => {
  // 2 telemetry + 0 receipts: combined 2 < 3.
  const thin = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "s1", taskId: "T-S", milestoneId: "M-S" }),
      capRecord({ recordId: "s2", taskId: "T-S", milestoneId: "M-S" }),
    ],
  });
  const r1 = computeCapacityReport({ workspace: thin, telemetryRoot: path.join(thin, "milestones", "prepare-telemetry") });
  assert.equal(r1.code, "insufficient-samples");
  assert.equal(r1.minSamples, 3);
  assert.equal(r1.sampleCount, 2);
  assert.deepEqual(r1.perPopulation.telemetry.sampleIds, ["s1", "s2"]);
  assert.equal(r1.perPopulation.receipts.count, 0);
  assert.equal(r1.wallTime, undefined, "no P50/P85 below the gate");
  // Per-population gate: combined 5 >= 3 but receipts 2 < 3 → still insufficient (never blended).
  const lopsided = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "l1", taskId: "T-L", milestoneId: "M-L" }),
      capRecord({ recordId: "l2", taskId: "T-L", milestoneId: "M-L" }),
      capRecord({ recordId: "l3", taskId: "T-L", milestoneId: "M-L" }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-L", milestoneId: "M1", startedAtMs: 0, endedAtMs: 1000 }),
      M2: capReceipt({ taskId: "R-L", milestoneId: "M2", startedAtMs: 0, endedAtMs: 2000 }),
    },
  });
  const r2 = computeCapacityReport({ workspace: lopsided, telemetryRoot: path.join(lopsided, "milestones", "prepare-telemetry") });
  assert.equal(r2.code, "insufficient-samples");
  assert.equal(r2.sampleCount, 5);
  // --min-samples 1 boundary: 1+1 passes.
  const r3 = computeCapacityReport({ workspace: lopsided, telemetryRoot: path.join(lopsided, "milestones", "prepare-telemetry"), minSamples: 1 });
  assert.equal(r3.code, "ok");
});

test("DIR-126-E AC: malformed telemetry JSON is a TRACED exclusion (reason + path + error kept), never a silent drop — the flagged divergence from queryTelemetryReport's silent-skip", () => {
  const dir = baselineWorkspace();
  fs.mkdirSync(path.join(dir, "milestones", "prepare-telemetry", "TASK-BAD"), { recursive: true });
  fs.writeFileSync(path.join(dir, "milestones", "prepare-telemetry", "TASK-BAD", "broken.json"), "{ not valid json");
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  assert.equal(report.code, "ok");
  assert.equal(report.sampleCount, 6, "malformed record not counted");
  const ex = report.exclusions.find((e) => e.reason === "malformed-json");
  assert.ok(ex, "malformed-json exclusion present");
  assert.equal(ex.population, "telemetry");
  assert.match(ex.path, /broken\.json$/);
  assert.ok(ex.detail, "parse error message retained");
});

test("DIR-126-E C3: validateTelemetryRecord is REUSED — a reuse-terminal invariant violation lands in exclusions[] with the validator's OWN {code, message}", () => {
  const dir = baselineWorkspace();
  const bad = capRecord({
    recordId: "bad-reuse", taskId: "TASK-A", milestoneId: "M-F1",
    generationId: "g-bad",
    decision: { kind: "reuse-terminal", reason: "cache-hit", priorGenerationId: "g-prior", priorReason: null, createsContentGeneration: false },
    contentAgentDispatchCount: 1, contentAgentMs: 5, // violates the 0/0 invariant
  });
  const taskDir = path.join(dir, "milestones", "prepare-telemetry", "TASK-A");
  fs.writeFileSync(path.join(taskDir, "bad-reuse.json"), JSON.stringify(bad, null, 2));
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  const ex = report.exclusions.find((e) => e.id === "bad-reuse");
  assert.ok(ex, "invalid record excluded");
  assert.equal(ex.reason, "reuse-terminal-invalid");
  assert.match(ex.detail, /contentAgentDispatchCount === 0 && contentAgentMs === 0/);
  assert.equal(report.sampleCount, 6, "invalid record not counted");
});

test("DIR-126-E C4: receipt wall time comes from the REUSED computeMetricsForReceipt/computeConvergenceMetrics — reported prepareWallTimeMs equals computeMetricsForReceipt's own output for the same receipt", () => {
  const dir = baselineWorkspace();
  const receiptFile = path.join(dir, "milestones", "M2", "preparation.json");
  const direct = computeMetricsForReceipt({ receiptFile });
  assert.equal(direct.ok, true);
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  // M2's wall time (240000) is exactly computeMetricsForReceipt's prepareWallTimeMs, and it is the
  // receipt distribution's p50 — the report derived it, never recomputed it independently.
  assert.equal(direct.metrics.prepareWallTimeMs, 240000);
  assert.equal(report.wallTime.receiptPrepareMs.p50Ms, direct.metrics.prepareWallTimeMs);
  assert.ok(report.wallTime.receiptPrepareMs.n === 3);
});

test("DIR-126-E C9: degenerate startedAtMs===endedAtMs receipts are excluded (never a fabricated 0ms); a genuinely short +1ms interval stays included", () => {
  const dir = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "g1", taskId: "T-G", milestoneId: "M-G" }),
      capRecord({ recordId: "g2", taskId: "T-G", milestoneId: "M-G" }),
      capRecord({ recordId: "g3", taskId: "T-G", milestoneId: "M-G" }),
    ],
    receipts: {
      // The exact live M192/M195 shape: startedAtMs === endedAtMs (both finite) → excluded.
      M1: capReceipt({ taskId: "R-DEG", milestoneId: "M1", startedAtMs: 1785238767187, endedAtMs: 1785238767187 }),
      // A genuinely short-but-DISTINCT interval → included as a real 1ms sample.
      M2: capReceipt({ taskId: "R-SHORT", milestoneId: "M2", startedAtMs: 1000, endedAtMs: 1001 }),
      M3: capReceipt({ taskId: "R-FULL", milestoneId: "M3", startedAtMs: 0, endedAtMs: 600000 }),
      M5: capReceipt({ taskId: "R-FULL2", milestoneId: "M5", startedAtMs: 0, endedAtMs: 1200000 }),
      // No convergence block at all → excluded under its OWN reason, never as zero-duration.
      M4: capReceipt({ taskId: "R-NC", milestoneId: "M4", convergence: null }),
    },
  });
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  assert.equal(report.code, "ok");
  const reasons = report.exclusions.map((e) => e.reason).sort();
  assert.deepEqual(reasons, ["convergence-interval-degenerate", "no-convergence-block"]);
  // The degenerate receipt's 0 must NOT appear: distribution min is the 1ms sample, n=3.
  assert.equal(report.wallTime.receiptPrepareMs.n, 3);
  assert.equal(report.wallTime.receiptPrepareMs.minMs, 1, "the +1ms interval proves the guard fires on exact equality only");
});

test("DIR-126-E C8: absorbed-task/prepare-hour numerator is a checked-in file-presence signal (preparation.json ∧ absorb-entry.md) — the count changes when absorb-entry.md is added on disk, zero provider calls", () => {
  const dir = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "ab1", taskId: "T-AB", milestoneId: "M-AB" }),
      capRecord({ recordId: "ab2", taskId: "T-AB", milestoneId: "M-AB" }),
      capRecord({ recordId: "ab3", taskId: "T-AB", milestoneId: "M-AB" }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-ABS1", milestoneId: "M1", startedAtMs: 0, endedAtMs: 3600000 }), // 1h
      M2: capReceipt({ taskId: "R-ABS2", milestoneId: "M2", startedAtMs: 0, endedAtMs: 1800000 }), // 0.5h
      M3: capReceipt({ taskId: "R-NOABS", milestoneId: "M3", startedAtMs: 0, endedAtMs: 900000 }),
    },
    absorbDirs: ["M1"], // M2 has a receipt but no absorb-entry; M4 below has absorb-entry but no receipt
  });
  fs.mkdirSync(path.join(dir, "milestones", "M4"), { recursive: true });
  fs.writeFileSync(path.join(dir, "milestones", "M4", "absorb-entry.md"), "absorb entry without receipt\n");
  const root = path.join(dir, "milestones", "prepare-telemetry");
  const before = computeCapacityReport({ workspace: dir, telemetryRoot: root });
  assert.deepEqual(before.absorbedTaskPerPrepareHour.numeratorTaskIds, ["R-ABS1"], "the AND: M4's absorb-entry.md alone does NOT qualify");
  assert.equal(before.absorbedTaskPerPrepareHour.numeratorCount, 1);
  assert.equal(before.absorbedTaskPerPrepareHour.denominatorHours, 1);
  assert.equal(before.absorbedTaskPerPrepareHour.absorbedPerPrepareHour, 1);
  // Add absorb-entry.md to M2 on disk — the count moves, with no MCP/provider call in scope.
  fs.writeFileSync(path.join(dir, "milestones", "M2", "absorb-entry.md"), "## M2 ABSORB entry\n");
  const after = computeCapacityReport({ workspace: dir, telemetryRoot: root });
  assert.deepEqual(after.absorbedTaskPerPrepareHour.numeratorTaskIds, ["R-ABS1", "R-ABS2"]);
  assert.equal(after.absorbedTaskPerPrepareHour.numeratorCount, 2);
  assert.equal(after.absorbedTaskPerPrepareHour.denominatorHours, 1.5);
  assert.equal(after.absorbedTaskPerPrepareHour.absorbedPerPrepareHour, Number((2 / 1.5).toFixed(3)));
});

test("DIR-126-E C11: concurrent duplicate-generation minutes = exact pairwise interval intersection grouped by the record's OWN admission.key; sequential retries and singletons report zero", () => {
  const dir = makeCapacityWorkspace({
    telemetry: [
      // Overlapping pair under ONE admission.key: [0,120000] ∩ [60000,180000] = 60000ms = 1 min.
      capRecord({ recordId: "ov1", taskId: "TASK-O", milestoneId: "M-O", admission: { key: ".::TASK-O", ownerExecutionId: "o", fencingToken: 0, acquiredAt: 0 }, recordedAtMs: 120000 }),
      capRecord({ recordId: "ov2", taskId: "TASK-O", milestoneId: "M-O", admission: { key: ".::TASK-O", ownerExecutionId: "o", fencingToken: 1, acquiredAt: 60000 }, recordedAtMs: 180000 }),
      // Sequential retry under a second key: starts exactly at the prior terminal → zero overlap.
      capRecord({ recordId: "seq1", taskId: "TASK-S", milestoneId: "M-S", admission: { key: ".::TASK-S", ownerExecutionId: "o", fencingToken: 0, acquiredAt: 0 }, recordedAtMs: 60000 }),
      capRecord({ recordId: "seq2", taskId: "TASK-S", milestoneId: "M-S", admission: { key: ".::TASK-S", ownerExecutionId: "o", fencingToken: 1, acquiredAt: 60000 }, recordedAtMs: 120000 }),
      // A singleton under a third key → no group at all.
      capRecord({ recordId: "solo1", taskId: "TASK-X", milestoneId: "M-X", admission: { key: ".::TASK-X", ownerExecutionId: "o", fencingToken: 0, acquiredAt: 0 }, recordedAtMs: 30000 }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-C11", milestoneId: "M1", startedAtMs: 0, endedAtMs: 1000 }),
      M2: capReceipt({ taskId: "R-C11", milestoneId: "M2", startedAtMs: 0, endedAtMs: 2000 }),
      M3: capReceipt({ taskId: "R-C11", milestoneId: "M3", startedAtMs: 0, endedAtMs: 3000 }),
    },
  });
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  assert.equal(report.waste.concurrentDuplicate.totalMinutes, 1, "exactly the intersection of the overlapping pair");
  const ovGroup = report.waste.concurrentDuplicate.groups.find((g) => g.key === ".::TASK-O");
  const seqGroup = report.waste.concurrentDuplicate.groups.find((g) => g.key === ".::TASK-S");
  assert.equal(ovGroup.overlapMinutes, 1);
  assert.deepEqual(ovGroup.recordIds, ["ov1", "ov2"]);
  assert.equal(seqGroup.overlapMinutes, 0, "a sequential retry starting after the prior terminal contributes exactly zero");
  assert.ok(!report.waste.concurrentDuplicate.groups.some((g) => g.key === ".::TASK-X"), "a singleton produces no overlap group");
});

test("DIR-126-E AC: unchanged-terminal recomputation groups by the hashes.* 4-tuple — POSITIVE (identical hashes, cacheable pair, later non-reuse → 1 recomputation, null work routed to notMeasured + proxy) and a correct reuse-terminal is a HIT not waste", () => {
  const sameHashes = { charter: "cS", taskContract: "tS", proposal: "pS", reviewPolicy: "rS" };
  const dir = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "rc-old", taskId: "TASK-RC", milestoneId: "M-RC", hashes: sameHashes, admission: { key: ".::TASK-RC", ownerExecutionId: "o", fencingToken: 0, acquiredAt: 0 }, recordedAtMs: 1000 }),
      capRecord({ recordId: "rc-recompute", taskId: "TASK-RC", milestoneId: "M-RC", hashes: sameHashes, admission: { key: ".::TASK-RC", ownerExecutionId: "o", fencingToken: 1, acquiredAt: 1000 }, recordedAtMs: 61000 }),
      // A CORRECT reuse of the identical inputs — a hit, not a recomputation.
      capRecord({
        recordId: "rc-reuse", taskId: "TASK-RC", milestoneId: "M-RC", hashes: sameHashes, generationId: "g-reuse",
        decision: { kind: "reuse-terminal", reason: "cache-hit", priorGenerationId: "g-prior", priorReason: "split-recommended", createsContentGeneration: false },
        contentAgentDispatchCount: 0, contentAgentMs: 0,
        admission: { key: ".::TASK-RC", ownerExecutionId: "o", fencingToken: 2, acquiredAt: 61000 }, recordedAtMs: 62000,
      }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-RC", milestoneId: "M1", startedAtMs: 0, endedAtMs: 1000 }),
      M2: capReceipt({ taskId: "R-RC", milestoneId: "M2", startedAtMs: 0, endedAtMs: 2000 }),
      M3: capReceipt({ taskId: "R-RC", milestoneId: "M3", startedAtMs: 0, endedAtMs: 3000 }),
    },
  });
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  const ut = report.waste.unchangedTerminal;
  assert.equal(ut.recomputations, 1, "exactly the later cacheable non-reuse record");
  assert.equal(ut.wastedMeasuredContentAgentMs, null, "contentAgentMs is null → never a fabricated exact number");
  assert.equal(ut.notMeasuredRecomputations, 1);
  assert.equal(ut.wallTimeProxyMinutesForNotMeasured, 1, "proxy (61000-1000)/60000 for the not-measured recomputation");
  assert.equal(ut.terminalReuseHits, 1);
  assert.deepEqual(ut.terminalReuseHitRecordIds, ["rc-reuse"]);
  assert.equal(ut.groups.length, 1);
  assert.deepEqual(ut.groups[0].recomputationRecordIds, ["rc-recompute"]);
  assert.deepEqual(ut.groups[0].hashes, sameHashes);
  // reuse-terminal's zero agent work is measured-zero, exact and schema-guaranteed.
  assert.equal(report.agentWork.measuredZero.count, 1);
  assert.equal(report.yield.terminalReused, 1);
});

test("DIR-126-E AC: NEGATIVE — same cacheable terminal SHAPE but DIFFERENT hashes.* are NOT an avoidable recomputation (shape-only grouping would misclassify 16 live split-recommended records)", () => {
  const dir = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "sh1", taskId: "TASK-SH", milestoneId: "M-SH", hashes: { charter: "c1", taskContract: "t1", proposal: "p-ONE", reviewPolicy: "r1" }, recordedAtMs: 1000 }),
      capRecord({ recordId: "sh2", taskId: "TASK-SH", milestoneId: "M-SH", hashes: { charter: "c1", taskContract: "t1", proposal: "p-TWO", reviewPolicy: "r1" }, recordedAtMs: 2000 }),
      capRecord({ recordId: "sh3", taskId: "TASK-SH", milestoneId: "M-SH", hashes: { charter: "c2", taskContract: "t2", proposal: "p-THREE", reviewPolicy: "r2" }, recordedAtMs: 3000 }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-SH", milestoneId: "M1", startedAtMs: 0, endedAtMs: 1000 }),
      M2: capReceipt({ taskId: "R-SH", milestoneId: "M2", startedAtMs: 0, endedAtMs: 2000 }),
      M3: capReceipt({ taskId: "R-SH", milestoneId: "M3", startedAtMs: 0, endedAtMs: 3000 }),
    },
  });
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  // All three share the terminal shape ProposalReview/split-recommended (cacheable), but no pair
  // shares the exact hashes 4-tuple → zero recomputations.
  assert.equal(report.waste.unchangedTerminal.recomputations, 0);
  assert.equal(report.waste.unchangedTerminal.groups.length, 0);
});

test("DIR-126-E C5: cacheability derives from the IMPORTED CACHEABLE_TERMINALS via the phase bridge — mutating the real imported array changes classification (not a hand-copied literal)", () => {
  // Terminal Receipt/prepared is NOT cacheable under the landed allowlist.
  assert.equal(isCacheableTerminalShape({ phase: "Receipt", reason: "prepared" }), false);
  const sameHashes = { charter: "cM", taskContract: "tM", proposal: "pM", reviewPolicy: "rM" };
  const mkWs = () => makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "mut1", taskId: "TASK-M", milestoneId: "M-M", hashes: sameHashes, terminal: { outcome: "prepared", reason: "prepared", phase: "Receipt", cacheable: false }, recordedAtMs: 1000 }),
      capRecord({ recordId: "mut2", taskId: "TASK-M", milestoneId: "M-M", hashes: sameHashes, terminal: { outcome: "prepared", reason: "prepared", phase: "Receipt", cacheable: false }, recordedAtMs: 2000 }),
      capRecord({ recordId: "mut3", taskId: "TASK-M", milestoneId: "M-M", hashes: { charter: "x", taskContract: "x", proposal: "x", reviewPolicy: "x" }, recordedAtMs: 3000 }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-M", milestoneId: "M1", startedAtMs: 0, endedAtMs: 1000 }),
      M2: capReceipt({ taskId: "R-M", milestoneId: "M2", startedAtMs: 0, endedAtMs: 2000 }),
      M3: capReceipt({ taskId: "R-M", milestoneId: "M3", startedAtMs: 0, endedAtMs: 3000 }),
    },
  });
  const ws = mkWs();
  const root = path.join(ws, "milestones", "prepare-telemetry");
  const before = computeCapacityReport({ workspace: ws, telemetryRoot: root });
  assert.equal(before.waste.unchangedTerminal.recomputations, 0, "Receipt/prepared is not on the landed allowlist → nothing cacheable → no recomputation");
  // Mutate the REAL imported array (the module holds the live reference) — classification follows.
  CACHEABLE_TERMINALS.push({ terminalPhase: "Receipt", reason: "prepared" });
  try {
    const after = computeCapacityReport({ workspace: ws, telemetryRoot: root });
    assert.equal(after.waste.unchangedTerminal.recomputations, 1, "mutating the imported allowlist is picked up — proving a real import, not a duplicated literal");
  } finally {
    CACHEABLE_TERMINALS.pop();
  }
  assert.equal(computeCapacityReport({ workspace: ws, telemetryRoot: root }).waste.unchangedTerminal.recomputations, 0, "restored");
});

test("DIR-126-E C5/Defaults: record.terminal.cacheable is NEVER trusted — a self-report disagreeing with the derived value emits a diagnostic, derived governs", () => {
  const dir = makeCapacityWorkspace({
    telemetry: [
      // Self-reports cacheable:true for a shape NOT on the allowlist → mismatch diagnostic.
      capRecord({ recordId: "liar", taskId: "TASK-L", milestoneId: "M-L", hashes: { charter: "cL", taskContract: "tL", proposal: "pL", reviewPolicy: "rL" }, terminal: { outcome: "revision-needed", reason: "wiring-coverage-check-failed", phase: "ProposalReview", cacheable: true } }),
      // Distinct hashes 4-tuples: no recomputation group, isolating the diagnostic assertion.
      capRecord({ recordId: "ok1", taskId: "TASK-L", milestoneId: "M-L", hashes: { charter: "c1", taskContract: "t1", proposal: "p1", reviewPolicy: "r1" } }),
      capRecord({ recordId: "ok2", taskId: "TASK-L", milestoneId: "M-L", hashes: { charter: "c2", taskContract: "t2", proposal: "p2", reviewPolicy: "r2" } }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-L", milestoneId: "M1", startedAtMs: 0, endedAtMs: 1000 }),
      M2: capReceipt({ taskId: "R-L", milestoneId: "M2", startedAtMs: 0, endedAtMs: 2000 }),
      M3: capReceipt({ taskId: "R-L", milestoneId: "M3", startedAtMs: 0, endedAtMs: 3000 }),
    },
  });
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  const diag = report.diagnostics.find((d) => d.recordId === "liar");
  assert.ok(diag, "self-report mismatch surfaced as a diagnostic");
  assert.equal(diag.type, "cacheability-self-report-mismatch");
  assert.equal(diag.derivedCacheable, false);
  assert.equal(diag.selfReportedCacheable, true);
  assert.equal(diag.terminal, "ProposalReview/wiring-coverage-check-failed");
  // Derived value governs: the liar's terminal is not cacheable → no recomputation group from it.
  assert.equal(report.waste.unchangedTerminal.recomputations, 0);
});

test("DIR-126-E C6: populations are best-effort joined, NEVER required-paired — a receipt-only sample still contributes wall-time stats; a telemetry-only sample still contributes decision/agent-work stats", () => {
  const dir = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "to1", taskId: "TELE-ONLY", milestoneId: "M-T1" }),
      capRecord({ recordId: "to2", taskId: "TELE-ONLY", milestoneId: "M-T2" }),
      capRecord({ recordId: "to3", taskId: "TELE-ONLY", milestoneId: "M-T3" }),
    ],
    receipts: {
      M7: capReceipt({ taskId: "RECEIPT-ONLY", milestoneId: "M7", startedAtMs: 0, endedAtMs: 100000 }),
      M8: capReceipt({ taskId: "RECEIPT-ONLY", milestoneId: "M8", startedAtMs: 0, endedAtMs: 200000 }),
      M9: capReceipt({ taskId: "RECEIPT-ONLY", milestoneId: "M9", startedAtMs: 0, endedAtMs: 300000 }),
    },
  });
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  assert.equal(report.code, "ok");
  assert.equal(report.wallTime.receiptPrepareMs.n, 3, "receipt-only samples contribute wall time without any telemetry pair");
  assert.equal(report.yield.attempts, 3, "telemetry-only samples contribute decision stats without any receipt pair");
  assert.equal(report.agentWork.notMeasured.count, 3);
  assert.deepEqual(report.join.paired, []);
  assert.deepEqual(report.join.telemetryOnly, ["TELE-ONLY/M-T1", "TELE-ONLY/M-T2", "TELE-ONLY/M-T3"]);
  assert.deepEqual(report.join.receiptOnly, ["RECEIPT-ONLY/M7", "RECEIPT-ONLY/M8", "RECEIPT-ONLY/M9"]);
});

test("DIR-126-E AC: interval-fields-missing is a PARTIAL exclusion — out of overlap analysis only, still in decision/agent-work stats and the sample count", () => {
  const dir = makeCapacityWorkspace({
    telemetry: [
      capRecord({ recordId: "nm1", taskId: "TASK-NM", milestoneId: "M-NM", recordedAtMs: null }), // missing interval field
      capRecord({ recordId: "nm2", taskId: "TASK-NM", milestoneId: "M-NM" }),
      capRecord({ recordId: "nm3", taskId: "TASK-NM", milestoneId: "M-NM" }),
    ],
    receipts: {
      M1: capReceipt({ taskId: "R-NM", milestoneId: "M1", startedAtMs: 0, endedAtMs: 1000 }),
      M2: capReceipt({ taskId: "R-NM", milestoneId: "M2", startedAtMs: 0, endedAtMs: 2000 }),
      M3: capReceipt({ taskId: "R-NM", milestoneId: "M3", startedAtMs: 0, endedAtMs: 3000 }),
    },
  });
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  const ex = report.exclusions.find((e) => e.id === "nm1");
  assert.ok(ex, "partial exclusion present");
  assert.equal(ex.reason, "interval-fields-missing");
  assert.equal(ex.partial, true);
  assert.equal(report.sampleCount, 6, "still counted in the sample count");
  assert.equal(report.perPopulation.telemetry.count, 3);
  assert.equal(report.yield.byDecisionKind.cold, 3, "still counted in decision stats");
  assert.equal(report.agentWork.notMeasured.count, 3, "still counted in agent-work stats");
});

test("DIR-126-E AC: caller-supplied exclusions ({id, reason}) are honored and reasoned", () => {
  const dir = baselineWorkspace();
  const report = computeCapacityReport({
    workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry"),
    exclusions: [{ id: "t-a1", reason: "known-disposable-fixture" }],
  });
  assert.equal(report.sampleCount, 5);
  const ex = report.exclusions.find((e) => e.id === "t-a1");
  assert.equal(ex.reason, "known-disposable-fixture");
  assert.ok(!report.sampleIds.includes("t-a1"));
});

test("DIR-126-E AC: estimatedAvoidedAgentMinutes is the literal 'unknown' without a comparable measured population — savings are never fabricated", () => {
  const dir = baselineWorkspace();
  const sameHashes = { charter: "cU", taskContract: "tU", proposal: "pU", reviewPolicy: "rU" };
  const taskDir = path.join(dir, "milestones", "prepare-telemetry", "TASK-U");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "u1.json"), JSON.stringify(capRecord({ recordId: "u1", taskId: "TASK-U", milestoneId: "M-U", hashes: sameHashes, recordedAtMs: 1000 })));
  fs.writeFileSync(path.join(taskDir, "u2.json"), JSON.stringify(capRecord({ recordId: "u2", taskId: "TASK-U", milestoneId: "M-U", hashes: sameHashes, recordedAtMs: 2000 })));
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  assert.equal(report.waste.unchangedTerminal.recomputations, 1);
  assert.equal(report.estimatedAvoidedAgentMinutes, "unknown", "all cold records have null contentAgentMs → no comparable measured population");
});

test("DIR-126-E C12/AC: --out is BYTE-reproducible across consecutive runs — no generatedAtMs leaks; the reproducibility AC is diff-provable", () => {
  const dir = baselineWorkspace();
  const a = path.join(dir, "report-a.json");
  const b = path.join(dir, "report-b.json");
  execFileSync("node", ["--experimental-strip-types", PREP_CHECK_SCRIPT_E, "--capacity-report", "--workspace", dir, "--out", a], { encoding: "utf8" });
  execFileSync("node", ["--experimental-strip-types", PREP_CHECK_SCRIPT_E, "--capacity-report", "--workspace", dir, "--out", b], { encoding: "utf8" });
  assert.equal(fs.readFileSync(a, "utf8"), fs.readFileSync(b, "utf8"), "byte-identical re-runs");
  assert.ok(!fs.readFileSync(a, "utf8").includes("generatedAtMs"), "no wall-clock generation timestamp in the payload");
});

test("DIR-126-E C1 (THE GATE ITEM): --capacity-report is a real, reachable CLI mode on BOTH mirrors — live subprocess invocations produce well-formed JSON (not --selftest-only reachability)", () => {
  // Canonical script against a fixture workspace.
  const dir = baselineWorkspace();
  const out = execFileSync("node", ["--experimental-strip-types", PREP_CHECK_SCRIPT_E, "--capacity-report", "--workspace", dir], { encoding: "utf8" });
  const parsed = JSON.parse(out);
  assert.equal(parsed.code, "ok");
  assert.equal(parsed.sampleCount, 6);
  // Mirror script, same invocation — byte-identical module, same output.
  const mirrorOut = execFileSync("node", ["--experimental-strip-types", MIRROR_SCRIPT_E, "--capacity-report", "--workspace", dir], { encoding: "utf8" });
  assert.equal(JSON.parse(mirrorOut).code, "ok");
  // C1's real-workspace clause: the mode runs against the actual workspace root '.' and produces
  // well-formed JSON with >= 3 real samples in each population (re-queried live, never frozen).
  const live = JSON.parse(execFileSync("node", ["--experimental-strip-types", PREP_CHECK_SCRIPT_E, "--capacity-report", "--workspace", REPO_ROOT_E], { encoding: "utf8" }));
  assert.equal(live.code, "ok", "live workspace clears the sample gate");
  assert.ok(live.perPopulation.telemetry.count >= 3, "live telemetry population");
  assert.ok(live.perPopulation.receipts.count >= 3, "live receipt population");
  assert.ok(!("generatedAtMs" in live));
});

test("DIR-126-E: CLI usage errors exit 2 — bad --telemetry-glob shape, malformed --exclusions JSON, malformed --exclusions shape, unreadable --workspace", () => {
  const dir = baselineWorkspace();
  const run = (args) => {
    try {
      execFileSync("node", ["--experimental-strip-types", PREP_CHECK_SCRIPT_E, ...args], { encoding: "utf8", stdio: "pipe" });
      return 0;
    } catch (e) {
      return e.status;
    }
  };
  assert.equal(run(["--capacity-report", "--workspace", dir, "--telemetry-glob", "no-glob-suffix"]), 2);
  const badJson = path.join(dir, "bad-exclusions.json");
  fs.writeFileSync(badJson, "{ not json");
  assert.equal(run(["--capacity-report", "--workspace", dir, "--exclusions", badJson]), 2);
  const badShape = path.join(dir, "bad-shape.json");
  fs.writeFileSync(badShape, JSON.stringify([{ id: "x" }])); // missing reason
  assert.equal(run(["--capacity-report", "--workspace", dir, "--exclusions", badShape]), 2);
  assert.equal(run(["--capacity-report", "--workspace", path.join(dir, "does-not-exist")]), 2);
});

test("DIR-126-E C7: queryTelemetryReport's external contract is unchanged by the _walkJsonFiles extraction — nested layout, silent-skip, {ok, code} shape, embedded-milestoneId filter all intact", () => {
  const dir = freshTmpDir();
  const taskDir = path.join(dir, "milestones", "prepare-telemetry", "TASK-REG", "nested");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(path.join(taskDir, "r1.json"), JSON.stringify(capRecord({ recordId: "r1", milestoneId: "M-REG" })));
  fs.writeFileSync(path.join(taskDir, "r2.json"), JSON.stringify(capRecord({ recordId: "r2", milestoneId: "M-OTHER" })));
  fs.writeFileSync(path.join(taskDir, "broken.json"), "{ malformed");
  const result = queryTelemetryReport({ workspace: dir, milestoneId: "M-REG" });
  assert.equal(result.ok, true);
  assert.equal(result.code, "records-found");
  assert.deepEqual(result.records.map((r) => r.recordId), ["r1"], "silent-skip malformed + embedded-milestoneId filter, same as pre-refactor");
  const empty = queryTelemetryReport({ workspace: dir, milestoneId: "M-NOPE" });
  assert.deepEqual(empty, { ok: true, code: "no-records", milestoneId: "M-NOPE" });
});

test("DIR-126-E: empty tree on both populations → insufficient-samples with exit-0 semantics, never a crash or an error-looking result", () => {
  const dir = freshTmpDir();
  const report = computeCapacityReport({ workspace: dir, telemetryRoot: path.join(dir, "milestones", "prepare-telemetry") });
  assert.equal(report.code, "insufficient-samples");
  assert.equal(report.sampleCount, 0);
  assert.deepEqual(report.sampleIds, []);
  assert.deepEqual(report.exclusions, []);
  const out = execFileSync("node", ["--experimental-strip-types", PREP_CHECK_SCRIPT_E, "--capacity-report", "--workspace", dir], { encoding: "utf8" });
  assert.equal(JSON.parse(out).code, "insufficient-samples"); // exit 0 — execFileSync did not throw
});
