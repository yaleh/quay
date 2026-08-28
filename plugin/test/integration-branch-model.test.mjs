// @test-group engine
// integration-branch-model.test.mjs — gap-branch-model-integration-branch-splits-fork-baseline-from-merge-point.
// The two-line branch model (orchestration/SPEC-branching-model-integration-branch-2026-08-05.md):
// split the "fork baseline" (develop, verified) from the "merge point" (integration, pending
// verification). master currently bears BOTH roles — which is WHY the red-window must stop dispatch.
// Splitting them is structural: a task never forks from an unverified tree, so the fork baseline IS
// the dependency declaration (AC2) and integration keeps receiving merges during the red-window
// (AC3 — stop-dispatch structurally eliminated). The outer verification-round batch-merges
// integration → develop, always a fast-forward by construction (AC3).
//
// Coverage map (task ACs):
//   AC2 — forkBaseline: independent → develop; declared dependency OR touch overlap with unverified
//         integration work → integration (the mechanical, no-new-field dependency declaration).
//   AC3 — decideIntegrationToDevelopMerge: integration a descendant of develop ⇒ fast-forward, no
//         conflict; invariant broken ⇒ blocked, never auto-merge.
//   AC3 — the task→integration conflict fixture: overlapping declared touches surface the
//         touch-declaration imprecision (SPEC §4 — the residual, bounded merge cost).
//   AC7 — this file declares `// @test-group engine` and uses node:test.
//
// Run:
//   scripts/test.sh plugin/test/integration-branch-model.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  forkBaseline,
  decideIntegrationToDevelopMerge,
  touchesOverlap,
  declaredTouches,
} from "../scripts/integration-branch-model.ts";


// ── AC2: fork baseline = dependency declaration ───────────────────────────────────────────────────
test("AC2: independent task forks from develop (verified baseline)", () => {
  assert.equal(forkBaseline({ declaredDependency: false, overlapsUnverifiedIntegration: false }), "develop");
});

test("AC2: a declared dependency forks from integration (no new dependency field needed)", () => {
  assert.equal(forkBaseline({ declaredDependency: true, overlapsUnverifiedIntegration: false }), "integration");
});

test("AC2: touches overlapping unverified integration work ⇒ integration (mechanically checkable)", () => {
  assert.equal(forkBaseline({ declaredDependency: false, overlapsUnverifiedIntegration: true }), "integration");
});

// ── AC3: integration → develop batch merge is always fast-forward ────────────────────────────────
test("AC3: develop is an ancestor of integration (integration a descendant) ⇒ fast-forward, no conflict", () => {
  // Two-line invariant: `git merge-base --is-ancestor develop integration` → 0.
  const d = decideIntegrationToDevelopMerge(true, "integration", "develop");
  assert.equal(d.ok, true);
  assert.equal(d.mode, "fast-forward");
});

test("AC3: invariant broken (integration diverged from develop) ⇒ blocked, never auto-merge", () => {
  const d = decideIntegrationToDevelopMerge(false, "integration", "develop");
  assert.equal(d.ok, false);
  assert.equal(d.mode, "blocked");
});

// ── AC3: task→integration conflict fixture (touch-declaration imprecision exposed) ───────────────
test("AC3: overlapping touch declarations surface the imprecision that makes task→integration non-ff", () => {
  const a = ["plugin/scripts/foo.ts", "tasks/gap-a.md"];
  const b = ["plugin/scripts/foo.ts", "tasks/gap-b.md"];
  assert.deepEqual(touchesOverlap(a, b), ["plugin/scripts/foo.ts"]);
});

test("AC3: disjoint touch declarations produce no overlap (independent tasks stay ff at merge)", () => {
  assert.deepEqual(touchesOverlap(["plugin/scripts/a.ts"], ["plugin/scripts/b.ts"]), []);
});

test("AC3: duplicated overlaps are deduped and blank entries are ignored", () => {
  assert.deepEqual(
    touchesOverlap(["a.ts", "a.ts", "  "], ["a.ts", "b.ts"]),
    ["a.ts"],
  );
});

// ── AC2: declaredTouches parsing (mechanical fork-baseline input) ───────────────────────────────
test("AC2: declaredTouches parses a task body's ## Touches list", () => {
  const body = `## Touches\n\n- plugin/loop/fast-mode-loop-tick.md\n- plugin/scripts/integration-branch-model.ts\n- tasks/gap-x.md\n`;
  assert.deepEqual(declaredTouches(body), [
    "plugin/loop/fast-mode-loop-tick.md",
    "plugin/scripts/integration-branch-model.ts",
    "tasks/gap-x.md",
  ]);
});

test("AC2: declaredTouches strips (new) markers and stops at the next ## heading", () => {
  const body = `## Touches\n\n- plugin/scripts/a.ts\n- plugin/test/b.test.mjs (new)\n\nprose line\n\n## Contract\n\nmeasure   x = 1\n`;
  assert.deepEqual(declaredTouches(body), ["plugin/scripts/a.ts", "plugin/test/b.test.mjs"]);
});

test("AC2: declaredTouches returns [] for a body with no ## Touches section", () => {
  assert.deepEqual(declaredTouches("## Proposal\n\nno touches here\n"), []);
});

