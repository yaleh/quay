// @test-group product
// driver-cli-ac2-sentinel.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC2] — `quay run` with a pre-created .quay/.stop
// sentinel → clean exit 0, stop=sentinel. The test body is byte-identical to the original; only
// its file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";

import { makeWorkspace, seedReadyTask, runQuay } from "./driver-helpers.mjs";

test("C [AC2]: `quay run` with a pre-created .quay/.stop sentinel → clean exit 0, stop=sentinel", () => {
  const { workspaceRoot, tasksDir } = makeWorkspace("ac2-sentinel");
  seedReadyTask("RUN-S", tasksDir, workspaceRoot, "true"); // actionable, but sentinel wins
  fs.writeFileSync(path.join(workspaceRoot, ".quay", ".stop"), "");

  const r = runQuay(["run"], workspaceRoot);
  assert.equal(r.status, 0, `expected clean exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /stop=sentinel/);
  const after = JSON.parse(runQuay(["task", "view", "RUN-S", "--json"], workspaceRoot).stdout);
  assert.equal(after.status, "ready", "sentinel stops before any work — task untouched");
});
