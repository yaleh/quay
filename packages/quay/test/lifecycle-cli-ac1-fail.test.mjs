// @test-group product
// lifecycle-cli-ac1-fail.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC1] — `quay complete <ready+failing-meter>` → exit
// 1, status stays ready. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [AC1]: `quay complete <ready+failing-meter>` → exit 1, status stays ready", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-fail");
  runNative(["task", "create", "LC-FAIL", "--title", "ready+failing", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LC-FAIL", "--acceptance", "false"], workspaceRoot);

  const r = runQuay(["complete", "LC-FAIL"], workspaceRoot);
  assert.equal(r.status, 1, `expected exit 1; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /FAIL/);
  const after = JSON.parse(runQuay(["task", "view", "LC-FAIL", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "ready", "status must be unchanged on fail");
});
