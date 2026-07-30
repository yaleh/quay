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
} from "../scripts/milestone-preparation-check.ts";

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
