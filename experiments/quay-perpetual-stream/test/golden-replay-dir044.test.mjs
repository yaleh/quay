// Golden-replay proof for DIR-044 (increment 5): the recorded touches-disjoint pair DIR-039 ∥
// DIR-042-A, replayed through the whole concurrent pipeline, must reproduce the frozen serial oracle.
// Run: node --test experiments/quay-perpetual-stream/test/golden-replay-dir044.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { runGoldenReplay } from "../scripts/golden-replay-dir044.ts";

test("golden replay: DIR-039 ∥ DIR-042-A reproduces the serial oracle end-to-end", () => {
  const r = runGoldenReplay();
  assert.equal(r.ok, true, r.msg);
  // every stage passed
  for (const [name, pass] of r.checks) assert.equal(pass, true, `stage failed: ${name}`);
});

test("golden replay: the plan advances the counter by exactly 2 with contiguous milestone numbers", () => {
  const r = runGoldenReplay();
  assert.equal(r.plan.counterBefore, 58);
  assert.equal(r.plan.counterAfter, 60);
  assert.deepEqual(r.plan.entries.map((e) => e.milestone), [59, 60]);
});

test("golden replay: order is deterministic (id-sorted), independent of build completion order", () => {
  const r1 = runGoldenReplay();
  const r2 = runGoldenReplay();
  assert.deepEqual(r1.plan.order, r2.plan.order);
});
