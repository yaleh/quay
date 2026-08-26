// @test-group product
// lifecycle-a1-assert-transition.test.mjs — split out of lifecycle.test.mjs
// (gap-suite-split-long-multi-test-files): A1 — assertTransition throws on every null edge and is
// silent on legal edges. The test body is byte-identical to the original; only its file placement
// changed so node:test's file-level concurrency can parallelize it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { assertTransition } from "../src/gate/lifecycle.ts";

test("A1: assertTransition throws on every null edge and is silent on legal edges", () => {
  // legal edges: no throw
  assert.doesNotThrow(() => assertTransition("todo", "forward"));
  assert.doesNotThrow(() => assertTransition("ready", "forward"));
  assert.doesNotThrow(() => assertTransition("ready", "back"));
  assert.doesNotThrow(() => assertTransition("done", "back"));
  assert.doesNotThrow(() => assertTransition("needs-human", "back"), "needs-human→todo retreat is legal");
  // null edges: throw with the exact message shape
  assert.throws(() => assertTransition("todo", "back"), /illegal transition: todo cannot back/);
  assert.throws(() => assertTransition("done", "forward"), /illegal transition: done cannot forward/);
  assert.throws(() => assertTransition("needs-human", "forward"), /illegal transition: needs-human cannot forward/);
  assert.throws(() => assertTransition("superseded", "forward"), /illegal transition: superseded cannot forward/);
  assert.throws(() => assertTransition("superseded", "back"), /illegal transition: superseded cannot back/);
});
