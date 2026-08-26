// @test-group product
// lifecycle-cli-argorder.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [ARG-ORDER] — `quay complete --file <log> <id>` (flag
// before id) == id-first. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [ARG-ORDER]: `quay complete --file <log> <id>` (flag before id) == id-first", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("argorder-complete");
  const logFile = path.join(workspaceRoot, "g.jsonl");
  runNative(["task", "create", "LC-PASS", "--title", "ready+passing", "--status", "ready",
    "--body", validSections + acDodChecked], tasksDir);
  runQuay(["task", "edit", "LC-PASS", "--acceptance", "true"], workspaceRoot);
  const r = runQuay(["complete", "--file", logFile, "LC-PASS"], workspaceRoot);
  assert.equal(r.status, 0, `flag-first complete should exit 0; got ${r.status}, stderr=${r.stderr}, stdout=${r.stdout}`);
  const after = JSON.parse(runQuay(["task", "view", "LC-PASS", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "done");
});
