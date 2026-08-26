// @test-group product
// driver-is-actionable-garbage.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — isActionable(null/undefined/{}) is false (no
// throw). The test body is byte-identical to the original; only its file placement changed so
// node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isActionable } from "../src/gate/driver.ts";

test("A1: isActionable — null/undefined/garbage input is false (no throw)", () => {
  assert.equal(isActionable(null), false);
  assert.equal(isActionable(undefined), false);
  assert.equal(isActionable({}), false);
});
