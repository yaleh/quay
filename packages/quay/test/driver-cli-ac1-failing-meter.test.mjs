// @test-group product
// driver-cli-ac1-failing-meter.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC1] — `quay run --once` on a ready+FAILING-meter
// task → exit 0 (observation), task stays ready. The test body is byte-identical to the original;
// only its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, seedReadyTask, runQuay } from "./driver-helpers.mjs";

test("C [AC1]: `quay run --once` on a ready+FAILING-meter task → exit 0 (observation), task stays ready", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-fail");
  seedReadyTask("RUN-F", tasksDir, workspaceRoot, "false");

  const r = runQuay(["run", "--once"], workspaceRoot);
  // CRITICAL: a meter fail is a successful driver OBSERVATION — exit 0 (the
  // --once branch resets the exitCode=1 that runComplete set).
  assert.equal(r.status, 0, `--once must exit 0 even on a meter fail; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /RUN-F: FAIL/);
  const after = JSON.parse(runQuay(["task", "view", "RUN-F", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "ready", "a failing meter leaves the task ready");
});
