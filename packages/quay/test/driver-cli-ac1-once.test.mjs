// @test-group product
// driver-cli-ac1-once.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC1] — `quay run --once` on a ready+passing-meter
// task → exit 0, task→done; re-run → nothing to do, exit 0. The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, seedReadyTask, runQuay } from "./driver-helpers.mjs";

test("C [AC1]: `quay run --once` on a ready+passing-meter task → exit 0, task→done; re-run → nothing to do, exit 0", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1");
  seedReadyTask("RUN-A", tasksDir, workspaceRoot, "true");

  const r = runQuay(["run", "--once"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RUN-A: PASS — done/);
  const after = JSON.parse(runQuay(["task", "view", "RUN-A", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "done", "task must be advanced to done");

  // Re-run: RUN-A is now done, no other actionable task -> nothing to do, exit 0.
  const r2 = runQuay(["run", "--once"], workspaceRoot);
  assert.equal(r2.status, 0, `re-run expected exit 0; got ${r2.status}, stderr=${r2.stderr}`);
  assert.match(r2.stdout, /nothing to do/);
});
