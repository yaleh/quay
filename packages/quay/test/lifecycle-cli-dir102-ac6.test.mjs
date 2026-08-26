// @test-group product
// lifecycle-cli-dir102-ac6.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [DIR-102 AC6] — `quay retreat <done> --reason x`
// still works (no regression). The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [DIR-102 AC6]: `quay retreat <done> --reason x` still works (no regression)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("dir102-ac6");
  runNative(["task", "create", "DONE-RET", "--title", "done retreat regression", "--status", "done",
    "--body", validSections + acDodChecked], tasksDir);

  const r = runQuay(["retreat", "DONE-RET", "--reason", "rework needed"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RETREAT done → ready/);

  const after = JSON.parse(runQuay(["task", "view", "DONE-RET", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "ready", "done→ready still works");
});
