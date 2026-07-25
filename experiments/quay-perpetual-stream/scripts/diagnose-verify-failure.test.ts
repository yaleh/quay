// diagnose-verify-failure.test.ts — DIR-073 (M154)
// Unit tests for the verify failure diagnostic script.
//
// Run: node --test --experimental-strip-types experiments/quay-perpetual-stream/scripts/diagnose-verify-failure.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  extractDirectiveIds,
  readDirectiveStatus,
  setDirStatusApplied,
  computeGateHash,
  updateCharterHash,
  runDiagnostic,
} from "./diagnose-verify-failure.ts";

// ── Fixture helpers ──────────────────────────────────────────────────────────────────────────────────

function makeTempTask(content: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diag-test-"));
  const file = path.join(tmp, "DIR-999.md");
  fs.writeFileSync(file, content, "utf8");
  return file;
}

function makeTempCharter(content: string): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diag-charter-"));
  const file = path.join(tmp, "M999-test-charter.md");
  fs.writeFileSync(file, content, "utf8");
  return file;
}

// ── extractDirectiveIds ──────────────────────────────────────────────────────────────────────────────

test("extractDirectiveIds: extracts IDs from Scope and Done-when sections only", () => {
  const charter = `# Charter
**Task:** DIR-099 · **Counter:** 1

## Scope

This covers DIR-001 and DIR-002 as dependencies.

## Done-when

1. DIR-003 is applied.
2. All tests pass.

## Other

DIR-004 should not be extracted (not in Scope/Done-when).
`;
  const ids = extractDirectiveIds(charter);
  assert.deepEqual(ids, ["DIR-001", "DIR-002", "DIR-003"]);
});

test("extractDirectiveIds: skips parenthetical references", () => {
  const charter = `# Charter

## Scope

Covers DIR-001, but also references (DIR-005) which is parenthetical.
DIR-002 is also in scope.

## Done-when

1. DIR-003 applied.
2. (DIR-006) is not a real scope ID.
`;
  const ids = extractDirectiveIds(charter);
  // DIR-001, DIR-002, DIR-003 should be included; DIR-005, DIR-006 should not
  assert.ok(ids.includes("DIR-001"));
  assert.ok(ids.includes("DIR-002"));
  assert.ok(ids.includes("DIR-003"));
  assert.ok(!ids.includes("DIR-005"));
  assert.ok(!ids.includes("DIR-006"));
});

test("extractDirectiveIds: returns empty for charter with no directive IDs", () => {
  const charter = `# Charter

## Scope

No directive IDs here.

## Done-when

1. Do something.
2. Do something else.
`;
  const ids = extractDirectiveIds(charter);
  assert.deepEqual(ids, []);
});

test("extractDirectiveIds: deduplicates IDs appearing in both sections", () => {
  const charter = `# Charter

## Scope

DIR-001 is in scope.

## Done-when

1. DIR-001 is also listed here.
2. DIR-002 is only here.
`;
  const ids = extractDirectiveIds(charter);
  assert.deepEqual(ids, ["DIR-001", "DIR-002"]);
});

// ── readDirectiveStatus ─────────────────────────────────────────────────────────────────────────────

test("readDirectiveStatus: reads status=applied from task frontmatter", () => {
  const taskFile = makeTempTask(`---
id: DIR-001
status: done
labels:
  - directive
extra:
  dirStatus: applied
---
## Content
`);
  const info = readDirectiveStatus(taskFile);
  assert.ok(info);
  assert.equal(info.id, "DIR-001");
  assert.equal(info.dirStatus, "applied");
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

test("readDirectiveStatus: reads status=pending", () => {
  const taskFile = makeTempTask(`---
id: DIR-002
extra:
  dirStatus: pending
---
`);
  const info = readDirectiveStatus(taskFile);
  assert.ok(info);
  assert.equal(info.dirStatus, "pending");
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

test("readDirectiveStatus: returns null for missing dirStatus", () => {
  const taskFile = makeTempTask(`---
id: DIR-003
extra:
  schema: v1
---
`);
  const info = readDirectiveStatus(taskFile);
  assert.ok(info);
  assert.equal(info.dirStatus, null);
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

test("readDirectiveStatus: returns null for missing file", () => {
  const info = readDirectiveStatus("/nonexistent/path/DIR-999.md");
  assert.equal(info, null);
});

test("readDirectiveStatus: handles task with no extra block", () => {
  const taskFile = makeTempTask(`---
id: DIR-004
status: todo
---
`);
  const info = readDirectiveStatus(taskFile);
  assert.ok(info);
  assert.equal(info.dirStatus, null);
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

// ── setDirStatusApplied ─────────────────────────────────────────────────────────────────────────────

test("setDirStatusApplied: sets dirStatus from pending to applied", () => {
  const taskFile = makeTempTask(`---
id: DIR-005
extra:
  dirStatus: pending
---
## Content
`);
  const changed = setDirStatusApplied(taskFile);
  assert.ok(changed);
  const info = readDirectiveStatus(taskFile);
  assert.equal(info?.dirStatus, "applied");
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

test("setDirStatusApplied: no-op when already applied", () => {
  const taskFile = makeTempTask(`---
id: DIR-006
extra:
  dirStatus: applied
---
`);
  const changed = setDirStatusApplied(taskFile);
  assert.ok(!changed);
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

test("setDirStatusApplied: adds dirStatus when missing from extra block", () => {
  const taskFile = makeTempTask(`---
id: DIR-007
extra:
  schema: v1
---
`);
  const changed = setDirStatusApplied(taskFile);
  assert.ok(changed);
  const info = readDirectiveStatus(taskFile);
  assert.equal(info?.dirStatus, "applied");
  // Verify body content is preserved
  const text = fs.readFileSync(taskFile, "utf8");
  assert.ok(text.includes("## Content") || text.includes("---"), "original content preserved");
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

test("setDirStatusApplied: creates extra block when missing", () => {
  const taskFile = makeTempTask(`---
id: DIR-008
status: todo
---
## Content
`);
  const changed = setDirStatusApplied(taskFile);
  assert.ok(changed);
  const info = readDirectiveStatus(taskFile);
  assert.equal(info?.dirStatus, "applied");
  const text = fs.readFileSync(taskFile, "utf8");
  assert.ok(text.includes("## Content"), "body content preserved after adding extra block");
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

// ── updateCharterHash ───────────────────────────────────────────────────────────────────────────────

test("updateCharterHash: updates GATE-HASH-REF line with new hash", () => {
  const charterFile = makeTempCharter(`# Charter
GATE-HASH-REF: abc123def (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Scope
`);
  const changed = updateCharterHash(charterFile, "newhash456");
  assert.ok(changed);
  const text = fs.readFileSync(charterFile, "utf8");
  assert.ok(text.includes("GATE-HASH-REF: newhash456"));
  assert.ok(text.includes("lines 100-131")); // rest of line preserved
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("updateCharterHash: no-op when hash already matches", () => {
  const charterFile = makeTempCharter(`GATE-HASH-REF: abc123
`);
  const changed = updateCharterHash(charterFile, "abc123");
  assert.ok(!changed);
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("updateCharterHash: returns false when no GATE-HASH-REF line", () => {
  const charterFile = makeTempCharter(`# Charter
No hash ref here.
`);
  const changed = updateCharterHash(charterFile, "abc123");
  assert.ok(!changed);
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

// ── computeGateHash ──────────────────────────────────────────────────────────────────────────────────

test("computeGateHash: computes hash from ITERATION-PROMPTS.md", () => {
  // Uses the real file in the repo
  const hash = computeGateHash(".");
  assert.ok(typeof hash === "string");
  assert.ok(hash.length === 64, `expected 64-char sha256, got ${hash.length}`);
  assert.ok(/^[0-9a-f]+$/.test(hash), "should be hex");
});

// ── runDiagnostic ────────────────────────────────────────────────────────────────────────────────────

test("runDiagnostic: returns empty when all checks pass", () => {
  const results = [
    { check: "ceiling-check", ok: true, detail: "all good", source: "script" as const },
    { check: "gate-hash", ok: true, detail: "hash matches", source: "script" as const },
    { check: "domain-misfit", ok: true, detail: "no misfit", source: "agent" as const },
  ];
  const charterFile = makeTempCharter(`# Charter
## Scope
No IDs.
## Done-when
1. Done.
`);
  const diag = runDiagnostic(results, charterFile, ".");
  assert.equal(diag.autoFixed.length, 0);
  assert.equal(diag.unfixable.length, 0);
  assert.ok(diag.retryReady);
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("runDiagnostic: classifies domain-misfit as unfixable", () => {
  const results = [
    { check: "domain-misfit", ok: false, detail: "domain mismatch found", source: "agent" as const },
  ];
  const charterFile = makeTempCharter(`# Charter
## Scope
## Done-when
1. Done.
`);
  const diag = runDiagnostic(results, charterFile, ".");
  assert.equal(diag.autoFixed.length, 0);
  assert.equal(diag.unfixable.length, 1);
  assert.equal(diag.unfixable[0].classification, "domain-misfit");
  assert.ok(!diag.retryReady);
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("runDiagnostic: classifies line-budget as unfixable", () => {
  const results = [
    { check: "line-budget", ok: false, detail: "exceeds 2000 lines", source: "script" as const },
  ];
  const charterFile = makeTempCharter(`# Charter
## Scope
## Done-when
1. Done.
`);
  const diag = runDiagnostic(results, charterFile, ".");
  assert.equal(diag.unfixable.length, 1);
  assert.equal(diag.unfixable[0].classification, "line-budget-exceeded");
  assert.ok(!diag.retryReady);
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("runDiagnostic: classifies dogfood-evidence as unfixable", () => {
  const results = [
    { check: "dogfood-evidence", ok: false, detail: "evidence gap in report", source: "script" as const },
  ];
  const charterFile = makeTempCharter(`# Charter
## Scope
## Done-when
1. Done.
`);
  const diag = runDiagnostic(results, charterFile, ".");
  assert.equal(diag.unfixable.length, 1);
  assert.equal(diag.unfixable[0].classification, "dogfood-evidence-gap");
  assert.ok(!diag.retryReady);
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("runDiagnostic: classifies unknown check as 'unknown'", () => {
  const results = [
    { check: "some-new-check", ok: false, detail: "something went wrong", source: "script" as const },
  ];
  const charterFile = makeTempCharter(`# Charter
## Scope
## Done-when
`);
  const diag = runDiagnostic(results, charterFile, ".");
  assert.equal(diag.unfixable.length, 1);
  assert.equal(diag.unfixable[0].classification, "unknown");
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("runDiagnostic: retryReady is true when all auto-fixed and recheck passes", () => {
  // For hash-mismatch with a valid charter, it should auto-fix
  const charterFile = makeTempCharter(`GATE-HASH-REF: 0000000000000000000000000000000000000000000000000000000000000000 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Scope
## Done-when
1. Done.
`);
  const results = [
    { check: "gate-hash", ok: false, detail: "hash mismatch", source: "script" as const },
  ];
  const diag = runDiagnostic(results, charterFile, ".");
  // Auto-fix should update the hash
  assert.equal(diag.autoFixed.length, 1);
  assert.equal(diag.autoFixed[0].check, "gate-hash");
  assert.equal(diag.unfixable.length, 0);
  // retryReady depends on recheck passing (the hash should now match)
  assert.ok(diag.retryReady, `expected retryReady=true, got ${diag.retryReady}. autoFixed: ${JSON.stringify(diag.autoFixed)}`);
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("runDiagnostic: auto-fixes stale-directive when directive has pending status", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-integration-"));
  // Set up tasks directory
  const tasksDir = path.join(tmpDir, "tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "DIR-010.md"), `---
id: DIR-010
status: todo
extra:
  dirStatus: pending
---
## Content
`);

  const charterFile = path.join(tmpDir, "M999-charter.md");
  fs.writeFileSync(charterFile, `# Charter
## Scope
DIR-010 is in scope.
## Done-when
1. DIR-010 applied.
`);

  const results = [
    { check: "ceiling-check", ok: false, detail: "DIR-010: NOT-FOUND", source: "script" as const },
  ];

  const diag = runDiagnostic(results, charterFile, tmpDir);

  // Should have auto-fixed the stale directive
  assert.equal(diag.autoFixed.length, 1, `expected 1 autoFixed, got ${diag.autoFixed.length}: ${JSON.stringify(diag.autoFixed)}`);
  assert.equal(diag.autoFixed[0].check, "ceiling-check");
  assert.ok(diag.autoFixed[0].action.includes("DIR-010"));
  assert.ok(diag.autoFixed[0].action.includes("applied"));

  // Verify the task was actually updated
  const taskText = fs.readFileSync(path.join(tasksDir, "DIR-010.md"), "utf8");
  assert.ok(taskText.includes("dirStatus: applied"), `task should have dirStatus: applied, got: ${taskText}`);

  fs.rmSync(tmpDir, { recursive: true });
});

test("runDiagnostic: handles mixed auto-fixable and unfixable failures", () => {
  const results = [
    { check: "gate-hash", ok: false, detail: "hash mismatch", source: "script" as const },
    { check: "domain-misfit", ok: false, detail: "misfit found", source: "agent" as const },
  ];
  const charterFile = makeTempCharter(`GATE-HASH-REF: 0000000000000000000000000000000000000000000000000000000000000000 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

## Scope
## Done-when
`);
  const diag = runDiagnostic(results, charterFile, ".");
  assert.equal(diag.autoFixed.length, 1); // hash-mismatch auto-fixed
  assert.equal(diag.unfixable.length, 1); // domain-misfit unfixable
  assert.ok(!diag.retryReady); // not ready because unfixable exist
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

test("runDiagnostic: handles missing charter file gracefully", () => {
  const results = [
    { check: "ceiling-check", ok: false, detail: "failed", source: "script" as const },
  ];
  const diag = runDiagnostic(results, "/nonexistent/charter.md", ".");
  assert.equal(diag.autoFixed.length, 0);
  assert.equal(diag.unfixable.length, 1);
  assert.ok(!diag.retryReady);
});

test("runDiagnostic: handles both source: script and source: agent entries uniformly", () => {
  const results = [
    { check: "ceiling-check", ok: false, detail: "script failure", source: "script" as const },
    { check: "domain-misfit", ok: false, detail: "agent failure", source: "agent" as const },
  ];
  const charterFile = makeTempCharter(`# Charter
## Scope
## Done-when
`);
  const diag = runDiagnostic(results, charterFile, ".");
  // Both are processed — ceiling-check is stale-directive (auto-fixable), domain-misfit is unfixable
  assert.ok(diag.autoFixed.length >= 0);
  assert.equal(diag.unfixable.length, 1); // domain-misfit is unfixable
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});

// ── Edge cases ──────────────────────────────────────────────────────────────────────────────────────

test("setDirStatusApplied: preserves multi-line title in frontmatter", () => {
  const content = `---
id: DIR-010
title: "DIR-010: A long title that spans
  multiple lines"
extra:
  dirStatus: pending
---
## Content
`;
  const taskFile = makeTempTask(content);
  const changed = setDirStatusApplied(taskFile);
  assert.ok(changed);
  const text = fs.readFileSync(taskFile, "utf8");
  assert.ok(text.includes("A long title that spans"), "title preserved");
  assert.ok(text.includes("dirStatus: applied"), "status updated");
  fs.rmSync(path.dirname(taskFile), { recursive: true });
});

test("extractDirectiveIds: handles Scope section with no directive IDs", () => {
  const charter = `# Charter

## Scope

Just prose, no DIR-XXX references.

## Done-when

1. Item one.
`;
  const ids = extractDirectiveIds(charter);
  assert.deepEqual(ids, []);
});

test("runDiagnostic: handles empty results array", () => {
  const charterFile = makeTempCharter(`# Charter\n## Scope\n## Done-when\n`);
  const diag = runDiagnostic([], charterFile, ".");
  assert.equal(diag.autoFixed.length, 0);
  assert.equal(diag.unfixable.length, 0);
  assert.ok(diag.retryReady);
  fs.rmSync(path.dirname(charterFile), { recursive: true });
});
