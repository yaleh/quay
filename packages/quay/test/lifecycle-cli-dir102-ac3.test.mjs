// @test-group product
// lifecycle-cli-dir102-ac3.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [DIR-102 AC3] — `quay retreat <needs-human>` (no
// --reason) → nonzero, status unchanged. The test body is byte-identical to the original; only its
// file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [DIR-102 AC3]: `quay retreat <needs-human>` (no --reason) → nonzero, status unchanged", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac3");
  runNative(["task", "create", "NH-NOREASON", "--title", "needs-human no reason", "--status", "needs-human",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["retreat", "NH-NOREASON"], workspaceRoot);
  assert.notEqual(r.status, 0, `expected nonzero; got ${r.status}, stdout=${r.stdout}`);

  const after = JSON.parse(runQuay(["task", "view", "NH-NOREASON", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "needs-human", "status unchanged without --reason");
});
