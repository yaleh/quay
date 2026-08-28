// @test-group product
// lifecycle-cli-ac1-pass.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC1] — `quay complete <ready+passing-meter>` → exit
// 0, status=done. The test body is byte-identical to the original; only its file placement changed
// so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [AC1]: `quay complete <ready+passing-meter>` → exit 0, status=done", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-pass");
  runNative(["task", "create", "LC-PASS", "--title", "ready+passing", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LC-PASS", "--acceptance", "true"], workspaceRoot);

  const r = runQuay(["complete", "LC-PASS"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /PASS — status=done/);
  const after = JSON.parse(runQuay(["task", "view", "LC-PASS", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "done");
});
