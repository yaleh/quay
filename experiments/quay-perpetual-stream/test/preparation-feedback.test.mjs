// @test-group engine
// preparation-feedback.test.mjs — sibling test for preparation-feedback.ts. Not currently imported
// by another module (N/A under ADR-001's load-bearing trigger today), but added proactively so any
// future wiring (e.g. into select-preflight.ts's Stage 1.6 pipeline) never has to retrofit this —
// same filename-match convention loadbearing-test-gate.sh enforces for its load-bearing siblings.
//
// Run: node --test experiments/quay-perpetual-stream/test/preparation-feedback.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { runPreparationFeedbackLoop, MAX_PREPARATION_ROUNDS, selftest } = await import("../scripts/preparation-feedback.ts");

test("preparation-feedback.ts embedded selftest() suite passes", () => {
  assert.equal(selftest(), true);
});

test("MAX_PREPARATION_ROUNDS is 3 (the charter's stated cap)", () => {
  assert.equal(MAX_PREPARATION_ROUNDS, 3);
});

function mkPortfolio(round) {
  return { version: 1, selected: [], rejected: [], generatedAt: "x", round };
}

test("accepts immediately when round-0 preparation is already valid (no regeneration call at all)", () => {
  let calls = 0;
  const outcome = runPreparationFeedbackLoop([], mkPortfolio(0), {
    check: () => ({ valid: true }),
    regenerate: () => {
      calls++;
      return mkPortfolio(1);
    },
  });
  assert.equal(outcome.status, "accepted");
  assert.equal(outcome.rounds, 0);
  assert.equal(calls, 0);
});

test("routes to human-review-required after exactly MAX_PREPARATION_ROUNDS regenerations, never a 4th", () => {
  let calls = 0;
  const outcome = runPreparationFeedbackLoop([], mkPortfolio(0), {
    check: () => ({ valid: false, reason: "perpetual drift" }),
    regenerate: (_f, round) => {
      calls++;
      return mkPortfolio(round);
    },
  });
  assert.equal(outcome.status, "human-review-required");
  assert.equal(outcome.rounds, MAX_PREPARATION_ROUNDS);
  assert.equal(calls, MAX_PREPARATION_ROUNDS);
});

test("history is a non-empty, human-readable audit trail on both accept and human-review paths", () => {
  const accepted = runPreparationFeedbackLoop([], mkPortfolio(0), {
    check: () => ({ valid: true }),
    regenerate: (_f, round) => mkPortfolio(round),
  });
  assert.ok(accepted.history.length >= 1);

  const reviewed = runPreparationFeedbackLoop([], mkPortfolio(0), {
    check: () => ({ valid: false, reason: "x" }),
    regenerate: (_f, round) => mkPortfolio(round),
  });
  assert.ok(reviewed.history.length >= 1);
  assert.match(reviewed.history[reviewed.history.length - 1], /human review/);
});

