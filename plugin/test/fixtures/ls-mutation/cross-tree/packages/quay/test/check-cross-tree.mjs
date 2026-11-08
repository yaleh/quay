// The CHECK of the `cross-tree` fixture. Named `check-cross-tree.mjs`, NOT `*.test.mjs`, on purpose:
// it is run only by an explicit `--test` path, and a `*.test.mjs` file sitting under a fixtures tree is
// one recursive collector away from entering the real suite.
//
// It imports across the top-level boundary DIRECTLY (mirroring
// packages/quay/test/task-transition.test.mjs:36, the reported case) — which is the second half of the
// defect: staging only the two seeds' tops missed `plugin/` even before any transitive walk.
import { test } from "node:test";
import assert from "node:assert/strict";

import { scale, describe } from "../src/target.mjs";
import { double } from "../../../plugin/scripts/shared.mjs";

test("scale multiplies by the shared doubler (reached across a top-level boundary)", () => {
  assert.equal(scale(3, 2), 12);
  assert.equal(scale(0, 5), 0);
  assert.equal(scale(5, 0), 0);
});

test("describe", () => {
  assert.equal(describe(true), "on");
  assert.equal(describe(false), "off");
});

test("the cross-tree module itself is loadable", () => {
  assert.equal(double(4), 8);
});
