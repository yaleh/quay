// @test-group product
// driver-cli-ac1-determinism.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC1] — determinism: with two actionable tasks the
// LOWEST id is selected. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, seedReadyTask, runQuay } from "./driver-helpers.mjs";

test("C [AC1]: determinism — with two actionable tasks the LOWEST id is selected", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac1-order");
  seedReadyTask("RUN-B2", tasksDir, workspaceRoot, "true");
  seedReadyTask("RUN-B1", tasksDir, workspaceRoot, "true");

  const r = runQuay(["run", "--once"], workspaceRoot);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /RUN-B1: PASS — done/); // lowest id first
  const b1 = JSON.parse(runQuay(["task", "view", "RUN-B1", "--json"], workspaceRoot).stdout);
  const b2 = JSON.parse(runQuay(["task", "view", "RUN-B2", "--json"], workspaceRoot).stdout);
  assert.equal(b1.status, "done");
  assert.equal(b2.status, "ready", "the higher id is left untouched by --once");
});
