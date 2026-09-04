// @test-group product
// lifecycle-cli-superseded-writable.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): C [SUPERSEDED] — `quay task edit <id> --status
// superseded` succeeds (superseded_writable). The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runNative, runQuay, validSections, acDodChecked } from "./lifecycle-helpers.mjs";

test("C [SUPERSEDED]: `quay task edit <id> --status superseded` succeeds (superseded_writable)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("superseded-writable");
  runNative(["task", "create", "LC-WR", "--title", "writable", "--status", "todo",
    "--body", validSections + acDodChecked], tasksDir);
  const r = runQuay(["task", "edit", "LC-WR", "--status", "superseded"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  const after = JSON.parse(runQuay(["task", "view", "LC-WR", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "superseded");
});
