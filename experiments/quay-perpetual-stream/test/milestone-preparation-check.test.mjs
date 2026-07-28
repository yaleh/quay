// Unit tests for milestone-preparation-check.mjs — DIR-117 unit C. Exercises the fixture-fresh
// PASS path plus 4 independent negative mutations (Proposal, charter, Plan, checked source file),
// each expected to fail with its OWN distinct actionable code, and confirms an unrelated-file
// change does not cause a false invalidation (the check never even reads unrelated files).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildReceipt, checkPreparation, sha256,
  computeTouchesExpansion, parsePlanStages, validatePlanStructure, checkProvenanceDistinctness,
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

test("checkProvenanceDistinctness: FAIL — reviewer session equals an author's session (not a distinct context)", () => {
  const r = checkProvenanceDistinctness({
    proposalAuthors: [{ authorIdx: 1, sessionId: "same-session" }],
    adjudicator: { sessionId: "adj" },
    proposalReviewer: { sessionId: "same-session" },
    planAuthor: { sessionId: "pa" },
    planCheckers: [{ round: 1, sessionId: "pc" }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "provenance-not-distinct");
});

test("checkProvenanceDistinctness: FAIL — plan-checker session equals plan-author's session", () => {
  const r = checkProvenanceDistinctness({
    proposalAuthors: [{ authorIdx: 1, sessionId: "a1" }],
    adjudicator: { sessionId: "adj" },
    proposalReviewer: { sessionId: "rev" },
    planAuthor: { sessionId: "same-session" },
    planCheckers: [{ round: 1, sessionId: "same-session" }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "provenance-not-distinct");
});

test("checkProvenanceDistinctness: PASS — every role has its own distinct session id", () => {
  const r = checkProvenanceDistinctness({
    proposalAuthors: [{ authorIdx: 1, sessionId: "a1" }, { authorIdx: 2, sessionId: "a2" }],
    adjudicator: { sessionId: "adj" },
    proposalReviewer: { sessionId: "rev" },
    planAuthor: { sessionId: "pa" },
    planCheckers: [{ round: 1, sessionId: "pc1" }],
  });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.code, "provenance-distinct");
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

test("checkPreparation: FAIL — receipt's proposal reviewer session matches an author's (not a distinct context)", () => {
  const dir = freshTmpDir();
  const receipt = makeFreshReceipt();
  receipt.provenance.proposalReviewer.sessionId = receipt.provenance.proposalAuthors[0].sessionId;
  const receiptFile = path.join(dir, "preparation.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2));
  const result = checkPreparation({ taskFile: TASK, charterFile: CHARTER, receiptFile });
  assert.equal(result.ok, false);
  assert.equal(result.code, "provenance-not-distinct");
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
