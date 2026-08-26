// @test-group product
// lifecycle-cli-dir102-ac4.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [DIR-102 AC4] — `quay promote <needs-human>` →
// nonzero (promote from needs-human illegal). The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked, STACK_FRAME_PATTERN } from "./lifecycle-helpers.mjs";

test("C [DIR-102 AC4]: `quay promote <needs-human>` → nonzero (promote from needs-human illegal)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac4");
  runNative(["task", "create", "NH-PROMOTE", "--title", "needs-human promote", "--status", "needs-human",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["promote", "NH-PROMOTE"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);
  assert.match(r.stderr, /illegal transition: needs-human cannot forward/);
  assert.ok(!STACK_FRAME_PATTERN.test(r.stderr), "no stack trace");

  const after = JSON.parse(runQuay(["task", "view", "NH-PROMOTE", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "needs-human", "status unchanged");
});
