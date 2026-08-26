// @test-group product
// driver-is-actionable-meter.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — isActionable() is true for a ready task with a
// non-empty acceptance meter. The test body is byte-identical to the original; only its file
// placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isActionable } from "../src/gate/driver.ts";

test("A1: isActionable — ready + non-empty meter => true", () => {
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: "true" } }), true);
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: "some-cmd --flag" } }), true);
});
