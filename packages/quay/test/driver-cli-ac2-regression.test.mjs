// @test-group product
// driver-cli-ac2-regression.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC2 regression] — `quay run` exits 0 on a fixpoint
// stop that included a failed task (exit-code leak fix). The test body is byte-identical to the
// original; only its file placement changed so node:test's file-level concurrency can parallelize
// it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, seedReadyTask, runQuay } from "./driver-helpers.mjs";

test("C [AC2 regression]: `quay run` exits 0 on a fixpoint stop that included a failed task (exit-code leak fix)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2-mixed-fixpoint");
  seedReadyTask("RUN-MIX-FAIL", tasksDir, workspaceRoot, "false"); // real failing meter
  seedReadyTask("RUN-MIX-PASS", tasksDir, workspaceRoot, "true");  // passes

  const r = runQuay(["run"], workspaceRoot);
  assert.equal(
    r.status,
    0,
    `fixpoint stop with a failed task along the way must still exit 0; got ${r.status}, stdout=${r.stdout}, stderr=${r.stderr}`
  );
  assert.match(r.stdout, /FAIL — acceptance failed/);
  assert.match(r.stdout, /run: 1 completed in 2 iters \(stop=fixpoint\)/);

  const failTask = JSON.parse(runQuay(["task", "view", "RUN-MIX-FAIL", "--json"], workspaceRoot).stdout);
  assert.equal(failTask.status, "ready", "the failed task stays ready (attempted once, not retried)");
  const passTask = JSON.parse(runQuay(["task", "view", "RUN-MIX-PASS", "--json"], workspaceRoot).stdout);
  assert.equal(passTask.status, "done", "the other task still completes despite the earlier failure");
});
