// @test-group engine
// task-parsing-parity.test.mjs — the drift guard for the three parsing primitives PROMOTED to the
// product layer (gap-abi-promote-section-parsing-flip-store-reverse-import).
//
// The product layer (packages/quay/src/task-parsing.ts, next to abi.ts) is now the AUTHORITATIVE home
// of extractSection / parseFrontmatterCompletely / countAcCheckboxes. The native store
// (packages/quay-native/src/store.ts) consumes them from there — the ONE reverse import is gone.
//
// WHY this test exists: the mechanism layer (plugin/scripts/task-schema.ts + task-status-drift-check.ts)
// still needs these three functions for ITS OWN readers (parseTask / readDependsOn / the status-drift
// detector). It CANNOT statically import packages/quay/src/task-parsing.ts — build-plugin-dist stages
// plugin/ → packages/quay/plugin/ and bundles each entry WITHOUT the packages/ tree (the same reason
// loop-complete-task.ts / config-wiring-check.ts use DYNAMIC pathToFileURL imports; a static
// `../../packages/...` import fails esbuild's resolve). So the plugin keeps its own mechanism-layer
// copies, and THIS test pins them BEHAVIORALLY identical to the product source — a divergence here is
// the two frontmatter/section readers silently disagreeing (the exact drift class the promotion exists
// to end). "No private implementation" is enforced here as "no behaviorally-divergent implementation".
//
// Run: scripts/test.sh plugin/test/task-parsing-parity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractSection, parseFrontmatterCompletely, parseTask, frontmatterGoalAc, readGoalAc } from "../scripts/task-schema.ts";
import { countAcCheckboxes } from "../scripts/task-status-drift-check.ts";
import {
  extractSection as productExtractSection,
  parseFrontmatterCompletely as productParseFrontmatterCompletely,
  countAcCheckboxes as productCountAcCheckboxes,
} from "../../packages/quay/src/task-parsing.ts";

// A representative task body exercising depth-aware section slicing (## vs ### nesting) and the
// absent-heading null return.
const TASK_BODY = `## Proposal

Do the thing.

## Plan

### Step 1
detail

### Step 2
more detail

## Acceptance Criteria

- [ ] first
- [x] second
`;

const FRONTMATTER = `id: gap-x
title: "example: with colon"
labels: [a, b]
goal_ac: AC-170
extra:
  schema: execution
  depends_on:
    - gap-a
    - gap-b
`;

test("extractSection — plugin copy matches product source (depth-aware slicing)", () => {
  for (const heading of ["Proposal", "Plan", "Acceptance Criteria", "Absent"]) {
    assert.deepEqual(
      extractSection(TASK_BODY, heading),
      productExtractSection(TASK_BODY, heading),
      `extractSection("${heading}") diverged`,
    );
  }
});

test("parseFrontmatterCompletely — plugin copy matches product source (full YAML round-trip)", () => {
  assert.deepEqual(
    parseFrontmatterCompletely(FRONTMATTER),
    productParseFrontmatterCompletely(FRONTMATTER),
  );
});

test("countAcCheckboxes — plugin copy matches product source (incl. fail-closed absent-section)", () => {
  const ac = extractSection(TASK_BODY, "Acceptance Criteria");
  assert.deepEqual(countAcCheckboxes(ac), productCountAcCheckboxes(ac));
  // fail-closed absent section: both must return the NaN total shape, not a silent {unchecked:0}.
  const absent = countAcCheckboxes(null);
  assert.deepEqual(absent, productCountAcCheckboxes(null));
  assert.equal(absent.sectionFound, false);
  assert.ok(Number.isNaN(absent.total), "absent section must be NaN, not 0");
});

// ── goal_ac top-level read (gap-goal-ac-task-linkage-top-level-field) ──
// AC1: parseTask reads goal_ac from TOP-LEVEL (not extra-nested). AC2: negative control — an
// unset goal_ac reads back null (≠ a concrete AC id; 缺值 = 未查), never a fabricated value.
test("goal_ac — parseTask reads it top-level; unset ⇒ null (AC1 + AC2 negative control)", () => {
  const withGoal = parseTask("---\nid: x\ngoal_ac: AC-170\n---\nbody");
  assert.equal(withGoal.goal_ac, "AC-170", "top-level goal_ac reads back via parseTask");
  const withoutGoal = parseTask("---\nid: x\n---\nbody");
  assert.equal(withoutGoal.goal_ac, null, "unset goal_ac ⇒ null, not a fabricated AC id");
  // extra-nested is NOT the home: it must not leak into the top-level projection.
  const nestedOnly = parseTask("---\nid: x\nextra:\n  goal_ac: AC-170\n---\nbody");
  assert.equal(nestedOnly.goal_ac, null, "goal_ac nested under extra is NOT read (top-level only)");
});

test("goal_ac — frontmatterGoalAc/readGoalAc single projection (delegates to the one parser)", () => {
  assert.equal(frontmatterGoalAc(parseFrontmatterCompletely("goal_ac: AC-177")), "AC-177");
  assert.equal(readGoalAc("goal_ac: AC-178"), "AC-178");
  assert.equal(readGoalAc("id: x"), null, "absent goal_ac ⇒ null");
  assert.equal(readGoalAc("goal_ac: ''"), null, "empty goal_ac ⇒ null");
});
