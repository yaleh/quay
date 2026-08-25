// @test-group product
// driver-cli-ac2-drive.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC2] — `quay run` drives ALL actionable tasks to a
// fixpoint (exit 0). The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, seedReadyTask, runQuay } from "./driver-helpers.mjs";

test("C [AC2]: `quay run` drives ALL actionable tasks to a fixpoint (exit 0)", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2-drive");
  seedReadyTask("RUN-D1", tasksDir, workspaceRoot, "true");
  seedReadyTask("RUN-D2", tasksDir, workspaceRoot, "true");

  const r = runQuay(["run"], workspaceRoot);
  assert.equal(r.status, 0, `expected exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /run: 2 completed in 2 iters \(stop=fixpoint\)/);
  for (const id of ["RUN-D1", "RUN-D2"]) {
    const t = JSON.parse(runQuay(["task", "view", id, "--json"], workspaceRoot).stdout);
    assert.equal(t.status, "done", `${id} must be done`);
  }
});
