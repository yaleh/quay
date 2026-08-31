// @test-group engine
// relative-baseline.test.mjs — gap-global-count-assertions-fragile-relative-baseline.
// B3-2 fixture: a hardcoded global-count SNAPSHOT (`EXPECTED_ENGINE = 58`-style) goes red the
// moment a concurrent merge adds a test file; the RELATIVE-BASELINE criterion (fork-baseline
// snapshot + this task's declared additions, computed at runtime) stays green.
//
// Coverage map (task ACs):
//   AC1  — the relative-baseline relation is asserted, never an absolute global count
//          (relativeBaselineViolations checks ⊇ + a count lower bound, not `== <constant>`).
//   AC2  — snapshotTestFiles records the fork-baseline test-file set (worktree-creation time);
//          expectedTestFiles = baseline ∪ additions.
//   AC3  — the B3-2 fixture: a worktree built before a concurrent merge (B3-1 adds a test file
//          13 min later) keeps the relative-baseline assertion GREEN, while the equivalent
//          snapshot `== N` assertion provably goes red.
//   AC5  — this file declares `// @test-group engine` and uses node:test.
//
// Run:
//   scripts/test.sh plugin/test/relative-baseline.test.mjs
//   scripts/test.sh --group governance plugin/test/relative-baseline.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  snapshotTestFiles,
  expectedTestFiles,
  relativeBaselineViolations,
  expectedCount,
} from "../scripts/test-file-baseline.ts";


test("AC2: snapshotTestFiles dedupes and sorts — a snapshot is a stable set, not a count", () => {
  const snap = snapshotTestFiles(["engine/b.test.mjs", "engine/a.test.mjs", "engine/b.test.mjs", "  ", "product/c.test.mjs"]);
  assert.deepEqual(snap.files, ["engine/a.test.mjs", "engine/b.test.mjs", "product/c.test.mjs"]);
  // The snapshot carries the SET, so the caller can compare against it at any later time.
  assert.equal(snap.files.length, 3);
});

test("AC1/AC2: expectedTestFiles = fork-baseline ∪ declared touch additions (deduped)", () => {
  const snap = snapshotTestFiles(["engine/a.test.mjs", "product/c.test.mjs"]);
  const expected = expectedTestFiles(snap, ["engine/a.test.mjs", "engine/new-touched.test.mjs"]);
  assert.deepEqual(expected, ["engine/a.test.mjs", "engine/new-touched.test.mjs", "product/c.test.mjs"]);
  // Count relation computed at runtime — no absolute literal.
  assert.equal(expectedCount(snap, ["engine/new-touched.test.mjs"]), 3);
});

// ── AC3: the B3-2 fixture ──────────────────────────────────────────────────────────────────────────
// Reproduce the exact failure: B3-2's worktree snapshot was taken 13 min before B3-1's merge added a
// new engine test. A SNAPSHOT assertion (`|current| == 3`) goes red; the RELATIVE-BASELINE criterion
// (⊇ + count lower bound) stays green.
test("AC3: B3-2 fixture — a concurrent merge adding a test file keeps the relative-baseline assertion GREEN", () => {
  // Step 1 — "worktree creation" (T-13min): snapshot the fixture's test-file set.
  const baselineFiles = ["engine/a.test.mjs", "engine/b.test.mjs", "product/c.test.mjs"];
  const baseline = snapshotTestFiles(baselineFiles);

  // Step 2 — B3-1's concurrent merge (T): adds a new ENGINE test the current worktree can't see.
  const currentAfterMerge = [...baselineFiles, "engine/d.test.mjs"];

  // Step 3 — the SNAPSHOT assertion shape: `|current| == 3` would go RED (3 != 4).
  // This is the fragile `EXPECTED_ENGINE = 58` shape B3-2 went red on.
  assert.notEqual(currentAfterMerge.length, baseline.files.length,
    "the snapshot shape (|current| == baseline count) is exactly what goes red on a concurrent merge");

  // Step 4 — the RELATIVE-BASELINE criterion (this task's fix): no violations, GREEN.
  // Unrelated concurrent additions are legitimate; nothing the task depends on disappeared and the
  // count is not below the expected relative-baseline floor.
  const violations = relativeBaselineViolations(currentAfterMerge, baseline, []);
  assert.deepEqual(violations, [], `B3-2 fixture must stay green under the relative-baseline criterion: ${violations.join("; ")}`);

  // The count LOWER bound still holds (runtime-computed, never a hardcoded constant).
  assert.ok(currentAfterMerge.length >= expectedCount(baseline, []),
    `count ${currentAfterMerge.length} must be >= relative-baseline floor ${expectedCount(baseline, [])}`);
});

test("AC1/AC3: a declared touch addition is part of the task's own baseline and must not vanish", () => {
  const baseline = snapshotTestFiles(["engine/a.test.mjs"]);
  // This task declares a touch-addition to the test-file set; after a rebase it is present.
  const current = ["engine/a.test.mjs", "engine/touched.test.mjs"];
  assert.deepEqual(relativeBaselineViolations(current, baseline, ["engine/touched.test.mjs"]), []);
  // If the touch-addition were missing, the ⊇ direction fires (RED) — the task's dependency vanished.
  const missing = relativeBaselineViolations(["engine/a.test.mjs"], baseline, ["engine/touched.test.mjs"]);
  assert.ok(missing.some((v) => v.includes("engine/touched.test.mjs")), JSON.stringify(missing));
});

test("AC1: a baseline file that disappears is a violation (⊇ direction), regardless of the count", () => {
  const baseline = snapshotTestFiles(["engine/a.test.mjs", "engine/b.test.mjs", "product/c.test.mjs"]);
  // product/c.test.mjs deleted (a real removal would need to be declared — the count alone can't hide it).
  const current = ["engine/a.test.mjs", "engine/b.test.mjs", "engine/d.test.mjs"];
  const violations = relativeBaselineViolations(current, baseline, []);
  assert.ok(violations.some((v) => v.includes("product/c.test.mjs")), JSON.stringify(violations));
});

test("AC1: relativeBaselineViolations does NOT reject unrelated concurrent additions (the B3-2 fix core)", () => {
  const baseline = snapshotTestFiles(["engine/a.test.mjs"]);
  // Two unrelated files merged concurrently by other tasks — NOT this task's additions.
  const current = ["engine/a.test.mjs", "product/x.test.mjs", "serial/y.test.mjs"];
  assert.deepEqual(relativeBaselineViolations(current, baseline, []), []);
});

