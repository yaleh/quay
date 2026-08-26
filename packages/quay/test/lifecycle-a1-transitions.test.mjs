// @test-group product
// lifecycle-a1-transitions.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — TRANSITIONS models the todo→ready, ready↔todo/done,
// done→ready, needs-human→todo retreat, superseded hard-terminal edges. The test body is
// byte-identical to the original; only its file placement changed so node:test's file-level
// concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { TRANSITIONS } from "../src/gate/lifecycle.ts";

test("A1: TRANSITIONS models todo→ready, ready↔todo/done, done→ready, needs-human→todo retreat, superseded hard-terminal", () => {
  assert.equal(TRANSITIONS.todo.forward, "ready");
  assert.equal(TRANSITIONS.todo.back, null);
  assert.equal(TRANSITIONS.ready.forward, "done");
  assert.equal(TRANSITIONS.ready.back, "todo");
  assert.equal(TRANSITIONS.done.forward, null);
  assert.equal(TRANSITIONS.done.back, "ready");
  assert.equal(TRANSITIONS["needs-human"].forward, null);
  assert.equal(TRANSITIONS["needs-human"].back, "todo");
  // superseded is a hard terminal: no forward, no back (outer ruling 2026-08-12)
  assert.equal(TRANSITIONS.superseded.forward, null);
  assert.equal(TRANSITIONS.superseded.back, null);
});
