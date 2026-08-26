// @test-group product
// driver-cli-ac2-fixpoint.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): C [AC2] — `quay run` with no actionable tasks →
// fixpoint, exit 0. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeWorkspace, runQuay } from "./driver-helpers.mjs";

test("C [AC2]: `quay run` with no actionable tasks → fixpoint, exit 0", () => {
  const { workspaceRoot } = makeWorkspace("ac2-fixpoint");
  const r = runQuay(["run"], workspaceRoot);
  assert.equal(r.status, 0, `fixpoint must exit 0; got ${r.status}, stderr=${r.stderr}`);
  assert.match(r.stdout, /stop=fixpoint/);
});
