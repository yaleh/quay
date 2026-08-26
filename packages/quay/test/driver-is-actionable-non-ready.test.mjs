// @test-group product
// driver-is-actionable-non-ready.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — a non-ready task is never actionable, even with a
// meter. The test body is byte-identical to the original; only its file placement changed so
// node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isActionable } from "../src/gate/driver.ts";

test("A1: isActionable — non-ready status is never actionable (even with a meter)", () => {
  assert.equal(isActionable({ id: "A", status: "todo", extra: { acceptance: "true" } }), false);
  assert.equal(isActionable({ id: "A", status: "done", extra: { acceptance: "true" } }), false);
  assert.equal(isActionable({ id: "A", status: "needs-human", extra: { acceptance: "true" } }), false);
});
