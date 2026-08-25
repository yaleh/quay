// @test-group product
// driver-is-actionable-no-meter.test.mjs — split out of driver.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — isActionable() is false for a ready task with no /
// empty / whitespace / non-string meter. The test body is byte-identical to the original; only its
// file placement changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { isActionable } from "../src/gate/driver.ts";

test("A1: isActionable — ready but no/empty/whitespace meter => false", () => {
  assert.equal(isActionable({ id: "A", status: "ready", extra: {} }), false);
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: "" } }), false);
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: "   " } }), false);
  assert.equal(isActionable({ id: "A", status: "ready" }), false); // no extra at all
  assert.equal(isActionable({ id: "A", status: "ready", extra: { acceptance: 42 } }), false); // non-string
});
