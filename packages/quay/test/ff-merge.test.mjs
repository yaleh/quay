// @test-group engine
// ff-merge.test.mjs — direct-import unit coverage of `packages/quay/src/fan-in/ff-merge.ts`'s ff SOURCE
// resolver (gap-goal-branch-ff-merge-source-param). The 持锁段 as a whole is integration-tested via a
// CLI subprocess in `plugin/test/fan-in-ff-merge.test.mjs`; THIS file pins the one pure rule all four
// source call sites share (the `--source-ref` default/override), so a drift in that rule is caught
// without spawning git. The basename also follows the repo's `<source>.test.mjs` convention that
// `select-tests-for-touches.ts` pairs on (the older `fan-in-ff-merge.test.mjs` does not pair with
// `ff-merge.ts`, so it alone left the task-scoped selection thin).

import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceRefOf } from "../src/fan-in/ff-merge.ts";

test("sourceRefOf — absent/blank --source-ref falls back to the task branch; a ref or SHA overrides", () => {
  // Default (the existing task path, byte-for-byte unchanged): the task branch.
  assert.equal(sourceRefOf({ task: "t1" }), "refs/heads/task/t1", "absent --source-ref ⇒ task branch");
  assert.equal(sourceRefOf({ task: "t1", sourceRef: null }), "refs/heads/task/t1", "null ⇒ task branch");
  assert.equal(sourceRefOf({ task: "t1", sourceRef: "" }), "refs/heads/task/t1", "empty ⇒ task branch");
  assert.equal(sourceRefOf({ task: "t1", sourceRef: "   " }), "refs/heads/task/t1", "blank ⇒ task branch");
  // Override: an explicit ref or a raw commit SHA is used verbatim (trimmed).
  assert.equal(sourceRefOf({ task: "t1", sourceRef: "refs/heads/goal/g1" }), "refs/heads/goal/g1", "an explicit ref overrides");
  const sha = "a".repeat(40);
  assert.equal(sourceRefOf({ task: "t1", sourceRef: sha }), sha, "a raw merge-commit SHA overrides");
  assert.equal(sourceRefOf({ task: "t1", sourceRef: `  ${sha}  ` }), sha, "surrounding whitespace is trimmed");
});
