// Unit tests for milestone-preparation-check.mjs — DIR-117 unit C. Exercises the fixture-fresh
// PASS path plus 4 independent negative mutations (Proposal, charter, Plan, checked source file),
// each expected to fail with its OWN distinct actionable code, and confirms an unrelated-file
// change does not cause a false invalidation (the check never even reads unrelated files).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReceipt, checkPreparation, sha256 } from "../scripts/milestone-preparation-check.ts";

const FIXTURES = path.join(import.meta.dirname, "..", "fixtures", "preparation");
const TASK = path.join(FIXTURES, "fixture-task.md");
const CHARTER = path.join(FIXTURES, "fixture-charter.md");
const PLAN = path.join(FIXTURES, "fixture-plan.md");
const SOURCE = path.join(FIXTURES, "fixture-source.ts");

function freshTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "prep-check-"));
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
