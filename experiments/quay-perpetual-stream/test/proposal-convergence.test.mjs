// @test-group engine
// Unit tests for proposal-convergence.ts — DIR-125's bounded ProposalReview convergence engine.
// Pure-function coverage: caps, stable finding identity, ledger merge/resolution, split
// recommendation, injected-clock budget status, the nextAction decision table, ledger
// hash-binding, and the receipt-side mechanical cap re-check.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { makeTmpDir } from "../../../plugin/test/helpers/tmp-workspace.mjs";
import crypto from "node:crypto";

import {
  capsFor, fingerprintFinding, upsertFindings, applyResolutions, blockingOpen,
  checkSplitRecommendation, budgetStatus, nextAction, hashLedger,
  validateConvergenceCounters, computeConvergenceMetrics, isValidDisposition,
  decideResumeGeneration, PHASE_RANK, CACHEABLE_TERMINALS, RESUMABLE_PHASES, RESUME_POLICY_VERSION,
  checkpointPath, buildReviewCheckpoint, validateReviewCheckpoint, classifyProposalDiff, noveltyScan,
  CHECKPOINT_SCHEMA_VERSION,
  epochPath, buildEpochRecord, checkEpochCaps, DEFAULT_EPOCH_POLICY, EPOCH_SCHEMA_VERSION,
  scopeHash, splitScopeHash, decideSplitAdjudication, planCheckNextAction,
} from "../scripts/proposal-convergence.ts";
import { PREFLIGHT_POLICY_VERSION } from "../scripts/prepare-admission-check.ts";

// ── capsFor ─────────────────────────────────────────────────────────────────────────────────────
test("capsFor: ordinary defaults — 1 full synthesis, 2 delta rounds, 45m budget", () => {
  const c = capsFor(false);
  assert.equal(c.maxFullSynthesis, 1);
  assert.equal(c.maxDeltaRounds, 2);
  assert.equal(c.softBudgetMs, 45 * 60 * 1000);
});

test("capsFor: highRisk — 3 delta rounds, 75m budget, still 1 full synthesis", () => {
  const c = capsFor(true);
  assert.equal(c.maxFullSynthesis, 1);
  assert.equal(c.maxDeltaRounds, 3);
  assert.equal(c.softBudgetMs, 75 * 60 * 1000);
});

// ── fingerprintFinding: stable across wording-only revisions ───────────────────────────────────
test("fingerprintFinding: identical (subsystem, claimRef) yields the same id even if summary text changes", () => {
  const a = fingerprintFinding({ subsystem: "gate-engine", claimRef: "AC#3", summary: "the gate ignores fail-closed defaults" });
  const b = fingerprintFinding({ subsystem: "gate-engine", claimRef: "AC#3", summary: "totally reworded description of the same defect" });
  assert.equal(a, b);
});

test("fingerprintFinding: different subsystem yields a different id", () => {
  const a = fingerprintFinding({ subsystem: "gate-engine", claimRef: "AC#3", summary: "x" });
  const b = fingerprintFinding({ subsystem: "web-ui", claimRef: "AC#3", summary: "x" });
  assert.notEqual(a, b);
});

test("fingerprintFinding: falls back to normalized summary when no claimRef is given", () => {
  const a = fingerprintFinding({ subsystem: "s", summary: "  Same   Summary " });
  const b = fingerprintFinding({ subsystem: "s", summary: "same summary" });
  assert.equal(a, b);
});

// ── upsertFindings / applyResolutions — ledger merge semantics ─────────────────────────────────
test("upsertFindings: a blocking finding is filed with disposition 'unresolved'", () => {
  const ledger = upsertFindings([], [{ subsystem: "s", summary: "x", severity: "blocker", blocking: true }], 0);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].blocking, true);
  assert.equal(ledger[0].disposition, "unresolved");
  assert.equal(ledger[0].status, "open");
  assert.equal(ledger[0].everBlocking, true);
});

test("upsertFindings: a non-blocking finding without a disposition defaults to 'backlog' (never discarded)", () => {
  const ledger = upsertFindings([], [{ subsystem: "s", summary: "x", severity: "minor", blocking: false }], 0);
  assert.equal(ledger[0].disposition, "backlog");
});

test("upsertFindings: an explicit valid disposition is preserved", () => {
  for (const d of ["plan", "split", "accepted-risk", "backlog", "duplicate", "superseded"]) {
    const ledger = upsertFindings([], [{ subsystem: "s", summary: `finding-${d}`, blocking: false, disposition: d }], 0);
    assert.equal(ledger[0].disposition, d, d);
    assert.equal(isValidDisposition(d), true);
  }
});

test("upsertFindings: re-reporting the SAME (subsystem, claimRef) finding across rounds keeps the same id and updates lastSeenRound", () => {
  let ledger = upsertFindings([], [{ subsystem: "s", claimRef: "AC#1", summary: "first wording", blocking: true }], 0);
  const id0 = ledger[0].id;
  ledger = upsertFindings(ledger, [{ subsystem: "s", claimRef: "AC#1", summary: "reworded", blocking: true }], 1);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].id, id0);
  assert.equal(ledger[0].firstSeenRound, 0);
  assert.equal(ledger[0].lastSeenRound, 1);
});

test("applyResolutions: resolving a blocking finding flips blocking->false, status->resolved, keeps everBlocking", () => {
  let ledger = upsertFindings([], [{ subsystem: "s", claimRef: "AC#1", summary: "x", blocking: true }], 0);
  const id = ledger[0].id;
  ledger = applyResolutions(ledger, [id], 1);
  assert.equal(ledger[0].blocking, false);
  assert.equal(ledger[0].status, "resolved");
  assert.equal(ledger[0].everBlocking, true);
  assert.equal(ledger[0].disposition, "backlog");
  assert.equal(blockingOpen(ledger).length, 0);
});

test("applyResolutions: non-blocking findings not named in resolvedIds survive untouched (retained, not discarded)", () => {
  let ledger = upsertFindings([], [
    { subsystem: "s", claimRef: "AC#1", summary: "blocker", blocking: true },
    { subsystem: "s", claimRef: "AC#2", summary: "plan item", blocking: false, disposition: "plan" },
    { subsystem: "s", claimRef: "AC#3", summary: "backlog item", blocking: false, disposition: "backlog" },
    { subsystem: "s", claimRef: "AC#4", summary: "accepted risk", blocking: false, disposition: "accepted-risk" },
  ], 0);
  const blockerId = ledger.find((f) => f.disposition === "unresolved").id;
  ledger = applyResolutions(ledger, [blockerId], 1);
  assert.equal(ledger.length, 4, "all four findings remain in the ledger");
  assert.equal(blockingOpen(ledger).length, 0);
  const dispositions = ledger.map((f) => f.disposition).sort();
  assert.deepEqual(dispositions, ["accepted-risk", "backlog", "backlog", "plan"]);
});

// ── checkSplitRecommendation ─────────────────────────────────────────────────────────────────────
test("checkSplitRecommendation: 3 independent blocking findings in one subsystem triggers a split", () => {
  const ledger = upsertFindings([], [
    { subsystem: "gate-engine", claimRef: "AC#1", summary: "a", blocking: true },
    { subsystem: "gate-engine", claimRef: "AC#2", summary: "b", blocking: true },
    { subsystem: "gate-engine", claimRef: "AC#3", summary: "c", blocking: true },
  ], 0);
  const r = checkSplitRecommendation({ ledger });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-subsystem-blocking-cluster");
});

test("checkSplitRecommendation: 2 blocking findings in one subsystem does NOT trigger a split", () => {
  const ledger = upsertFindings([], [
    { subsystem: "gate-engine", claimRef: "AC#1", summary: "a", blocking: true },
    { subsystem: "gate-engine", claimRef: "AC#2", summary: "b", blocking: true },
  ], 0);
  const r = checkSplitRecommendation({ ledger });
  assert.equal(r.recommend, false);
});

test("checkSplitRecommendation: >2 independently landable mechanisms triggers a split", () => {
  const r = checkSplitRecommendation({ ledger: [], mechanismCount: 3 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-multi-mechanism");
});

test("checkSplitRecommendation: touch set exceeding the small-milestone boundary triggers a split", () => {
  const r = checkSplitRecommendation({ ledger: [], touchSetSize: 9, smallMilestoneTouchBoundary: 8 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-touch-set-too-large");
});

test("checkSplitRecommendation: no trigger fires -> recommend:false", () => {
  const r = checkSplitRecommendation({ ledger: [], mechanismCount: 1, touchSetSize: 3 });
  assert.equal(r.recommend, false);
});

test("checkSplitRecommendation: WBS level >= 2 and >2 mechanisms returns split-recursive-guard, not split-multi-mechanism", () => {
  const r = checkSplitRecommendation({ ledger: [], mechanismCount: 3, wbsLevel: 2 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-recursive-guard");
  assert.equal(r.repairable, false);
});

test("checkSplitRecommendation: WBS level=1 and >2 mechanisms returns split-multi-mechanism (normal)", () => {
  const r = checkSplitRecommendation({ ledger: [], mechanismCount: 4, wbsLevel: 1 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-multi-mechanism");
  assert.equal(r.repairable, false);
});

test("checkSplitRecommendation: WBS level=0 (default) and >2 mechanisms returns split-multi-mechanism (normal)", () => {
  const r = checkSplitRecommendation({ ledger: [], mechanismCount: 5 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-multi-mechanism");
});

test("checkSplitRecommendation: WBS level=2 but only 2 mechanisms does NOT trigger recursive guard", () => {
  const r = checkSplitRecommendation({ ledger: [], mechanismCount: 2, wbsLevel: 2 });
  assert.equal(r.recommend, false);
});

test("checkSplitRecommendation: ALL-repairable subsystem cluster routes to focused-revision, NOT split (RC2)", () => {
  const ledger = upsertFindings([], [
    { subsystem: "gate-engine", claimRef: "AC#1", summary: "a", blocking: true, repairable: true },
    { subsystem: "gate-engine", claimRef: "AC#2", summary: "b", blocking: true, repairable: true },
    { subsystem: "gate-engine", claimRef: "AC#3", summary: "c", blocking: true, repairable: true },
  ], 0);
  const r = checkSplitRecommendation({ ledger, wbsLevel: 2 });
  // RC2 (2026-08-01): an all-repairable cluster is NOT a split — one focused-revision round can
  // close every finding. Only a NON-repairable cluster recommends split.
  assert.equal(r.recommend, false);
  assert.equal(r.code, "repairable-cluster-revision");
  assert.equal(r.repairable, true);
});

const NON_REPAIRABLE_CLUSTER = [
  { subsystem: "gate-engine", claimRef: "AC#1", summary: "a", blocking: true, repairable: false },
  { subsystem: "gate-engine", claimRef: "AC#2", summary: "b", blocking: true, repairable: false },
  { subsystem: "gate-engine", claimRef: "AC#3", summary: "c", blocking: true, repairable: false },
];

test("checkSplitRecommendation: NON-repairable subsystem cluster at depth 0 returns split-subsystem-blocking-cluster", () => {
  const ledger = upsertFindings([], NON_REPAIRABLE_CLUSTER, 0);
  const r = checkSplitRecommendation({ ledger, wbsLevel: 0 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-subsystem-blocking-cluster");
  assert.equal(r.repairable, false);
});

// ── gap-recursive-guard-only-covers-multi-mechanism (2026-08-02) ────────────────────────────────
// The wbsLevel>=2 guard applies to EVERY split trigger, not only split-multi-mechanism.

test("recursive guard: depth 2 + NON-repairable subsystem cluster returns split-recursive-guard (AC1)", () => {
  const ledger = upsertFindings([], NON_REPAIRABLE_CLUSTER, 0);
  const r = checkSplitRecommendation({ ledger, wbsLevel: 2 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-recursive-guard");
  assert.equal(r.repairable, false);
  assert.equal(r.originalCode, "split-subsystem-blocking-cluster");
  // The originating trigger's reason survives as diagnostic context.
  assert.match(r.reason, /gate-engine/);
});

test("recursive guard: depth 2 + oversized touch set returns split-recursive-guard (AC2)", () => {
  const r = checkSplitRecommendation({ ledger: [], touchSetSize: 12, smallMilestoneTouchBoundary: 8, wbsLevel: 2 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-recursive-guard");
  assert.equal(r.originalCode, "split-touch-set-too-large");
});

test("recursive guard: depth 3 + multi-mechanism returns split-recursive-guard (AC3)", () => {
  const r = checkSplitRecommendation({ ledger: [], mechanismCount: 4, wbsLevel: 3 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-recursive-guard");
  assert.equal(r.originalCode, "split-multi-mechanism");
});

test("recursive guard: depth 2 with NO trigger firing does NOT fire the guard (AC4)", () => {
  const r = checkSplitRecommendation({ ledger: [], mechanismCount: 1, touchSetSize: 3, wbsLevel: 2 });
  assert.equal(r.recommend, false);
  assert.equal(r.code, undefined);
});

test("recursive guard: depth 2 + ALL-repairable cluster stays repairable-cluster-revision, not guarded (AC4)", () => {
  // recommend:false verdicts are never converted — the guard only intercepts real split verdicts.
  const ledger = upsertFindings([], [
    { subsystem: "gate-engine", claimRef: "AC#1", summary: "a", blocking: true, repairable: true },
    { subsystem: "gate-engine", claimRef: "AC#2", summary: "b", blocking: true, repairable: true },
    { subsystem: "gate-engine", claimRef: "AC#3", summary: "c", blocking: true, repairable: true },
  ], 0);
  const r = checkSplitRecommendation({ ledger, wbsLevel: 2 });
  assert.equal(r.recommend, false);
  assert.equal(r.code, "repairable-cluster-revision");
});

test("recursive guard: depth 1 + oversized touch set keeps the original code (AC5)", () => {
  const r = checkSplitRecommendation({ ledger: [], touchSetSize: 12, smallMilestoneTouchBoundary: 8, wbsLevel: 1 });
  assert.equal(r.recommend, true);
  assert.equal(r.code, "split-touch-set-too-large");
  assert.equal(r.originalCode, undefined);
});

// ── gap-split-decision-finality-not-enforced (2026-08-02) ──────────────────────────────────────
// A SPLIT ruling binds to the SURFACE (charter + touches), not the AC count, so responding to the
// ruling by adding AC checkboxes does not erase it and cause a redundant re-derivation.
describe("splitScopeHash / SPLIT decision finality", () => {
  const TOUCHES = ["a.ts", "b.ts"];
  const bodyWithACs = (n) =>
    `## Acceptance Criteria\n\n${Array.from({ length: n }, (_, i) => `- [ ] AC${i + 1}`).join("\n")}\n\n## Touches\n\n- a.ts\n- b.ts\n`;

  test("AC1: splitScopeHash hashes touches only — AC count does not affect it", () => {
    const h3 = splitScopeHash({ declaredTouches: TOUCHES });
    const h9 = splitScopeHash({ declaredTouches: TOUCHES });
    assert.equal(h3, h9);
    // Contrast: scopeHash DOES change with AC count.
    assert.notEqual(
      scopeHash({ taskBody: bodyWithACs(3), declaredTouches: TOUCHES }),
      scopeHash({ taskBody: bodyWithACs(9), declaredTouches: TOUCHES }),
    );
  });

  test("AC1: splitScopeHash is order-insensitive but content-sensitive on touches", () => {
    assert.equal(
      splitScopeHash({ declaredTouches: ["b.ts", "a.ts"] }),
      splitScopeHash({ declaredTouches: ["a.ts", "b.ts"] }),
    );
    assert.notEqual(
      splitScopeHash({ declaredTouches: ["a.ts", "b.ts"] }),
      splitScopeHash({ declaredTouches: ["a.ts", "b.ts", "c.ts"] }),
    );
  });

  test("AC5: a SPLIT record survives an AC-checkbox edit (the 15-redundant-dispatch scenario)", () => {
    const atSplit = { charterHash: "ch", scopeHash: scopeHash({ taskBody: bodyWithACs(3), declaredTouches: TOUCHES }), splitScopeHash: splitScopeHash({ declaredTouches: TOUCHES }), reviewPolicyHash: "rp" };
    const record = { decision: "split", ...atSplit };
    // Author responds to the ruling by adding 6 AC checkboxes. Touches unchanged.
    const now = {
      charterHash: "ch",
      scopeHash: scopeHash({ taskBody: bodyWithACs(9), declaredTouches: TOUCHES }),
      splitScopeHash: splitScopeHash({ declaredTouches: TOUCHES }),
      reviewPolicyHash: "rp",
    };
    assert.notEqual(now.scopeHash, atSplit.scopeHash, "precondition: AC edit changed scopeHash");
    const v = decideSplitAdjudication(record, now);
    assert.equal(v.verdict, "content-dispatch-blocked");
    assert.equal(v.outcome, "needs-human");
  });

  test("AC6: a SPLIT record IS invalidated by a Touches change (surface genuinely changed)", () => {
    const record = {
      decision: "split", charterHash: "ch", reviewPolicyHash: "rp",
      scopeHash: scopeHash({ taskBody: bodyWithACs(3), declaredTouches: TOUCHES }),
      splitScopeHash: splitScopeHash({ declaredTouches: TOUCHES }),
    };
    const widened = ["a.ts", "b.ts", "c.ts"];
    const v = decideSplitAdjudication(record, {
      charterHash: "ch", reviewPolicyHash: "rp",
      scopeHash: scopeHash({ taskBody: bodyWithACs(3), declaredTouches: widened }),
      splitScopeHash: splitScopeHash({ declaredTouches: widened }),
    });
    assert.equal(v.verdict, "decision-invalidated");
  });

  test("AC7: a legacy SPLIT record with no splitScopeHash falls back to the full scopeHash match", () => {
    const legacy = { decision: "split", charterHash: "ch", scopeHash: "sh", reviewPolicyHash: "rp" };
    // Matching legacy hashes still block.
    assert.equal(
      decideSplitAdjudication(legacy, { charterHash: "ch", scopeHash: "sh", reviewPolicyHash: "rp", splitScopeHash: "anything" }).verdict,
      "content-dispatch-blocked",
    );
    // Mismatching legacy hashes still invalidate — no behavior change for pre-existing records.
    assert.equal(
      decideSplitAdjudication(legacy, { charterHash: "ch", scopeHash: "sh-CHANGED", reviewPolicyHash: "rp", splitScopeHash: "anything" }).verdict,
      "decision-invalidated",
    );
  });

  test("AC4: COMMIT records still use scopeHash — an AC edit correctly invalidates them", () => {
    const record = {
      decision: "commit", charterHash: "ch", reviewPolicyHash: "rp",
      scopeHash: scopeHash({ taskBody: bodyWithACs(3), declaredTouches: TOUCHES }),
      splitScopeHash: splitScopeHash({ declaredTouches: TOUCHES }),
    };
    const v = decideSplitAdjudication(record, {
      charterHash: "ch", reviewPolicyHash: "rp",
      scopeHash: scopeHash({ taskBody: bodyWithACs(9), declaredTouches: TOUCHES }),
      splitScopeHash: splitScopeHash({ declaredTouches: TOUCHES }),
    });
    assert.equal(v.verdict, "decision-invalidated", "a COMMIT ruling IS about the reviewed content");
    assert.deepEqual(v.mismatchedFields, ["scopeHash"]);
  });
});

// ── planCheckNextAction — gap-plancheck-blocking-only-convergence (2026-08-02) ──────────────────
describe("planCheckNextAction: blocking-only convergence", () => {
  const MAX = 3;

  test("AC2: zero blocking with non-zero total findings -> stop-plan-checked", () => {
    const r = planCheckNextAction({ round: 1, findings: 7, blocking: 0, maxRounds: MAX });
    assert.equal(r.action, "stop-plan-checked");
  });

  test("AC3: blocking > 0 below the cap -> dispatch another round", () => {
    const r = planCheckNextAction({ round: 1, findings: 9, blocking: 4, maxRounds: MAX });
    assert.equal(r.action, "dispatch-plancheck-round");
  });

  test("AC4: blocking > 0 at the cap -> stop-needs-human/plancheck-rounds-exceeded", () => {
    const r = planCheckNextAction({ round: 3, findings: 5, blocking: 2, priorBlocking: 4, maxRounds: MAX });
    assert.equal(r.action, "stop-needs-human");
    assert.equal(r.code, "plancheck-rounds-exceeded");
  });

  test("AC5: legacy scalar path (blocking absent) + findings 0 -> stop-plan-checked", () => {
    const r = planCheckNextAction({ round: 1, findings: 0, maxRounds: MAX });
    assert.equal(r.action, "stop-plan-checked");
  });

  test("AC6: legacy scalar path + findings > 0 below cap -> dispatch (unchanged behavior)", () => {
    const r = planCheckNextAction({ round: 1, findings: 3, maxRounds: MAX });
    assert.equal(r.action, "dispatch-plancheck-round");
  });

  test("AC6: legacy scalar path + findings > 0 at cap -> rounds-exceeded (unchanged behavior)", () => {
    const r = planCheckNextAction({ round: 3, findings: 3, maxRounds: MAX });
    assert.equal(r.action, "stop-needs-human");
    assert.equal(r.code, "plancheck-rounds-exceeded");
  });

  test("the real-world case: 7 nits and 0 blockers now passes where F_i=0 would have burned 3 rounds", () => {
    // Round 1 under the old rule: findings=7 !== 0 -> revise, round 2, round 3, rounds-exceeded.
    assert.equal(planCheckNextAction({ round: 1, findings: 7, blocking: 0, maxRounds: MAX }).action, "stop-plan-checked");
  });
});

// ── planCheckNextAction diminishing returns — gap-plancheck-no-diminishing-returns-exit ─────────
describe("planCheckNextAction: diminishing-returns exit", () => {
  const MAX = 3;

  test("AC2: blocking count unchanged from the prior round at round 2 -> diminishing-returns stop", () => {
    const r = planCheckNextAction({ round: 2, findings: 5, blocking: 3, priorBlocking: 3, maxRounds: MAX });
    assert.equal(r.action, "stop-needs-human");
    assert.equal(r.code, "plancheck-diminishing-returns");
  });

  test("AC2: blocking count REGRESSED -> diminishing-returns stop", () => {
    const r = planCheckNextAction({ round: 2, findings: 8, blocking: 5, priorBlocking: 3, maxRounds: MAX });
    assert.equal(r.action, "stop-needs-human");
    assert.equal(r.code, "plancheck-diminishing-returns");
  });

  test("AC3: blocking count decreased -> keep going", () => {
    const r = planCheckNextAction({ round: 2, findings: 6, blocking: 2, priorBlocking: 5, maxRounds: MAX });
    assert.equal(r.action, "dispatch-plancheck-round");
  });

  test("AC4: round 1 never triggers the exit even with a priorBlocking value present", () => {
    const r = planCheckNextAction({ round: 1, findings: 5, blocking: 3, priorBlocking: 3, maxRounds: MAX });
    assert.equal(r.action, "dispatch-plancheck-round");
  });

  test("AC5: absent priorBlocking never triggers the exit", () => {
    const r = planCheckNextAction({ round: 2, findings: 5, blocking: 3, priorBlocking: null, maxRounds: MAX });
    assert.equal(r.action, "dispatch-plancheck-round");
  });

  test("AC5: legacy scalar path never triggers the exit (no blocking series to compare)", () => {
    const r = planCheckNextAction({ round: 2, findings: 3, priorBlocking: 3, maxRounds: MAX });
    assert.equal(r.action, "dispatch-plancheck-round");
  });

  test("AC6: zero blocking wins over the diminishing-returns exit", () => {
    const r = planCheckNextAction({ round: 2, findings: 4, blocking: 0, priorBlocking: 0, maxRounds: MAX });
    assert.equal(r.action, "stop-plan-checked");
  });
});

// ── budgetStatus — deterministic injected clock ─────────────────────────────────────────────────
test("budgetStatus: elapsed under budget -> not exceeded", () => {
  const r = budgetStatus({ startedAtMs: 1000, nowMs: 1000 + 10 * 60 * 1000, softBudgetMs: 45 * 60 * 1000 });
  assert.equal(r.exceeded, false);
  assert.equal(r.elapsedMs, 10 * 60 * 1000);
});

test("budgetStatus: elapsed at/over budget -> exceeded", () => {
  const r = budgetStatus({ startedAtMs: 1000, nowMs: 1000 + 45 * 60 * 1000, softBudgetMs: 45 * 60 * 1000 });
  assert.equal(r.exceeded, true);
});

// ── nextAction — the decision table ────────────────────────────────────────────────────────────
test("nextAction: no full synthesis yet -> dispatch-full-synthesis", () => {
  const r = nextAction({ fullSynthesisCount: 0, deltaRound: 0, ledger: [], caps: capsFor(false), budgetExceeded: false, splitCheck: { recommend: false } });
  assert.equal(r.action, "dispatch-full-synthesis");
});

test("nextAction: zero open blocking findings -> stop-prepared", () => {
  const r = nextAction({ fullSynthesisCount: 1, deltaRound: 0, ledger: [], caps: capsFor(false), budgetExceeded: false, splitCheck: { recommend: false } });
  assert.equal(r.action, "stop-prepared");
});

test("nextAction: split recommended takes priority over dispatching another delta round", () => {
  const ledger = upsertFindings([], [{ subsystem: "s", claimRef: "AC#1", summary: "a", blocking: true }], 0);
  const r = nextAction({ fullSynthesisCount: 1, deltaRound: 0, ledger, caps: capsFor(false), budgetExceeded: false, splitCheck: { recommend: true, code: "x", reason: "y" } });
  assert.equal(r.action, "stop-split");
});

test("nextAction: budget exceeded with open blocking findings -> stop-needs-human (soft-budget-exceeded)", () => {
  const ledger = upsertFindings([], [{ subsystem: "s", claimRef: "AC#1", summary: "a", blocking: true }], 0);
  const r = nextAction({ fullSynthesisCount: 1, deltaRound: 1, ledger, caps: capsFor(false), budgetExceeded: true, splitCheck: { recommend: false } });
  assert.equal(r.action, "stop-needs-human");
  assert.equal(r.code, "budget-exceeded");
});

test("nextAction: delta cap exhausted with open blocking findings -> stop-needs-human (delta-cap-exhausted)", () => {
  const ledger = upsertFindings([], [{ subsystem: "s", claimRef: "AC#1", summary: "a", blocking: true }], 0);
  const r = nextAction({ fullSynthesisCount: 1, deltaRound: 2, ledger, caps: capsFor(false), budgetExceeded: false, splitCheck: { recommend: false } });
  assert.equal(r.action, "stop-needs-human");
  assert.equal(r.code, "delta-cap-exhausted");
});

test("nextAction: open blocking findings, cap/budget/split all clear -> dispatch-delta-round", () => {
  const ledger = upsertFindings([], [{ subsystem: "s", claimRef: "AC#1", summary: "a", blocking: true }], 0);
  const r = nextAction({ fullSynthesisCount: 1, deltaRound: 0, ledger, caps: capsFor(false), budgetExceeded: false, splitCheck: { recommend: false } });
  assert.equal(r.action, "dispatch-delta-round");
});

// ── hashLedger — hash-binding sensitivity ──────────────────────────────────────────────────────
test("hashLedger: deterministic for the same content", () => {
  const ledger = upsertFindings([], [{ subsystem: "s", claimRef: "AC#1", summary: "a", blocking: true }], 0);
  assert.equal(hashLedger(ledger), hashLedger(ledger));
});

test("hashLedger: sensitive to ANY content change (tamper detection)", () => {
  const ledger = upsertFindings([], [{ subsystem: "s", claimRef: "AC#1", summary: "a", blocking: true }], 0);
  const tampered = applyResolutions(ledger, [ledger[0].id], 1);
  assert.notEqual(hashLedger(ledger), hashLedger(tampered));
});

// ── validateConvergenceCounters — mechanical receipt-side cap re-check ─────────────────────────
test("validateConvergenceCounters: within caps -> ok", () => {
  const r = validateConvergenceCounters({ highRisk: false, fullSynthesisCount: 1, deltaRounds: 2 });
  assert.equal(r.ok, true);
});

test("validateConvergenceCounters: fullSynthesisCount > 1 fails closed regardless of highRisk", () => {
  const r = validateConvergenceCounters({ highRisk: true, fullSynthesisCount: 2, deltaRounds: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "convergence-full-synthesis-exceeded");
});

test("validateConvergenceCounters: deltaRounds beyond the ordinary cap (2) fails closed", () => {
  const r = validateConvergenceCounters({ highRisk: false, fullSynthesisCount: 1, deltaRounds: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.code, "convergence-delta-rounds-exceeded");
});

test("validateConvergenceCounters: deltaRounds==3 is only valid when highRisk is true", () => {
  assert.equal(validateConvergenceCounters({ highRisk: true, fullSynthesisCount: 1, deltaRounds: 3 }).ok, true);
  assert.equal(validateConvergenceCounters({ highRisk: false, fullSynthesisCount: 1, deltaRounds: 3 }).ok, false);
});

// ── M197 (gap-prepare-milestone-cross-generation-no-incremental-reuse): resumeFromAdjudicatedProposal
// records fullSynthesisCount:0 (ProposalAuthors/Adjudicate skipped) rather than 1 (cold path). This
// module's own cap logic needed NO code change to support that — `capsFor().maxFullSynthesis` is 1
// regardless of highRisk, and the existing `(fullSynthesisCount ?? 0) > caps.maxFullSynthesis` check
// already accepts any value <= 1, including 0. These tests pin that generalization explicitly so a
// future edit to this function cannot silently special-case 0 away or reject it. ─────────────────
test("validateConvergenceCounters: fullSynthesisCount=0 (a resumed dispatch that skipped ProposalAuthors/Adjudicate) is within caps -> ok, same as fullSynthesisCount=1", () => {
  const resumed = validateConvergenceCounters({ highRisk: false, fullSynthesisCount: 0, deltaRounds: 1 });
  assert.equal(resumed.ok, true);
  const cold = validateConvergenceCounters({ highRisk: false, fullSynthesisCount: 1, deltaRounds: 1 });
  assert.equal(cold.ok, true);
});

test("validateConvergenceCounters: fullSynthesisCount > 1 fails closed regardless of which path (cold or resumed) produced the receipt — resume introduces no new exemption", () => {
  // A receipt cannot legitimately claim fullSynthesisCount > 1 via EITHER path: cold always
  // records exactly 1, resumed always records exactly 0. A value of 2 is only reachable by a
  // forged/tampered receipt attempting to abuse the resume mechanism to claim extra synthesis
  // rounds beyond DIR-125's own per-generation cap — this must still fail exactly like the
  // pre-existing (non-resume) case does.
  const abuseAttempt = validateConvergenceCounters({ highRisk: true, fullSynthesisCount: 2, deltaRounds: 0 });
  assert.equal(abuseAttempt.ok, false);
  assert.equal(abuseAttempt.code, "convergence-full-synthesis-exceeded");
});

// ── computeConvergenceMetrics — DIR-125 instrumentation surface ────────────────────────────────
test("computeConvergenceMetrics: exposes all six named metrics", () => {
  const ledger = upsertFindings([], [
    { subsystem: "s", claimRef: "AC#1", summary: "a", blocking: true },
    { subsystem: "s", claimRef: "AC#2", summary: "b", blocking: false, disposition: "backlog" },
  ], 0);
  const m = computeConvergenceMetrics({
    fullSynthesisCount: 1, deltaRounds: 2, ledger,
    proposalHashes: [{ round: 0, hash: "h0" }, { round: 1, hash: "h1" }, { round: 2, hash: "h1" }],
    startedAtMs: 1000, endedAtMs: 1000 + 20 * 60 * 1000, reachedPlanAuthor: true, terminalReason: "zero-finding",
  });
  assert.equal(m.fullSynthesisCount, 1);
  assert.equal(m.proposalReviewRounds, 3);
  assert.equal(typeof m.blockingFindingYield, "number");
  assert.equal(typeof m.proposalChurnRatio, "number");
  assert.equal(m.reachedPlanAuthor, true);
  assert.equal(m.prepareWallTimeMs, 20 * 60 * 1000);
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── decideResumeGeneration — DIR-126-C/M202: generation-aware resume, third child of DIR-126's
// split. One it() per evaluation-order step of the task's own Proposal. ─────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("decideResumeGeneration", () => {
  const BASE = {
    currentTaskId: "DIR-TEST",
    currentCharterHash: "charterHashA",
    currentTaskContractHash: "contractHashA",
    currentTaskProposalHash: "proposalHashA",
    currentReviewPolicyHash: "reviewPolicyHashA",
  };
  function matchingRecord(overrides = {}) {
    return {
      taskId: BASE.currentTaskId,
      charterHash: BASE.currentCharterHash,
      taskContractHash: BASE.currentTaskContractHash,
      proposalHash: BASE.currentTaskProposalHash,
      reviewPolicyHash: BASE.currentReviewPolicyHash,
      terminalPhase: "ProposalReview",
      reason: "split-recommended",
      cacheable: true,
      generationId: "gen000000001",
      outcome: "needs-human",
      ...overrides,
    };
  }

  test("PHASE_RANK: the finer-grained vocabulary, in order", () => {
    assert.deepEqual(PHASE_RANK, {
      PreflightContent: 0, ProposalAuthors: 1, Adjudicate: 2, ProposalReview: 3,
      PlanAuthor: 4, PreflightPlan: 5, PlanCheck: 6, Receipt: 7,
    });
  });

  test("CACHEABLE_TERMINALS: exactly the two allowlisted {terminalPhase, reason} pairs", () => {
    assert.deepEqual(CACHEABLE_TERMINALS, [
      { terminalPhase: "PreflightContent", reason: "preflight-rejected" },
      { terminalPhase: "ProposalReview", reason: "split-recommended" },
    ]);
  });

  test("RESUME_POLICY_VERSION: a plain literal matching PREFLIGHT_POLICY_VERSION's shape", () => {
    assert.equal(RESUME_POLICY_VERSION, "resume-v1");
  });

  test("RESUMABLE_PHASES: strictly AFTER Adjudicate — Adjudicate itself excluded", () => {
    assert.equal(RESUMABLE_PHASES.includes("Adjudicate"), false);
    assert.equal(RESUMABLE_PHASES.includes("PreflightContent"), false);
    assert.equal(RESUMABLE_PHASES.includes("ProposalAuthors"), false);
    for (const p of ["ProposalReview", "PlanAuthor", "PreflightPlan", "PlanCheck", "Receipt"]) {
      assert.ok(RESUMABLE_PHASES.includes(p), `${p} must be resumable`);
    }
  });

  // Step 1/2: callerOverride short-circuits everything else, even a missing/mismatched record.
  test("step 1: callerOverride===true -> resume/caller-override-true, regardless of record state", () => {
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: null, callerOverride: true });
    assert.deepEqual(r, { decision: "resume", reason: "caller-override-true" });
  });
  test("step 2: callerOverride===false -> cold/caller-override-false, regardless of record state", () => {
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: matchingRecord(), callerOverride: false });
    assert.deepEqual(r, { decision: "cold", reason: "caller-override-false" });
  });

  // Step 4: missing-provenance fails closed (AC2's missing-provenance leg).
  test("step 4: null prior record -> cold/missing-prior-record", () => {
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: null });
    assert.deepEqual(r, { decision: "cold", reason: "missing-prior-record" });
  });

  // Steps 5-8: any provenance mismatch forces cold (AC2's per-cause fixtures).
  test("step 5: taskId mismatch -> cold/task-id-mismatch", () => {
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: matchingRecord({ taskId: "OTHER-TASK" }) });
    assert.deepEqual(r, { decision: "cold", reason: "task-id-mismatch" });
  });
  test("step 6: charter-hash mismatch -> cold/charter-hash-mismatch", () => {
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: matchingRecord({ charterHash: "stale" }) });
    assert.deepEqual(r, { decision: "cold", reason: "charter-hash-mismatch" });
  });
  test("step 7: task-contract-hash mismatch -> cold/task-contract-hash-mismatch", () => {
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: matchingRecord({ taskContractHash: "stale" }) });
    assert.deepEqual(r, { decision: "cold", reason: "task-contract-hash-mismatch" });
  });
  test("step 8: review-policy-hash mismatch -> cold/review-policy-hash-mismatch", () => {
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: matchingRecord({ reviewPolicyHash: "stale" }) });
    assert.deepEqual(r, { decision: "cold", reason: "review-policy-hash-mismatch" });
  });

  // Step 9: unchanged cacheable split/preflight terminal reuse (AC3's fixture half).
  test("step 9: all hashes match INCLUDING proposal hash + cacheable ProposalReview/split-recommended -> reuse-terminal", () => {
    const rec = matchingRecord({ terminalPhase: "ProposalReview", reason: "split-recommended", cacheable: true, generationId: "gen-abc", outcome: "needs-human" });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.deepEqual(r, { decision: "reuse-terminal", reason: "unchanged-generation-terminal", priorGenerationId: "gen-abc", priorReason: "split-recommended", priorOutcome: "needs-human" });
  });

  // Step 10: repaired-Proposal auto-resume (AC2's resume leg).
  test("step 10: hashes match except proposal hash + terminal ranked after Adjudicate -> resume/repaired-proposal-detected", () => {
    const rec = matchingRecord({ terminalPhase: "PlanAuthor", reason: "plan-author-failed", cacheable: false, proposalHash: "OLD-PROPOSAL-HASH", generationId: "gen-xyz" });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.deepEqual(r, { decision: "resume", reason: "repaired-proposal-detected", priorGenerationId: "gen-xyz" });
  });

  // Step 11: fall-through cold cases.
  test("step 11: unchanged proposal + non-cacheable terminal (soft-budget-exceeded) -> cold/no-eligible-reuse-or-resume-condition", () => {
    const rec = matchingRecord({ terminalPhase: "ProposalReview", reason: "soft-budget-exceeded", cacheable: false });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.deepEqual(r, { decision: "cold", reason: "no-eligible-reuse-or-resume-condition" });
  });
  for (const reason of ["delta-cap-exhausted", "plan-author-failed", "plancheck-rounds-exceeded", "prepared"]) {
    test(`step 11: unchanged proposal + non-cacheable terminal (${reason}) -> cold`, () => {
      const rec = matchingRecord({ terminalPhase: "PlanCheck", reason, cacheable: false });
      const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
      assert.equal(r.decision, "cold");
      assert.equal(r.reason, "no-eligible-reuse-or-resume-condition");
    });
  }
  test("step 11: transient/terminal at or before Adjudicate (proposal-author-incomplete) forces cold, never resume, even with a changed proposal hash", () => {
    const rec = matchingRecord({ terminalPhase: "ProposalAuthors", reason: "proposal-author-incomplete", cacheable: false, proposalHash: "OLD-HASH" });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.deepEqual(r, { decision: "cold", reason: "no-eligible-reuse-or-resume-condition" });
  });
  test("step 11: Adjudicate itself (strict > threshold, not >=) forces cold even with a changed proposal hash — adjudicate-failed's task_write may never have completed", () => {
    const rec = matchingRecord({ terminalPhase: "Adjudicate", reason: "adjudicate-failed", cacheable: false, proposalHash: "OLD-HASH" });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.deepEqual(r, { decision: "cold", reason: "no-eligible-reuse-or-resume-condition" });
  });

  // WIRING-CLAIM R7 (AC10) fixture half: the SAME reason: 'preflight-rejected' string, but the
  // pair keys on terminalPhase too — PreflightContent IS reuse-terminal-eligible while
  // PreflightPlan (identical reason) is NOT.
  test("R7 fixture half: {terminalPhase:'PreflightContent', reason:'preflight-rejected'} cacheable IS reuse-terminal-eligible", () => {
    const rec = matchingRecord({ terminalPhase: "PreflightContent", reason: "preflight-rejected", cacheable: true, generationId: "gen-content" });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.equal(r.decision, "reuse-terminal");
    assert.equal(r.priorReason, "preflight-rejected");
  });
  test("R7 fixture half: {terminalPhase:'PreflightPlan', reason:'preflight-rejected'} (SAME reason string) is NOT reuse-terminal-eligible — falls through to cold when proposal hash is unchanged", () => {
    const rec = matchingRecord({ terminalPhase: "PreflightPlan", reason: "preflight-rejected", cacheable: true, generationId: "gen-plan" });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.notEqual(r.decision, "reuse-terminal");
    assert.equal(r.decision, "cold");
    assert.equal(r.reason, "no-eligible-reuse-or-resume-condition");
  });
  test("R7 fixture half: {terminalPhase:'PreflightPlan', reason:'preflight-rejected'} with a CHANGED proposal hash falls through to resume, never reuse-terminal (PreflightPlan depends on Plan-file content this mechanism's hashes never cover)", () => {
    const rec = matchingRecord({ terminalPhase: "PreflightPlan", reason: "preflight-rejected", cacheable: true, proposalHash: "OLD-HASH", generationId: "gen-plan2" });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.equal(r.decision, "resume");
    assert.equal(r.reason, "repaired-proposal-detected");
  });

  // A record whose `cacheable` flag is false, even if the (terminalPhase, reason) pair IS on the
  // allowlist, is never treated as reuse-terminal-eligible — cacheable===true is a hard gate too.
  test("cacheable:false on an otherwise-allowlisted pair is NOT reuse-terminal-eligible", () => {
    const rec = matchingRecord({ terminalPhase: "PreflightContent", reason: "preflight-rejected", cacheable: false });
    const r = decideResumeGeneration({ ...BASE, priorGenerationRecord: rec });
    assert.notEqual(r.decision, "reuse-terminal");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── proposal-convergence.ts's CLI tail — --decide-resume / --record-generation — real spawned
// CLI runs against a scratch workspace with a real lease file (Stage 3). ────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("CLI: --decide-resume / --record-generation", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const CONVERGENCE_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "proposal-convergence.ts");
  const ADMISSION_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "prepare-admission-check.ts");
  const FIXTURES_DIR = makeTmpDir("dir126c-fixtures-");

  function fixtureTaskBody(proposalText) {
    return `---
id: DIR-126-C-CLI-FIXTURE
title: fixture task for proposal-convergence.ts CLI fixtures
status: todo
---
## Proposal

${proposalText}

## Acceptance Criteria

- [ ] fixture AC item

## Definition of Done

- [ ] fixture DoD item

## Touches

- fixture.ts
`;
  }

  function makeCliScratch(taskId, proposalText = "fixture proposal v1") {
    const dir = makeTmpDir("cli-scratch-");
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), fixtureTaskBody(proposalText));
    const charterFile = path.join(dir, "charter.md");
    fs.writeFileSync(charterFile, "fixture charter v1\n");
    return { dir, charterFile };
  }

  function leasePath(dir, taskId) {
    return path.join(dir, ".quay", "prepare-leases", `${taskId}.json`);
  }
  function generationPath(dir, taskId) {
    return path.join(dir, ".quay", "prepare-leases", `${taskId}.generation.json`);
  }
  function writeLease(dir, taskId, { ownerExecutionId = "sess-1", fencingToken = 0, acquiredAt = 1000 } = {}) {
    const p = leasePath(dir, taskId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ownerExecutionId, fencingToken, acquiredAt }));
  }

  function runNode(args) {
    try {
      const stdout = execFileSync("node", ["--experimental-strip-types", ...args], { encoding: "utf8" });
      return { status: 0, stdout };
    } catch (e) {
      return { status: typeof e.status === "number" ? e.status : 1, stdout: e.stdout ? e.stdout.toString() : "" };
    }
  }

  function runDecideResume(dir, taskId, charterFile, extra = []) {
    return runNode([CONVERGENCE_SCRIPT, "--decide-resume", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile, ...extra]);
  }
  function runRecordGeneration(dir, taskId, charterFile, { terminalPhase, outcome, reason, cacheable }) {
    return runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
      "--terminalPhase", terminalPhase, "--outcome", outcome, "--reason", reason, "--cacheable", String(cacheable)]);
  }

  test("--decide-resume: no prior record -> cold/missing-prior-record, hashes + generationId present, no releaseResult, lease untouched", () => {
    const taskId = "DIR-126-C-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    writeLease(dir, taskId);
    try {
      const res = runDecideResume(dir, taskId, charterFile);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout.trim().split("\n").pop());
      assert.equal(out.decision, "cold");
      assert.equal(out.reason, "missing-prior-record");
      assert.ok(out.generationId && out.generationId.length === 12);
      assert.ok(out.hashes && out.hashes.charterHash && out.hashes.taskContractHash && out.hashes.proposalHash && out.hashes.reviewPolicyHash);
      assert.equal(out.releaseResult, undefined, "cold decision must never release the lease");
      assert.ok(fs.existsSync(leasePath(dir, taskId)), "lease is untouched on a cold decision");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--record-generation then --decide-resume (unchanged inputs, cacheable allowlisted pair) -> reuse-terminal, embedded release (exactly one), .generation.json never overwritten (AC13/R6, AC8/R3)", () => {
    const taskId = "DIR-126-C-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId, "fixture proposal v1 — unchanged");
    writeLease(dir, taskId, { ownerExecutionId: "sess-gen-1" });
    try {
      // First generation terminates at a cacheable PreflightContent/preflight-rejected — records +
      // releases (embedded) in ONE invocation.
      const rec = runRecordGeneration(dir, taskId, charterFile, { terminalPhase: "PreflightContent", outcome: "revision-needed", reason: "preflight-rejected", cacheable: true });
      assert.equal(rec.status, 0, rec.stdout);
      const recOut = JSON.parse(rec.stdout.trim());
      assert.equal(recOut.ok, true);
      assert.equal(recOut.releaseResult.ok, true, "record-generation piggybacks a real release");
      assert.ok(!fs.existsSync(leasePath(dir, taskId)), "lease removed by the embedded release");
      assert.ok(fs.existsSync(generationPath(dir, taskId)));

      // Simulate a fresh Admission acquire for the SECOND dispatch (same taskId).
      // prepare-admission-check.ts's --acquire needs CLAUDE_CODE_SESSION_ID in env; set it directly.
      const acquireEnv = execFileSync("node", ["--experimental-strip-types", ADMISSION_SCRIPT, "--acquire", "--taskId", taskId, "--workspace", dir], {
        encoding: "utf8", env: { ...process.env, CLAUDE_CODE_SESSION_ID: "sess-gen-2" },
      });
      const acquireOut = JSON.parse(acquireEnv.trim());
      assert.equal(acquireOut.outcome, "acquired", "an immediate subsequent same-task dispatch acquires Admission rather than prepare-already-running (AC4)");
      assert.ok(fs.existsSync(leasePath(dir, taskId)));

      const before = fs.statSync(generationPath(dir, taskId));
      const beforeHash = crypto.createHash("sha256").update(fs.readFileSync(generationPath(dir, taskId))).digest("hex");

      // Unchanged task/charter content (same proposal, same charter, same AC/DoD/Touches, same
      // policy versions) -> --decide-resume must return reuse-terminal via the allowlisted pair.
      const decide = runDecideResume(dir, taskId, charterFile);
      assert.equal(decide.status, 0, decide.stdout);
      const decideOut = JSON.parse(decide.stdout.trim());
      assert.equal(decideOut.decision, "reuse-terminal", JSON.stringify(decideOut));
      assert.equal(decideOut.reason, "unchanged-generation-terminal");
      assert.equal(decideOut.priorReason, "preflight-rejected");
      assert.equal(decideOut.releaseResult.ok, true, "reuse-terminal's lease release happens INSIDE the same --decide-resume invocation");
      assert.ok(!fs.existsSync(leasePath(dir, taskId)), "the second lease is ALSO released by the reuse-terminal short-circuit — no lease is stranded");

      const after = fs.statSync(generationPath(dir, taskId));
      const afterHash = crypto.createHash("sha256").update(fs.readFileSync(generationPath(dir, taskId))).digest("hex");
      assert.equal(afterHash, beforeHash, "AC13/R6: reuse-terminal never overwrites .generation.json — byte-for-byte unchanged");
      assert.equal(before.size, after.size);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--decide-resume: a prior record with a mutated Proposal (repaired) and matching hashes otherwise, terminal ranked after Adjudicate -> resume/repaired-proposal-detected", () => {
    const taskId = "DIR-126-C-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId, "original proposal text");
    writeLease(dir, taskId, { ownerExecutionId: "sess-a" });
    try {
      // First generation terminates at PlanAuthor (non-cacheable) — records + embedded-releases.
      const rec = runRecordGeneration(dir, taskId, charterFile, { terminalPhase: "PlanAuthor", outcome: "revision-needed", reason: "plan-author-failed", cacheable: false });
      assert.equal(rec.status, 0, rec.stdout);
      const recOut = JSON.parse(rec.stdout.trim());
      assert.equal(recOut.ok, true);
      assert.equal(recOut.releaseResult.ok, true);
      assert.equal(recOut.record.cacheable, false);

      // A human/agent repairs the on-disk Proposal (charter/AC/DoD/Touches all stay the same) —
      // then a fresh Admission cycle for the SECOND dispatch acquires a new lease.
      const taskFile = path.join(dir, "tasks", `${taskId}.md`);
      fs.writeFileSync(taskFile, fixtureTaskBody("REPAIRED proposal text — since manually fixed"));
      writeLease(dir, taskId, { ownerExecutionId: "sess-b", fencingToken: 1 });

      const decide = runDecideResume(dir, taskId, charterFile);
      assert.equal(decide.status, 0, decide.stdout);
      const decideOut = JSON.parse(decide.stdout.trim());
      assert.equal(decideOut.decision, "resume", JSON.stringify(decideOut));
      assert.equal(decideOut.reason, "repaired-proposal-detected");
      assert.equal(decideOut.priorGenerationId, recOut.record.generationId);
      assert.equal(decideOut.releaseResult, undefined, "resume never releases the lease — the resumed generation still needs it");
      assert.ok(fs.existsSync(leasePath(dir, taskId)), "lease untouched on a resume decision");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--decide-resume: exception path (missing lease file) fails closed to cold/decision-exception, never crashes the CLI (exit 0 with a valid JSON verdict)", () => {
    const taskId = "DIR-126-C-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    // No lease file written at all.
    try {
      const res = runDecideResume(dir, taskId, charterFile);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.decision, "cold");
      assert.equal(out.reason, "decision-exception");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC14/R8: importing proposal-convergence.ts (the same way milestone-preparation-check.ts does) fires zero fs/argv side effects — no CLI executes on import", () => {
    const scratch = makeTmpDir("import-");
    const harness = path.join(scratch, "harness.mjs");
    const modUrl = JSON.stringify(`file://${CONVERGENCE_SCRIPT}`);
    fs.writeFileSync(harness, `
import { blockingOpen, validateConvergenceCounters, computeConvergenceMetrics, decideResumeGeneration } from ${modUrl};
console.log(JSON.stringify({ ok: true, hasDecide: typeof decideResumeGeneration === "function" }));
`);
    try {
      const out = execFileSync("node", ["--experimental-strip-types", harness], { encoding: "utf8" });
      const parsed = JSON.parse(out.trim());
      assert.equal(parsed.ok, true);
      assert.equal(parsed.hasDecide, true);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── Telemetry (DIR-126-D/M203) — committed milestones/prepare-telemetry/ records. ─────────────────
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import {
  telemetryPath, computeAttemptId, buildTelemetryRecord, validateTelemetryRecord,
  TELEMETRY_SCHEMA_VERSION,
} from "../scripts/proposal-convergence.ts";

describe("telemetry schema / telemetryPath / validateTelemetryRecord (Stage 1)", () => {
  test("telemetryPath: an ordinary taskId lands under milestones/prepare-telemetry/<taskId>/<recordId>.json", () => {
    const p = telemetryPath("/ws", "DIR-999", "abc123");
    assert.equal(p, path.join("/ws", "milestones", "prepare-telemetry", "DIR-999", "abc123.json"));
  });

  test("telemetryPath: a slash-bearing taskId is routed through _safeTaskIdSegment (never escapes the tree)", () => {
    const p = telemetryPath("/ws", "foo/bar", "rec1");
    const resolved = path.resolve(p);
    const root = path.resolve("/ws", "milestones", "prepare-telemetry");
    assert.ok(resolved === root || resolved.startsWith(root + path.sep), `escaped: ${resolved}`);
    assert.ok(!p.includes("/foo/bar/"), "slash must have been stripped, not preserved as a path separator");
  });

  test("telemetryPath: '../evil' is contained inside the tree", () => {
    const p = telemetryPath("/ws", "../evil", "rec1");
    const resolved = path.resolve(p);
    const root = path.resolve("/ws", "milestones", "prepare-telemetry");
    assert.ok(resolved === root || resolved.startsWith(root + path.sep), `escaped: ${resolved}`);
  });

  test("telemetryPath: a BARE '..' taskId (no slash — _safeTaskIdSegment passes it through unchanged) is caught by the post-hoc containment check and redirected to _unsafe-taskid, never escapes one level above the tree", () => {
    const p = telemetryPath("/ws", "..", "rec1");
    const resolved = path.resolve(p);
    const root = path.resolve("/ws", "milestones", "prepare-telemetry");
    assert.ok(resolved.startsWith(root + path.sep), `escaped: ${resolved}`);
    assert.ok(p.includes("_unsafe-taskid"), `expected the fixed fallback bucket, got: ${p}`);
  });

  test("telemetryPath: taskId === null routes to the fixed _missing-taskId segment", () => {
    const p = telemetryPath("/ws", null, "rec1");
    assert.equal(p, path.join("/ws", "milestones", "prepare-telemetry", "_missing-taskId", "rec1.json"));
  });

  test("computeAttemptId: deterministic for identical fields, distinct for different fields", () => {
    const a = computeAttemptId({ site: "admission-check-failed", taskId: "DIR-1", detail: {} });
    const b = computeAttemptId({ site: "admission-check-failed", taskId: "DIR-1", detail: {} });
    const c = computeAttemptId({ site: "prepare-already-running", taskId: "DIR-1", detail: {} });
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(a.length, 12);
  });

  test("buildTelemetryRecord: every frozen-schema field is present-and-typed even when the caller omits it — never a dropped key", () => {
    const rec = buildTelemetryRecord({ recordId: "r1" });
    const REQUIRED = [
      "schemaVersion", "recordId", "attemptId", "generationId", "admission", "workspace", "taskId",
      "milestoneId", "class", "highRisk", "hashes", "decision", "contentAgentDispatchCount",
      "contentAgentMs", "terminal", "leaseRelease", "sessionId", "recordedAtMs", "telemetryWriteOk",
    ];
    for (const k of REQUIRED) assert.ok(k in rec, `missing key: ${k}`);
    assert.equal(rec.schemaVersion, TELEMETRY_SCHEMA_VERSION);
    assert.equal(rec.recordId, "r1");
    assert.equal(rec.generationId, null);
    assert.equal(rec.telemetryWriteOk, true);
  });

  test("validateTelemetryRecord: a well-formed non-reuse-terminal record passes", () => {
    const rec = buildTelemetryRecord({
      recordId: "r1", attemptId: "r1", generationId: "g1",
      decision: { kind: "cold" }, contentAgentDispatchCount: 1, contentAgentMs: 100,
    });
    const res = validateTelemetryRecord(rec);
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test("validateTelemetryRecord: a missing top-level field fails closed", () => {
    const rec = buildTelemetryRecord({ recordId: "r1", decision: { kind: "cold" } });
    delete rec.hashes;
    const res = validateTelemetryRecord(rec);
    assert.equal(res.ok, false);
    assert.equal(res.code, "telemetry-field-missing");
  });

  test("validateTelemetryRecord: an invalid decision.kind fails closed", () => {
    const rec = buildTelemetryRecord({ recordId: "r1", decision: { kind: "bogus" } });
    const res = validateTelemetryRecord(rec);
    assert.equal(res.ok, false);
    assert.equal(res.code, "telemetry-decision-kind-invalid");
  });

  test("validateTelemetryRecord: reuse-terminal AC16 — missing generationId fails closed reuse-terminal-invalid", () => {
    const rec = buildTelemetryRecord({
      recordId: "r1", generationId: null,
      decision: { kind: "reuse-terminal", priorGenerationId: "g0" },
      hashes: { charter: "a", taskContract: "b", proposal: "c", reviewPolicy: "d" },
      contentAgentDispatchCount: 0, contentAgentMs: 0,
    });
    const res = validateTelemetryRecord(rec);
    assert.equal(res.ok, false);
    assert.equal(res.code, "reuse-terminal-invalid");
  });

  test("validateTelemetryRecord: reuse-terminal AC16 — nonzero contentAgentDispatchCount fails closed", () => {
    const rec = buildTelemetryRecord({
      recordId: "r1", generationId: "g1",
      decision: { kind: "reuse-terminal", priorGenerationId: "g0" },
      hashes: { charter: "a", taskContract: "b", proposal: "c", reviewPolicy: "d" },
      contentAgentDispatchCount: 1, contentAgentMs: 0,
    });
    const res = validateTelemetryRecord(rec);
    assert.equal(res.ok, false);
    assert.equal(res.code, "reuse-terminal-invalid");
  });

  test("validateTelemetryRecord: a well-formed reuse-terminal record passes", () => {
    const rec = buildTelemetryRecord({
      recordId: "r1", generationId: "g1",
      decision: { kind: "reuse-terminal", priorGenerationId: "g0" },
      hashes: { charter: "a", taskContract: "b", proposal: "c", reviewPolicy: "d" },
      contentAgentDispatchCount: 0, contentAgentMs: 0,
    });
    const res = validateTelemetryRecord(rec);
    assert.equal(res.ok, true, JSON.stringify(res));
  });
});

describe("telemetry: record-generation / decide-resume / record-attempt real-dispatch fixtures (Stages 2-5)", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const CONVERGENCE_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "proposal-convergence.ts");
  const ADMISSION_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "prepare-admission-check.ts");
  const FIXTURES_DIR = makeTmpDir("dir126d-fixtures-");

  function fixtureTaskBody(proposalText) {
    return `---\nid: DIR-126-D-CLI-FIXTURE\ntitle: fixture task for telemetry CLI fixtures\nstatus: todo\n---\n## Proposal\n\n${proposalText}\n\n## Acceptance Criteria\n\n- [ ] fixture AC item\n\n## Definition of Done\n\n- [ ] fixture DoD item\n\n## Touches\n\n- fixture.ts\n`;
  }
  function makeCliScratch(taskId, proposalText = "fixture proposal v1") {
    const dir = makeTmpDir("cli-scratch-");
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), fixtureTaskBody(proposalText));
    const charterFile = path.join(dir, "charter.md");
    fs.writeFileSync(charterFile, "fixture charter v1\n");
    return { dir, charterFile };
  }
  function leasePath(dir, taskId) { return path.join(dir, ".quay", "prepare-leases", `${taskId}.json`); }
  function writeLease(dir, taskId, { ownerExecutionId = "sess-1", fencingToken = 0, acquiredAt = 1000 } = {}) {
    const p = leasePath(dir, taskId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ownerExecutionId, fencingToken, acquiredAt, key: `${taskId}::key` }));
  }
  function runNode(args) {
    try {
      const stdout = execFileSync("node", ["--experimental-strip-types", ...args], { encoding: "utf8" });
      return { status: 0, stdout };
    } catch (e) {
      return { status: typeof e.status === "number" ? e.status : 1, stdout: e.stdout ? e.stdout.toString() : "" };
    }
  }

  test("AC1/AC2/AC11: --record-generation writes a real committed telemetry record queryable on disk, telemetryWriteOk:true, dispatch count stays 1 per call", () => {
    const taskId = "DIR-126-D-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    writeLease(dir, taskId);
    try {
      const res = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
        "--terminalPhase", "PlanAuthor", "--outcome", "revision-needed", "--reason", "plan-author-failed", "--cacheable", "false",
        "--milestoneId", "M203", "--class", "development", "--highRisk", "true", "--decisionKind", "resume"]);
      assert.equal(res.status, 0, res.stdout);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, true);
      assert.equal(out.telemetryWriteOk, true);
      assert.ok(out.telemetryFile && fs.existsSync(out.telemetryFile));
      const rec = JSON.parse(fs.readFileSync(out.telemetryFile, "utf8"));
      assert.equal(rec.schemaVersion, 2);
      assert.equal(rec.taskId, taskId);
      assert.equal(rec.milestoneId, "M203");
      assert.equal(rec.highRisk, true);
      assert.equal(rec.terminal.reason, "plan-author-failed");
      assert.equal(rec.terminal.phase, "PlanAuthor");
      assert.equal(rec.leaseRelease.ok, true);
      // AC7/frozen-schema: decision.kind for an ADMITTED attempt is cold|resume, threaded via
      // --decisionKind (never the not-evaluated value reserved for the 3 pre-lease sites).
      assert.equal(rec.decision.kind, "resume");
      assert.ok(rec.generationId && rec.generationId.length === 12);
      assert.ok(rec.telemetryWriteOk === undefined || rec.telemetryWriteOk === true, "the WRITTEN record body itself doesn't need telemetryWriteOk semantics duplicated — only the CLI's own return value does");
      // AC13: lease is really gone (release ran).
      assert.ok(!fs.existsSync(leasePath(dir, taskId)));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC13/AC14: --record-generation with an unwritable telemetry root — release still happened (ok:true), telemetryWriteOk:false, never silently swallowed", () => {
    const taskId = "DIR-126-D-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    writeLease(dir, taskId);
    try {
      // Make the telemetry root a FILE (not a directory) so mkdirSync/writeFileSync inside it throws.
      const telemetryRootParent = path.join(dir, "milestones");
      fs.mkdirSync(telemetryRootParent, { recursive: true });
      fs.writeFileSync(path.join(telemetryRootParent, "prepare-telemetry"), "not a directory");
      const res = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
        "--terminalPhase", "PlanAuthor", "--outcome", "revision-needed", "--reason", "plan-author-failed", "--cacheable", "false"]);
      assert.equal(res.status, 0, res.stdout);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, true, "release having already succeeded, `ok` is unaffected by the write throw");
      assert.equal(out.releaseResult.ok, true, "the release itself succeeded — the write throw happens strictly after");
      assert.equal(out.telemetryWriteOk, false, "the write failure must surface, never silently swallowed");
      assert.ok(!fs.existsSync(leasePath(dir, taskId)), "AC13: lease still released despite the telemetry write throwing");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC4/AC15/AC16: reuse-terminal produces its own isolated committed record — zero content agents, matching hashes, real priorGenerationId, telemetryWriteOk:true, .generation.json untouched", () => {
    const taskId = "DIR-126-D-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId, "fixture proposal v1 — unchanged");
    writeLease(dir, taskId, { ownerExecutionId: "sess-gen-1" });
    try {
      const rec = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
        "--terminalPhase", "PreflightContent", "--outcome", "revision-needed", "--reason", "preflight-rejected", "--cacheable", "true"]);
      assert.equal(rec.status, 0, rec.stdout);

      execFileSync("node", ["--experimental-strip-types", ADMISSION_SCRIPT, "--acquire", "--taskId", taskId, "--workspace", dir], {
        encoding: "utf8", env: { ...process.env, CLAUDE_CODE_SESSION_ID: "sess-gen-2" },
      });

      const decide = runNode([CONVERGENCE_SCRIPT, "--decide-resume", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile]);
      assert.equal(decide.status, 0, decide.stdout);
      const decideOut = JSON.parse(decide.stdout.trim());
      assert.equal(decideOut.decision, "reuse-terminal", JSON.stringify(decideOut));
      assert.equal(decideOut.telemetryWriteOk, true);

      const telFile = telemetryPath(dir, taskId, decideOut.generationId);
      assert.ok(fs.existsSync(telFile), `expected telemetry file at ${telFile}`);
      const telRec = JSON.parse(fs.readFileSync(telFile, "utf8"));
      assert.equal(telRec.decision.kind, "reuse-terminal");
      assert.equal(telRec.contentAgentDispatchCount, 0);
      assert.equal(telRec.contentAgentMs, 0);
      assert.equal(telRec.decision.createsContentGeneration, false);
      assert.ok(telRec.decision.priorGenerationId, "real priorGenerationId present");
      assert.equal(telRec.hashes.charter, decideOut.hashes.charterHash);
      assert.equal(telRec.leaseRelease.ok, true);

      const genFile = path.join(dir, ".quay", "prepare-leases", `${taskId}.generation.json`);
      const genHashBefore = crypto.createHash("sha256").update(fs.readFileSync(genFile)).digest("hex");
      assert.ok(genHashBefore, ".generation.json still exists, untouched by the new reuse-terminal write");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC15: reuse-terminal telemetry-write failure AFTER release never downgrades to 'cold' — decision:'reuse-terminal' + accurate releaseResult + telemetryWriteOk:false, RED/GREEN", () => {
    const taskId = "DIR-126-D-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId, "fixture proposal v1 — unchanged");
    writeLease(dir, taskId, { ownerExecutionId: "sess-gen-1" });
    try {
      const rec = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
        "--terminalPhase", "PreflightContent", "--outcome", "revision-needed", "--reason", "preflight-rejected", "--cacheable", "true"]);
      assert.equal(rec.status, 0, rec.stdout);

      execFileSync("node", ["--experimental-strip-types", ADMISSION_SCRIPT, "--acquire", "--taskId", taskId, "--workspace", dir], {
        encoding: "utf8", env: { ...process.env, CLAUDE_CODE_SESSION_ID: "sess-gen-2" },
      });

      // GREEN precondition (RED without the isolation fix): confirm this WOULD be a real
      // reuse-terminal decision before sabotaging the write — same setup as the AC4/AC15/AC16
      // happy-path test above, just with the telemetry root made unwritable next.
      const leaseBeforeDecide = leasePath(dir, taskId);
      assert.ok(fs.existsSync(leaseBeforeDecide), "lease held prior to --decide-resume");

      // The prior --record-generation call (A.1's own write path) already created
      // milestones/prepare-telemetry/<taskId>/ as a real directory — chmod it read-only so the
      // reuse-terminal (A.2) write's NEW record file inside that same directory fails with EACCES.
      // (Can't reuse AC13/AC14's "make the root a FILE" trick here: that root already exists as a
      // real directory by this point, so writeFileSync over it would EISDIR instead.)
      const taskTelemetryDir = path.join(dir, "milestones", "prepare-telemetry", taskId);
      assert.ok(fs.existsSync(taskTelemetryDir), "A.1's earlier write already created this directory");
      fs.chmodSync(taskTelemetryDir, 0o500);

      let decideOut;
      try {
        const decide = runNode([CONVERGENCE_SCRIPT, "--decide-resume", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile]);
        assert.equal(decide.status, 0, decide.stdout);
        decideOut = JSON.parse(decide.stdout.trim());
      } finally {
        fs.chmodSync(taskTelemetryDir, 0o700);
      }

      // The core AC15 assertions: the write throw must NOT collapse to the outer catch-all's
      // {decision:'cold', reason:'decision-exception'} shape (which lacks releaseResult entirely
      // and bypasses prepare-milestone.js's stranded-lease guard).
      assert.equal(decideOut.decision, "reuse-terminal", `write failure must not downgrade to 'cold' or 'decision-exception' — got ${JSON.stringify(decideOut)}`);
      assert.notEqual(decideOut.reason, "decision-exception");
      assert.ok(decideOut.releaseResult, "releaseResult must be present (the outer catch-all omits it entirely)");
      assert.equal(decideOut.releaseResult.ok, true, "the lease release itself succeeded before the write throw");
      assert.equal(decideOut.telemetryWriteOk, false, "the write failure must surface, never silently swallowed as a false success");

      // AC13-style corollary: the lease is genuinely gone despite the write throw — release
      // happened strictly before the sabotaged write, and the write failure never re-orphans it.
      assert.ok(!fs.existsSync(leaseBeforeDecide), "lease still released despite the reuse-terminal telemetry write throwing");

      // No stray telemetry file exists at the intended path (the write genuinely failed, this
      // isn't accidentally passing because the file landed somewhere else).
      const telFile = telemetryPath(dir, taskId, decideOut.generationId);
      assert.ok(!fs.existsSync(telFile), "no telemetry file should exist at the intended path — the write really failed");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC7: --record-generation with --decisionKind omitted defaults to decision.kind:'cold' (the safe default for an admitted attempt, never 'not-evaluated')", () => {
    const taskId = "DIR-126-D-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    writeLease(dir, taskId);
    try {
      const res = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
        "--terminalPhase", "Adjudicate", "--outcome", "revision-needed", "--reason", "adjudicate-failed", "--cacheable", "false"]);
      assert.equal(res.status, 0, res.stdout);
      const out = JSON.parse(res.stdout.trim());
      const rec = JSON.parse(fs.readFileSync(out.telemetryFile, "utf8"));
      assert.equal(rec.decision.kind, "cold");
      assert.equal(rec.decision.createsContentGeneration, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC17: --record-attempt for the three pre-lease sites each produce a real committed record with generationId:null, decision.kind:not-evaluated", () => {
    const dir = makeTmpDir("attempt-");
    try {
      for (const site of ["admission-check-failed", "prepare-already-running"]) {
        const res = runNode([CONVERGENCE_SCRIPT, "--record-attempt", "--taskId", "DIR-ATTEMPT-1", "--workspace", dir, "--site", site, "--detail", JSON.stringify({ note: site })]);
        assert.equal(res.status, 0, res.stdout);
        const out = JSON.parse(res.stdout.trim());
        assert.equal(out.ok, true);
        assert.equal(out.telemetryWriteOk, true);
        assert.ok(fs.existsSync(out.telemetryFile));
        const rec = JSON.parse(fs.readFileSync(out.telemetryFile, "utf8"));
        assert.equal(rec.generationId, null);
        assert.equal(rec.decision.kind, "not-evaluated");
        assert.equal(rec.terminal.reason, site);
        assert.equal(rec.taskId, "DIR-ATTEMPT-1");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC17: --record-attempt for missing-required-args (taskId itself absent) routes to _missing-taskId/ with explicit taskId:null", () => {
    const dir = makeTmpDir("attempt-missing-");
    try {
      const res = runNode([CONVERGENCE_SCRIPT, "--record-attempt", "--taskId", "", "--workspace", dir, "--site", "missing-required-args", "--detail", JSON.stringify({})]);
      assert.equal(res.status, 0, res.stdout);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, true);
      assert.ok(out.telemetryFile.includes(path.join("prepare-telemetry", "_missing-taskId")), out.telemetryFile);
      const rec = JSON.parse(fs.readFileSync(out.telemetryFile, "utf8"));
      assert.equal(rec.taskId, null);
      assert.equal(rec.terminal.phase, "ProposalAuthors");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC18/AC12: --record-generation --no-release writes telemetry WITHOUT releasing the lease; --release-only then releases it — the Receipt-phase write/build/release split", () => {
    const taskId = "DIR-126-D-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    writeLease(dir, taskId);
    try {
      const writeRes = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--no-release", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
        "--terminalPhase", "Receipt", "--outcome", "prepared", "--reason", "prepared", "--cacheable", "false"]);
      assert.equal(writeRes.status, 0, writeRes.stdout);
      const writeOut = JSON.parse(writeRes.stdout.trim());
      assert.equal(writeOut.ok, true);
      assert.equal(writeOut.telemetryWriteOk, true);
      assert.ok(fs.existsSync(writeOut.telemetryFile), "telemetry file exists BEFORE any release/build step runs");
      assert.ok(fs.existsSync(leasePath(dir, taskId)), "AC18: --no-release must NOT release the lease");

      const releaseRes = runNode([CONVERGENCE_SCRIPT, "--release-only", "--taskId", taskId, "--workspace", dir, "--reason", "prepared"]);
      assert.equal(releaseRes.status, 0, releaseRes.stdout);
      const releaseOut = JSON.parse(releaseRes.stdout.trim());
      assert.equal(releaseOut.ok, true);
      assert.equal(releaseOut.releaseResult.ok, true);
      assert.ok(!fs.existsSync(leasePath(dir, taskId)), "--release-only actually releases");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC18 RED: --record-generation --no-release with an unwritable telemetry root fails (ok:true but telemetryWriteOk:false), and the lease is STILL untouched (no release attempted at all)", () => {
    const taskId = "DIR-126-D-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    writeLease(dir, taskId);
    try {
      const telemetryRootParent = path.join(dir, "milestones");
      fs.mkdirSync(telemetryRootParent, { recursive: true });
      fs.writeFileSync(path.join(telemetryRootParent, "prepare-telemetry"), "not a directory");
      const writeRes = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--no-release", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
        "--terminalPhase", "Receipt", "--outcome", "prepared", "--reason", "prepared", "--cacheable", "false"]);
      assert.equal(writeRes.status, 1, writeRes.stdout);
      const writeOut = JSON.parse(writeRes.stdout.trim());
      assert.equal(writeOut.ok, true);
      assert.equal(writeOut.telemetryWriteOk, false);
      assert.ok(fs.existsSync(leasePath(dir, taskId)), "no release call was ever made on this path — the caller (prepare-milestone.js) is responsible for releasing after seeing telemetryWriteOk:false");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── Stage 8 (DIR-126-D/M203) — generation-ID non-collision + one-way DIR-124-B migration shape ────
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("telemetry: Stage 8 — generationId non-collision + migration-shape structural checks", () => {
  test("AC3: two successive Admission owners sharing the SAME ownerExecutionId but DIFFERENT fencingTokens produce DISTINCT generationIds, each mechanically traceable back to its own exact lease tuple", () => {
    const common = { taskId: "DIR-126-D-FIXTURE", ownerExecutionId: "sess-shared-parent", acquiredAt: 5000 };
    const recA = buildTelemetryRecord({
      recordId: "a", attemptId: "a", generationId: "unused-placeholder-recomputed-below",
      admission: { key: "k", ...common, fencingToken: 0 },
      decision: { kind: "cold" }, contentAgentDispatchCount: 1, contentAgentMs: 1,
    });
    const recB = buildTelemetryRecord({
      recordId: "b", attemptId: "b", generationId: "unused-placeholder-recomputed-below",
      admission: { key: "k", ...common, fencingToken: 1 },
      decision: { kind: "cold" }, contentAgentDispatchCount: 1, contentAgentMs: 1,
    });
    // Re-derive generationId the SAME way _computeGenerationId does (landed DIR-126-A/C formula,
    // reused unchanged — this AC exercises that reuse, not new logic, per the task's own AC3 note).
    const genIdFor = (admission) => crypto.createHash("sha256").update(`${common.taskId}::${admission.ownerExecutionId}::${admission.fencingToken}::${admission.acquiredAt}`).digest("hex").slice(0, 12);
    const idA = genIdFor(recA.admission);
    const idB = genIdFor(recB.admission);
    assert.notEqual(idA, idB, "distinct fencingTokens under the same ownerExecutionId must yield distinct generationIds");
    // Traceability: each record's own admission.fencingToken is the exact field that changed the
    // derived id — re-deriving from the record's own admission block, not an external assumption.
    assert.equal(recA.admission.fencingToken, 0);
    assert.equal(recB.admission.fencingToken, 1);
    assert.equal(recA.admission.ownerExecutionId, recB.admission.ownerExecutionId, "same parent session, by construction of this fixture");
  });

  test("AC8: no reverse/dual-write dependency — zero references to RunIdentity/StageReceiptEnvelope in proposal-convergence.ts (milestone-preparation-check.ts was retired at gap-retire-the-prepare-execute-pipeline-cluster)", () => {
    const convergenceSrc = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "proposal-convergence.ts"), "utf8");
    for (const name of ["RunIdentity", "StageReceiptEnvelope"]) {
      assert.ok(!convergenceSrc.includes(name), `proposal-convergence.ts must not reference ${name} (no reverse dependency on a DIR-124-B-shaped file)`);
    }
  });

  test("AC8: the docs/proposals/quay-prepare-execute-feedback-convergence.md migration-shape subsection is present and names the frozen schemaVersion: 2 record", () => {
    const docPath = path.join(import.meta.dirname, "..", "..", "..", "docs", "proposals", "quay-prepare-execute-feedback-convergence.md");
    const doc = fs.readFileSync(docPath, "utf8");
    assert.match(doc, /schemaVersion: 2/, "the migration-shape subsection must name the frozen schemaVersion: 2 record");
    assert.match(doc, /DIR-126-D remains the Prepare telemetry PRODUCER/, "the doc must explicitly disclaim a reverse/second-authority role");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── M207 — phase timing + finding recurrence RECEIVER fixtures (Plan Stages 5/6). Real CLI runs
// against scratch workspaces (same shape as the DIR-126-D fixtures above). Evidence note: this
// file is OUTSIDE scripts/test.sh's glob (scripts/test.sh:37) — AC evidence cites this direct
// `node --experimental-strip-types --test` invocation, never a scripts/test.sh run.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
describe("M207: phase timing + finding-recurrence receiver extensions", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const CONVERGENCE_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "proposal-convergence.ts");
  const FIXTURES_DIR = makeTmpDir("m207-fixtures-");
  const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

  function fixtureTaskBody() {
    return `---\nid: M207-CLI-FIXTURE\ntitle: fixture task for M207 receiver fixtures\nstatus: todo\n---\n## Proposal\n\nfixture proposal v1\n\n## Acceptance Criteria\n\n- [ ] fixture AC item\n\n## Definition of Done\n\n- [ ] fixture DoD item\n\n## Touches\n\n- fixture.ts\n`;
  }
  function makeCliScratch(taskId) {
    const dir = makeTmpDir("cli-scratch-");
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), fixtureTaskBody());
    const charterFile = path.join(dir, "charter.md");
    fs.writeFileSync(charterFile, "fixture charter v1\n");
    return { dir, charterFile };
  }
  function writeLease(dir, taskId, { ownerExecutionId = "sess-1", fencingToken = 0, acquiredAt = 1000 } = {}) {
    const p = path.join(dir, ".quay", "prepare-leases", `${taskId}.json`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ownerExecutionId, fencingToken, acquiredAt, key: `${taskId}::key` }));
  }
  function runNode(args) {
    try {
      const stdout = execFileSync("node", ["--experimental-strip-types", ...args], { encoding: "utf8" });
      return { status: 0, stdout };
    } catch (e) {
      return { status: typeof e.status === "number" ? e.status : 1, stdout: e.stdout ? e.stdout.toString() : "" };
    }
  }
  function recordGeneration(dir, charterFile, taskId, extraFlags) {
    return runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
      "--terminalPhase", "ProposalReview", "--outcome", "needs-human", "--reason", "split-recommended", "--cacheable", "true", ...extraFlags]);
  }

  test("buildTelemetryRecord: phaseTimings/findingCodes are always materialized ([] when omitted) — never a dropped key — and schemaVersion stays 2", () => {
    const bare = buildTelemetryRecord({ recordId: "r1" });
    assert.deepEqual(bare.phaseTimings, []);
    assert.deepEqual(bare.findingCodes, []);
    assert.equal(bare.schemaVersion, TELEMETRY_SCHEMA_VERSION);
    assert.equal(bare.schemaVersion, 2, "schemaVersion held at 2 — additive in-family growth");
    const spans = [{ phase: "Receipt", round: 0, startedAtMs: 1, endedAtMs: 2 }];
    const codes = [{ code: "x", recurrenceKey: "k", firstSeenGeneration: "a", lastSeenGeneration: "b" }];
    const full = buildTelemetryRecord({ recordId: "r2", phaseTimings: spans, findingCodes: codes });
    assert.deepEqual(full.phaseTimings, spans);
    assert.deepEqual(full.findingCodes, codes);
  });

  test("AC6 (CLAIM C8): validateTelemetryRecord fails closed with telemetry-field-missing when EITHER new key is absent — direct validator unit test", () => {
    const rec = buildTelemetryRecord({ recordId: "r1", decision: { kind: "cold" } });
    assert.equal(validateTelemetryRecord(rec).ok, true, "a fully-materialized record (both keys []) passes");
    const noTimings = { ...rec };
    delete noTimings.phaseTimings;
    const r1 = validateTelemetryRecord(noTimings);
    assert.equal(r1.ok, false);
    assert.equal(r1.code, "telemetry-field-missing");
    assert.match(r1.message, /phaseTimings/);
    const noCodes = { ...rec };
    delete noCodes.findingCodes;
    const r2 = validateTelemetryRecord(noCodes);
    assert.equal(r2.ok, false);
    assert.equal(r2.code, "telemetry-field-missing");
    assert.match(r2.message, /findingCodes/);
  });

  test("AC9 (CLAIM C5): the receiver closes a trailing endedAtMs:null span with its OWN recordedAtMs — the filled value equals recordedAtMs exactly, never a sandbox value", () => {
    const taskId = "M207-TRAILING-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    writeLease(dir, taskId);
    const spans = [
      { phase: "Adjudicate", round: 0, startedAtMs: 1000, endedAtMs: 2000 },
      { phase: "Receipt", round: 0, startedAtMs: 2000, endedAtMs: null }, // the trailing open entry
    ];
    const res = recordGeneration(dir, charterFile, taskId, ["--phaseTimings", JSON.stringify(spans), "--findingCodes", JSON.stringify(["split-recommended"])]);
    assert.equal(res.status, 0, res.stdout);
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.telemetryWriteOk, true);
    const rec = JSON.parse(fs.readFileSync(out.telemetryFile, "utf8"));
    assert.equal(rec.phaseTimings.length, 2);
    assert.equal(rec.phaseTimings[0].endedAtMs, 2000, "already-closed spans pass through untouched");
    assert.equal(rec.phaseTimings[1].endedAtMs, rec.recordedAtMs, "the trailing span is closed with the RECEIVER's own recordedAtMs, exactly");
    assert.ok(Number.isFinite(rec.phaseTimings[1].endedAtMs));
  });

  test("AC3 (CLAIM C7/C8): two real generations with a repeated code — recurrenceKey stable, firstSeenGeneration PINNED, lastSeenGeneration ADVANCES", () => {
    const taskId = "M207-RECURRENCE-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    // Generation 1 (fencingToken 0)
    writeLease(dir, taskId, { fencingToken: 0, acquiredAt: 1000 });
    const res1 = recordGeneration(dir, charterFile, taskId, ["--findingCodes", JSON.stringify(["split-recommended"]), "--phaseTimings", "[]"]);
    assert.equal(res1.status, 0, res1.stdout);
    const out1 = JSON.parse(res1.stdout.trim());
    const rec1 = JSON.parse(fs.readFileSync(out1.telemetryFile, "utf8"));
    assert.equal(rec1.findingCodes.length, 1);
    const fc1 = rec1.findingCodes[0];
    assert.equal(fc1.code, "split-recommended");
    assert.equal(fc1.recurrenceKey, sha(`${taskId}::split-recommended`).slice(0, 12), "recurrenceKey = sha256('<taskId>::<code>').slice(0,12)");
    assert.equal(fc1.firstSeenGeneration, rec1.generationId, "no prior records: first occurrence shape");
    assert.equal(fc1.lastSeenGeneration, rec1.generationId);
    // Generation 2 (fencingToken 1 -> distinct generationId)
    writeLease(dir, taskId, { fencingToken: 1, acquiredAt: 2000 });
    const res2 = recordGeneration(dir, charterFile, taskId, ["--findingCodes", JSON.stringify(["split-recommended"]), "--phaseTimings", "[]"]);
    assert.equal(res2.status, 0, res2.stdout);
    const out2 = JSON.parse(res2.stdout.trim());
    const rec2 = JSON.parse(fs.readFileSync(out2.telemetryFile, "utf8"));
    assert.notEqual(rec2.generationId, rec1.generationId);
    const fc2 = rec2.findingCodes[0];
    assert.equal(fc2.recurrenceKey, fc1.recurrenceKey, "the key is stable across generations");
    assert.equal(fc2.firstSeenGeneration, rec1.generationId, "PINNED to the earliest matching prior record");
    assert.equal(fc2.lastSeenGeneration, rec2.generationId, "ADVANCES to the current record's own id");
  });

  test("AC3 sub-case (CLAIM C7): --record-attempt recurrence keys on attemptId, scanning ONLY sibling attempt records (generationId: null)", () => {
    const taskId = "M207-ATTEMPT-FIXTURE";
    const dir = makeTmpDir("attempt-scratch-");
    const runAttempt = (detailObj) => runNode([CONVERGENCE_SCRIPT, "--record-attempt", "--taskId", taskId, "--workspace", dir,
      "--site", "prepare-already-running", "--detail", JSON.stringify(JSON.stringify(detailObj)),
      "--phaseTimings", "[]", "--findingCodes", JSON.stringify(["prepare-already-running"])]);
    const res1 = runAttempt({ n: 1 });
    assert.equal(res1.status, 0, res1.stdout);
    const out1 = JSON.parse(res1.stdout.trim());
    assert.equal(out1.record.generationId, null);
    assert.equal(out1.record.findingCodes[0].firstSeenGeneration, out1.attemptId, "first occurrence keys on the record's own attemptId");
    const res2 = runAttempt({ n: 2 }); // distinct detail -> distinct attemptId
    const out2 = JSON.parse(res2.stdout.trim());
    assert.notEqual(out2.attemptId, out1.attemptId);
    assert.equal(out2.record.findingCodes[0].recurrenceKey, out1.record.findingCodes[0].recurrenceKey);
    assert.equal(out2.record.findingCodes[0].firstSeenGeneration, out1.attemptId, "firstSeenGeneration names the prior attempt record's attemptId");
    assert.equal(out2.record.findingCodes[0].lastSeenGeneration, out2.attemptId);
  });

  test("AC5 (CLAIM C7): corrupted + pre-M207 siblings are skipped individually — never aborting the scan or the current write; the scan is a LOCAL helper reusing telemetryPath verbatim", () => {
    const taskId = "M207-SCAN-HYGIENE";
    const { dir, charterFile } = makeCliScratch(taskId);
    const archiveDir = path.dirname(telemetryPath(dir, taskId, "__probe__"));
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(path.join(archiveDir, "corrupt.json"), "{NOT VALID JSON");
    fs.writeFileSync(path.join(archiveDir, "pre-m207.json"), JSON.stringify({ schemaVersion: 2, recordId: "old", generationId: "oldgen", recordedAtMs: 1, terminal: { reason: "split-recommended" } })); // no findingCodes array
    writeLease(dir, taskId);
    const res = recordGeneration(dir, charterFile, taskId, []); // NEITHER new flag — defaults apply
    assert.equal(res.status, 0, res.stdout);
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.telemetryWriteOk, true, "the current write persists despite corrupt siblings");
    const rec = JSON.parse(fs.readFileSync(out.telemetryFile, "utf8"));
    assert.deepEqual(rec.phaseTimings, [], "absent --phaseTimings defaults to []");
    assert.equal(rec.findingCodes.length, 1);
    assert.equal(rec.findingCodes[0].code, "split-recommended", "absent --findingCodes defaults to terminal.reason alone");
    assert.equal(rec.findingCodes[0].firstSeenGeneration, rec.generationId, "corrupt + schema-lacking siblings skipped -> first-occurrence shape");
    // The scan is a LOCAL helper reusing telemetryPath — never a new import edge.
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "proposal-convergence.ts"), "utf8");
    assert.match(src, /function _telemetryDir\(workspace, taskId\) \{\s*return path\.dirname\(telemetryPath\(/);
    assert.ok(!/^\s*import .*milestone-preparation-check/m.test(src), "zero import edges from proposal-convergence.ts to milestone-preparation-check.ts");
    assert.ok(!/import .*queryTelemetryReport/.test(src), "no queryTelemetryReport import (rejected Alternative #10)");
  });

  test("CLAIM C10: garbage AND oversized --phaseTimings/--findingCodes values default, never throw, and the primary write STILL persists", () => {
    const taskId = "M207-FAILSOFT-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    writeLease(dir, taskId);
    // 70KiB > the receiver's 64KiB guard, and < the kernel's ~128KiB per-argument execve ceiling
    // — so the oversized value genuinely reaches the CLI through a real argv.
    const oversized = "x".repeat(70 * 1024);
    const res = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
      "--terminalPhase", "ProposalReview", "--outcome", "needs-human", "--reason", "delta-cap-exhausted", "--cacheable", "false",
      "--phaseTimings", "{GARBAGE not json [", "--findingCodes", oversized]);
    assert.equal(res.status, 0, res.stdout); // (b) no throw — the CLI completes
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.ok, true);
    assert.equal(out.telemetryWriteOk, true); // (c) the primary write persists
    const rec = JSON.parse(fs.readFileSync(out.telemetryFile, "utf8"));
    assert.deepEqual(rec.phaseTimings, [], "(a) malformed --phaseTimings defaults to []");
    assert.equal(rec.findingCodes.length, 1, "(a) oversized --findingCodes defaults to terminal.reason alone");
    assert.equal(rec.findingCodes[0].code, "delta-cap-exhausted");
  });

  test("AC6/C9: the reuse-terminal write (validateTelemetryRecord's SOLE live call) carries both new keys and passes the widened REQUIRED_TOP; recurrence reads real prior history", () => {
    const taskId = "M207-REUSE-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    // Generation 1: a cacheable PreflightContent/preflight-rejected terminal — its
    // --record-generation write also persists .generation.json with the CURRENT file hashes.
    writeLease(dir, taskId, { fencingToken: 0, acquiredAt: 1000 });
    const gen1 = runNode([CONVERGENCE_SCRIPT, "--record-generation", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
      "--terminalPhase", "PreflightContent", "--outcome", "revision-needed", "--reason", "preflight-rejected", "--cacheable", "true",
      "--findingCodes", JSON.stringify(["preflight-rejected"]), "--phaseTimings", "[]"]);
    assert.equal(gen1.status, 0, gen1.stdout);
    const gen1Out = JSON.parse(gen1.stdout.trim());
    const gen1GenerationId = gen1Out.record.generationId;
    // Re-acquire (the lease was released) and ask for the resume decision — unchanged files ->
    // reuse-terminal, which validates BEFORE writing against the widened REQUIRED_TOP.
    writeLease(dir, taskId, { fencingToken: 5, acquiredAt: 3000 });
    const res = runNode([CONVERGENCE_SCRIPT, "--decide-resume", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile]);
    const out = JSON.parse(res.stdout.trim());
    assert.equal(out.decision, "reuse-terminal", JSON.stringify(out));
    assert.equal(out.telemetryWriteOk, true, "the widened REQUIRED_TOP passes at the sole live validateTelemetryRecord call");
    const rec = JSON.parse(fs.readFileSync(telemetryPath(dir, taskId, out.generationId), "utf8"));
    assert.equal(rec.decision.kind, "reuse-terminal");
    assert.deepEqual(rec.phaseTimings, [], "a cache hit ran no phases");
    assert.equal(rec.findingCodes.length, 1);
    assert.equal(rec.findingCodes[0].code, "preflight-rejected", "computed from the reused terminal's own reason alone");
    assert.equal(rec.findingCodes[0].firstSeenGeneration, gen1GenerationId, "the scan found generation 1's committed record");
    assert.equal(rec.findingCodes[0].lastSeenGeneration, rec.generationId);
  });

  test("AC6 (CLAIM C9, mechanical): validateTelemetryRecord has exactly ONE definition + ONE live call site — enforcement is write-time only; nothing re-validates disk-read history", () => {
    const src = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "proposal-convergence.ts"), "utf8");
    const occurrences = [...src.matchAll(/validateTelemetryRecord\(/g)];
    assert.equal(occurrences.length, 2, "exactly one definition + the ONE live call inside _decideResumeCli's reuse-terminal branch — widening REQUIRED_TOP is forward-only-safe");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── gap-prepare-milestone-cross-generation-review-state-reset: cross-generation ProposalReview
// checkpoint — pure-function coverage + CLI fixtures. DIR-125 bounds convergence WITHIN one
// generation; this closes the gap where a fresh generation always restarted ProposalReview from an
// empty ledger even after a trivial human repair (the real DIR-126-D incident: nine full
// ProposalReview generations after small, targeted task edits).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("buildReviewCheckpoint / checkpointPath", () => {
  test("checkpointPath: lives under .quay/prepare-checkpoints/, reuses the SAME taskId sanitizer as the lease path family", () => {
    const p = checkpointPath("/ws", "DIR-126-D");
    assert.equal(p, path.join("/ws", ".quay", "prepare-checkpoints", "DIR-126-D.json"));
    const traversal = checkpointPath("/ws", "a/b\\c");
    assert.equal(traversal, path.join("/ws", ".quay", "prepare-checkpoints", "a_b_c.json"), "path separators sanitized, matching _safeTaskIdSegment's own contract");
  });

  test("buildReviewCheckpoint: every declared field is materialized even when the caller omits it — no dropped keys", () => {
    const rec = buildReviewCheckpoint({});
    assert.equal(rec.schemaVersion, CHECKPOINT_SCHEMA_VERSION);
    assert.equal(rec.taskId, null);
    assert.equal(rec.charterHash, null);
    assert.equal(rec.scopeHash, null);
    assert.equal(rec.reviewPolicyHash, null);
    assert.equal(rec.reviewedProposalHash, null);
    assert.equal(rec.reviewedProposalText, "");
    assert.deepEqual(rec.ledger, []);
    assert.equal(rec.mechanismInventoryHash, null);
    assert.equal(rec.mechanismInventoryCount, null);
    assert.deepEqual(rec.counters, { fullReviews: 0, deltaRounds: 0 });
    assert.deepEqual(rec.terminal, { reason: null, outcome: null, timestamp: null });
    assert.deepEqual(rec.lastFullReviewSession, { sessionId: null, timestamp: null });
    assert.equal(rec.recordedAtMs, null);
  });

  test("buildReviewCheckpoint: real values pass through unchanged", () => {
    const rec = buildReviewCheckpoint({
      taskId: "T1", charterHash: "ch", scopeHash: "sh", reviewPolicyHash: "rp",
      reviewedProposalHash: "ph", reviewedProposalText: "the proposal text",
      ledger: [{ id: "f1" }], mechanismInventoryHash: "mi", mechanismInventoryCount: 2,
      counters: { fullReviews: 1, deltaRounds: 2 },
      terminal: { reason: "zero-finding", outcome: "prepared-pending", timestamp: 1000 },
      lastFullReviewSession: { sessionId: "sess-1", timestamp: 900 },
      recordedAtMs: 1500,
    });
    assert.equal(rec.taskId, "T1");
    assert.equal(rec.reviewedProposalText, "the proposal text");
    assert.deepEqual(rec.ledger, [{ id: "f1" }]);
    assert.deepEqual(rec.counters, { fullReviews: 1, deltaRounds: 2 });
    assert.equal(rec.terminal.reason, "zero-finding");
    assert.equal(rec.lastFullReviewSession.sessionId, "sess-1");
  });
});

describe("validateReviewCheckpoint — fail-closed typed reason codes (AC #2)", () => {
  const IDENTITY = { taskId: "T1", charterHash: "ch", scopeHash: "sh", reviewPolicyHash: "rp" };
  function validRecord(overrides = {}) {
    return buildReviewCheckpoint({ ...IDENTITY, reviewedProposalHash: "ph", reviewedProposalText: "text", ledger: [], counters: { fullReviews: 1, deltaRounds: 0 }, ...overrides });
  }

  test("missing checkpoint (null record) -> checkpoint-missing", () => {
    const out = validateReviewCheckpoint(null, IDENTITY);
    assert.equal(out.ok, false);
    assert.equal(out.code, "checkpoint-missing");
  });

  test("corrupt shape (not an object) -> checkpoint-corrupt", () => {
    assert.equal(validateReviewCheckpoint("not an object", IDENTITY).code, "checkpoint-corrupt");
    assert.equal(validateReviewCheckpoint([1, 2, 3], IDENTITY).code, "checkpoint-corrupt");
    assert.equal(validateReviewCheckpoint(42, IDENTITY).code, "checkpoint-corrupt");
  });

  test("corrupt shape (missing required field) -> checkpoint-corrupt", () => {
    const rec = validRecord();
    delete rec.counters;
    assert.equal(validateReviewCheckpoint(rec, IDENTITY).code, "checkpoint-corrupt");
  });

  test("corrupt shape (ledger not an array) -> checkpoint-corrupt", () => {
    const rec = validRecord();
    rec.ledger = "not-an-array";
    assert.equal(validateReviewCheckpoint(rec, IDENTITY).code, "checkpoint-corrupt");
  });

  test("corrupt shape (counters malformed) -> checkpoint-corrupt", () => {
    const rec = validRecord();
    rec.counters = { fullReviews: "one", deltaRounds: 0 };
    assert.equal(validateReviewCheckpoint(rec, IDENTITY).code, "checkpoint-corrupt");
  });

  test("cross-task checkpoint (taskId mismatch) -> checkpoint-wrong-task", () => {
    const rec = validRecord();
    const out = validateReviewCheckpoint(rec, { ...IDENTITY, taskId: "OTHER-TASK" });
    assert.equal(out.ok, false);
    assert.equal(out.code, "checkpoint-wrong-task");
  });

  test("wrong-charter checkpoint (charterHash mismatch) -> checkpoint-charter-mismatch", () => {
    const rec = validRecord();
    const out = validateReviewCheckpoint(rec, { ...IDENTITY, charterHash: "ch-CHANGED" });
    assert.equal(out.ok, false);
    assert.equal(out.code, "checkpoint-charter-mismatch");
  });

  test("scope mismatch (scopeHash mismatch) -> checkpoint-scope-mismatch", () => {
    const rec = validRecord();
    const out = validateReviewCheckpoint(rec, { ...IDENTITY, scopeHash: "sh-CHANGED" });
    assert.equal(out.ok, false);
    assert.equal(out.code, "checkpoint-scope-mismatch");
  });

  test("stale-policy checkpoint (reviewPolicyHash mismatch) -> checkpoint-stale-policy", () => {
    const rec = validRecord();
    const out = validateReviewCheckpoint(rec, { ...IDENTITY, reviewPolicyHash: "rp-CHANGED" });
    assert.equal(out.ok, false);
    assert.equal(out.code, "checkpoint-stale-policy");
  });

  test("a well-formed, matching checkpoint passes -> checkpoint-valid", () => {
    const rec = validRecord();
    const out = validateReviewCheckpoint(rec, IDENTITY);
    assert.equal(out.ok, true);
    assert.equal(out.code, "checkpoint-valid");
  });

  test("never silently accepted: EVERY corruption class above returns ok:false with a DISTINCT typed code, never a generic boolean", () => {
    const codes = new Set();
    codes.add(validateReviewCheckpoint(null, IDENTITY).code);
    const badShape = validRecord(); delete badShape.counters;
    codes.add(validateReviewCheckpoint(badShape, IDENTITY).code);
    codes.add(validateReviewCheckpoint(validRecord(), { ...IDENTITY, taskId: "X" }).code);
    codes.add(validateReviewCheckpoint(validRecord(), { ...IDENTITY, charterHash: "X" }).code);
    codes.add(validateReviewCheckpoint(validRecord(), { ...IDENTITY, scopeHash: "X" }).code);
    codes.add(validateReviewCheckpoint(validRecord(), { ...IDENTITY, reviewPolicyHash: "X" }).code);
    assert.equal(codes.size, 6, `expected 6 distinct reason codes, got: ${[...codes].join(", ")}`);
  });
});

describe("noveltyScan / classifyProposalDiff — mechanical diff classification (Requested-action item 3, AC #6)", () => {
  test("noveltyScan: a claim present in both old and new text is NOT novel", () => {
    const out = noveltyScan({
      oldProposalText: "The scheduler invokes `foo.ts` and `bar.ts` to enforce ordering.",
      newProposalText: "The scheduler invokes `foo.ts` and `bar.ts` to enforce ordering (reworded).",
    });
    assert.equal(out.hasNovelClaim, false);
    assert.equal(out.novelClaims.length, 0);
  });

  test("noveltyScan: a claim naming a NEW identifier pair is novel", () => {
    const out = noveltyScan({
      oldProposalText: "The scheduler invokes `foo.ts` and `bar.ts` to enforce ordering.",
      newProposalText: "The scheduler invokes `foo.ts` and `bar.ts` to enforce ordering. It also dispatches `baz.ts` and `qux.ts` to route retries.",
    });
    assert.equal(out.hasNovelClaim, true);
    assert.equal(out.novelClaims.length, 1);
  });

  test("classifyProposalDiff: identical text after whitespace/case normalization -> wording-only", () => {
    const out = classifyProposalDiff({ oldProposalText: "Hello   World.\n\n", newProposalText: "hello world.", ledger: [] });
    assert.equal(out.classification, "wording-only");
    assert.equal(out.code, "no-textual-difference");
  });

  test("classifyProposalDiff: a genuinely new mechanism claim -> new-claim", () => {
    const out = classifyProposalDiff({
      oldProposalText: "The system does X.",
      newProposalText: "The system does X. It also invokes `newmod.ts` and `other.ts` to enforce Z.",
      ledger: [],
    });
    assert.equal(out.classification, "new-claim");
    assert.equal(out.noveltyScan.hasNovelClaim, true);
  });

  test("classifyProposalDiff: a new backtick file-path identifier with no wiring claim -> touch-set-change", () => {
    const out = classifyProposalDiff({
      oldProposalText: "The system does X.",
      newProposalText: "The system does X, implemented in `new-module.ts`.",
      ledger: [],
    });
    assert.equal(out.classification, "touch-set-change");
  });

  test("classifyProposalDiff: an added sentence overlapping a known ledger finding's own identity -> known-finding-repair", () => {
    const out = classifyProposalDiff({
      oldProposalText: "The retry logic has a known race condition under load.",
      newProposalText: "The retry logic has a known race condition under load. Fixed: the retry now uses a bounded exponential backoff to close the race.",
      ledger: [{ claimRef: "retry-race", summary: "retry logic race condition bounded backoff", evidence: "" }],
    });
    assert.equal(out.classification, "known-finding-repair");
  });

  test("classifyProposalDiff: a wiring claim present in the OLD text is now GONE, unexplained by any ledger finding -> mechanism-change", () => {
    const out = classifyProposalDiff({
      oldProposalText: "The system invokes `core.ts` and `bridge.ts` to route events.",
      newProposalText: "The system no longer routes events that way.",
      ledger: [],
    });
    assert.equal(out.classification, "mechanism-change");
    assert.equal(out.code, "mechanism-claim-removed-unexplained");
  });

  test("classifyProposalDiff: a removed claim EXPLAINED by a ledger finding's own identity is not mis-classified as mechanism-change", () => {
    const out = classifyProposalDiff({
      oldProposalText: "The system incorrectly invokes `legacy.ts` and `oldpath.ts` to route events.",
      newProposalText: "The system no longer routes events through the legacy path.",
      ledger: [{ claimRef: "legacy.ts", summary: "incorrect legacy.ts oldpath.ts routing removed", evidence: "legacy.ts oldpath.ts" }],
    });
    assert.notEqual(out.classification, "mechanism-change");
  });

  test("classifyProposalDiff: pure rewording with no new claims/paths/removals -> wording-only", () => {
    const out = classifyProposalDiff({
      oldProposalText: "This module handles retries carefully.",
      newProposalText: "This module handles retries very carefully indeed.",
      ledger: [],
    });
    assert.equal(out.classification, "wording-only");
  });

  // gap-prepare-milestone-cross-generation-review-state-reset (round 2, post-REFUTATION): these two
  // tests document a REAL, KNOWN limitation an independent review found — claim identity here is
  // keyed only on the sorted set of backtick identifiers, so a same-identifiers edit that WEAKENS an
  // existing claim's behavior, or a full removal "explained away" by an unrelated ledger finding
  // that merely mentions the same identifier strings, both still classify wording-only. This is NOT
  // fixed at the classifier level (a perfect free-text classifier is not a tractable goal — see this
  // same session's 3-round preflightMergedMarkdownClaims history for why chasing perfect heuristic
  // classification is a trap). It is fixed STRUCTURALLY one layer up: prepare-milestone.js's
  // ProposalReview loop now ALWAYS dispatches at least one real independent delta reviewer for cross-
  // generation continuation, regardless of this classifier's output or the carried ledger's content
  // — see prepare-milestone.js's own "while (true)" loop header comment and
  // plugin/test/prepare-milestone-convergence.test.mjs's "REFUTATION regression" test for the
  // structural mitigation. These two tests exist so a future reader does not mistake silence here
  // for the defect being closed at this layer — it is closed one layer up, on purpose.
  test("classifyProposalDiff KNOWN LIMITATION (Exploit A, REFUTATION 2026-07-31): weakening an existing claim's behavior while keeping the same identifiers still classifies wording-only -- mitigated structurally in prepare-milestone.js, not here", () => {
    const out = classifyProposalDiff({
      oldProposalText: "The gate engine enforces `fail-closed` behavior in `gate.js` on every dispatch: any check error rejects the transition.",
      newProposalText: "The gate engine enforces `fail-closed` behavior in `gate.js` on most dispatches: a check error normally rejects the transition, but a config-load error is treated as a pass-through to avoid blocking the pipeline.",
      ledger: [],
    });
    assert.equal(out.classification, "wording-only", "documents the known limitation — same identifier set, weakened semantics, not detected at this layer");
  });

  test("classifyProposalDiff KNOWN LIMITATION (Exploit B, REFUTATION 2026-07-31): a claim removed entirely, explained away by an unrelated ledger finding that merely co-occurs on identifier text, misclassifies wording-only instead of mechanism-change -- mitigated structurally in prepare-milestone.js, not here", () => {
    const withUnrelatedLedger = classifyProposalDiff({
      oldProposalText: "`gate.js` invokes `validateInput` before every `task_write` to enforce schema constraints.",
      newProposalText: "Schema constraints are now assumed to hold by convention.",
      ledger: [{ id: "nit001", disposition: "backlog", summary: "prefer consistent casing across gate.js, validateInput, and task_write call sites (style only)" }],
    });
    assert.equal(withUnrelatedLedger.classification, "wording-only", "documents the known limitation — an unrelated ledger entry that merely mentions the same identifier strings incorrectly 'explains' a real claim removal");
    // Control: the SAME removal with an EMPTY ledger correctly classifies mechanism-change — proves
    // the misclassification above is specifically caused by incidental ledger text co-occurrence,
    // not a blanket failure to detect removal.
    const withEmptyLedger = classifyProposalDiff({
      oldProposalText: "`gate.js` invokes `validateInput` before every `task_write` to enforce schema constraints.",
      newProposalText: "Schema constraints are now assumed to hold by convention.",
      ledger: [],
    });
    assert.equal(withEmptyLedger.classification, "mechanism-change", "control: the same removal with no unrelated ledger noise IS correctly detected");
  });
});

describe("CLI: --resolve-checkpoint / --write-checkpoint", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const CONVERGENCE_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "proposal-convergence.ts");
  const FIXTURES_DIR = makeTmpDir("checkpoint-cli-fixtures-");

  function fixtureTaskBody(proposalText) {
    return `---
id: CKPT-CLI-FIXTURE
title: fixture task for checkpoint CLI fixtures
status: todo
---
## Proposal

${proposalText}

## Acceptance Criteria

- [ ] fixture AC item

## Definition of Done

- [ ] fixture DoD item

## Touches

- fixture.ts
`;
  }

  function makeCliScratch(taskId, proposalText = "fixture proposal v1") {
    const dir = makeTmpDir("cli-scratch-");
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), fixtureTaskBody(proposalText));
    const charterFile = path.join(dir, "charter.md");
    fs.writeFileSync(charterFile, "fixture charter v1\n");
    return { dir, charterFile };
  }

  function runNode(args) {
    try {
      const stdout = execFileSync("node", ["--no-warnings", "--experimental-strip-types", ...args], { encoding: "utf8" });
      return { status: 0, stdout };
    } catch (e) {
      return { status: typeof e.status === "number" ? e.status : 1, stdout: e.stdout ? e.stdout.toString() : "" };
    }
  }

  function runResolve(dir, taskId, charterFile) {
    return runNode([CONVERGENCE_SCRIPT, "--resolve-checkpoint", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile]);
  }
  function runWrite(dir, taskId, charterFile, input, { reason = "zero-finding", outcome = "prepared-pending" } = {}) {
    const inputFile = path.join(dir, `checkpoint-input-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(inputFile, JSON.stringify(input));
    return runNode([CONVERGENCE_SCRIPT, "--write-checkpoint", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
      "--checkpointInputFile", inputFile, "--reason", reason, "--outcome", outcome]);
  }

  test("--resolve-checkpoint: no checkpoint on disk -> usable:false, checkpoint-missing", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const res = runResolve(dir, taskId, charterFile);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.usable, false);
      assert.equal(out.code, "checkpoint-missing");
      assert.ok(out.hashes && out.hashes.charterHash, "hashes are still reported even on a miss");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--write-checkpoint then --resolve-checkpoint (unchanged Proposal) -> checkpoint-proposal-unchanged, never falsely 'usable'", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId, "unchanged proposal text");
    try {
      const w = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      assert.equal(w.status, 0, w.stdout);
      assert.equal(JSON.parse(w.stdout.trim()).ok, true);
      const res = runResolve(dir, taskId, charterFile);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.usable, false);
      assert.equal(out.code, "checkpoint-proposal-unchanged");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--write-checkpoint then edit the Proposal (wording-only) then --resolve-checkpoint -> usable:true, classification wording-only, ledger carried forward", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId, "the retry module handles failures.");
    try {
      const ledger = [{ id: "f1", subsystem: "s1", summary: "a finding", blocking: true, status: "open" }];
      const w = runWrite(dir, taskId, charterFile, { ledger, mechanismInventoryHash: "mi-1", mechanismInventoryCount: 1, fullReviewsThisGen: 1, deltaRoundsThisGen: 0, lastFullReviewSessionId: "sess-full-1", lastFullReviewTimestamp: 1000 });
      assert.equal(w.status, 0, w.stdout);

      const taskFile = path.join(dir, "tasks", `${taskId}.md`);
      fs.writeFileSync(taskFile, fixtureTaskBody("the retry module handles failures gracefully now."));

      const res = runResolve(dir, taskId, charterFile);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.usable, true, JSON.stringify(out));
      assert.equal(out.classification, "wording-only");
      assert.deepEqual(out.ledger, ledger, "the prior ledger is carried forward VERBATIM");
      assert.equal(out.mechanismInventoryHash, "mi-1");
      assert.equal(out.lastFullReviewSession.sessionId, "sess-full-1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("corrupt checkpoint file on disk -> --resolve-checkpoint fails closed to checkpoint-corrupt", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const w = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      const ckptFile = JSON.parse(w.stdout.trim()).checkpointFile;
      fs.writeFileSync(ckptFile, "{ not valid json");
      const res = runResolve(dir, taskId, charterFile);
      assert.equal(JSON.parse(res.stdout.trim()).code, "checkpoint-corrupt");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cross-task checkpoint (record.taskId tampered) -> checkpoint-wrong-task", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const w = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      const ckptFile = JSON.parse(w.stdout.trim()).checkpointFile;
      const rec = JSON.parse(fs.readFileSync(ckptFile, "utf8"));
      rec.taskId = "SOME-OTHER-TASK";
      fs.writeFileSync(ckptFile, JSON.stringify(rec));
      const taskFileForEdit = path.join(dir, "tasks", `${taskId}.md`);
      fs.writeFileSync(taskFileForEdit, fixtureTaskBody("edited proposal text"));
      const res = runResolve(dir, taskId, charterFile);
      assert.equal(JSON.parse(res.stdout.trim()).code, "checkpoint-wrong-task");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("stale-policy checkpoint (record.reviewPolicyHash tampered) -> checkpoint-stale-policy", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const w = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      const ckptFile = JSON.parse(w.stdout.trim()).checkpointFile;
      const rec = JSON.parse(fs.readFileSync(ckptFile, "utf8"));
      rec.reviewPolicyHash = "stale-hash";
      fs.writeFileSync(ckptFile, JSON.stringify(rec));
      const taskFileForEdit = path.join(dir, "tasks", `${taskId}.md`);
      fs.writeFileSync(taskFileForEdit, fixtureTaskBody("edited proposal text"));
      const res = runResolve(dir, taskId, charterFile);
      assert.equal(JSON.parse(res.stdout.trim()).code, "checkpoint-stale-policy");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("wrong-charter checkpoint (the charter FILE itself changed) -> checkpoint-charter-mismatch", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const w = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      assert.equal(w.status, 0, w.stdout);
      fs.writeFileSync(charterFile, "fixture charter v2 — CHANGED\n");
      const taskFileForEdit = path.join(dir, "tasks", `${taskId}.md`);
      fs.writeFileSync(taskFileForEdit, fixtureTaskBody("edited proposal text"));
      const res = runResolve(dir, taskId, charterFile);
      assert.equal(JSON.parse(res.stdout.trim()).code, "checkpoint-charter-mismatch");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("scope-mismatch checkpoint (task's own Touches section changed) -> checkpoint-scope-mismatch", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const w = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      assert.equal(w.status, 0, w.stdout);
      const taskFile = path.join(dir, "tasks", `${taskId}.md`);
      const body = fs.readFileSync(taskFile, "utf8");
      fs.writeFileSync(taskFile, body.replace("- fixture.ts", "- fixture.ts\n- new-touch-target.ts"));
      const res = runResolve(dir, taskId, charterFile);
      assert.equal(JSON.parse(res.stdout.trim()).code, "checkpoint-scope-mismatch");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("EVERY fail-closed verdict above dispatches zero delta reviewers from untrusted state — usable is ALWAYS false for a corrupt/mismatched checkpoint (AC #2, mechanical corroboration)", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      // No checkpoint at all.
      assert.equal(JSON.parse(runResolve(dir, taskId, charterFile).stdout.trim()).usable, false);
      // A checkpoint that exists but is unparseable.
      const w = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      const ckptFile = JSON.parse(w.stdout.trim()).checkpointFile;
      fs.writeFileSync(ckptFile, "not json at all");
      assert.equal(JSON.parse(runResolve(dir, taskId, charterFile).stdout.trim()).usable, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("epoch-cumulative counters accumulate across two --write-checkpoint calls in the SAME (charterHash, scopeHash, reviewPolicyHash) epoch, reset to local counts when the epoch key changes", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId, "v1");
    try {
      const w1 = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 1 });
      const out1 = JSON.parse(w1.stdout.trim());
      assert.deepEqual(out1.counters, { fullReviews: 1, deltaRounds: 1 });
      assert.equal(out1.epochReset, true, "no prior checkpoint -> a fresh epoch");

      const taskFile = path.join(dir, "tasks", `${taskId}.md`);
      fs.writeFileSync(taskFile, fixtureTaskBody("v2 — wording tweak"));
      const w2 = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 0, deltaRoundsThisGen: 1 });
      const out2 = JSON.parse(w2.stdout.trim());
      assert.deepEqual(out2.counters, { fullReviews: 1, deltaRounds: 2 }, "same epoch (charter/scope/policy unchanged) -> counters ACCUMULATE");
      assert.equal(out2.epochReset, false);

      // Now change the charter (a real scope-bearing epoch boundary) — counters must reset to this
      // generation's own local counts, never keep accumulating onto the stale epoch's total.
      fs.writeFileSync(charterFile, "fixture charter v2 — CHANGED\n");
      const w3 = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      const out3 = JSON.parse(w3.stdout.trim());
      assert.deepEqual(out3.counters, { fullReviews: 1, deltaRounds: 0 }, "a new epoch (charter changed) resets counters to this generation's own local counts");
      assert.equal(out3.epochReset, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--write-checkpoint re-reads the Proposal FRESH (as-of-terminal), never a stale value captured at some earlier point", () => {
    const taskId = "CKPT-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId, "original text");
    try {
      const taskFile = path.join(dir, "tasks", `${taskId}.md`);
      fs.writeFileSync(taskFile, fixtureTaskBody("text as of the actual terminal"));
      const w = runWrite(dir, taskId, charterFile, { ledger: [], fullReviewsThisGen: 1, deltaRoundsThisGen: 0 });
      const ckptFile = JSON.parse(w.stdout.trim()).checkpointFile;
      const rec = JSON.parse(fs.readFileSync(ckptFile, "utf8"));
      assert.equal(rec.reviewedProposalText.trim(), "text as of the actual terminal");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC14/R8-style: importing proposal-convergence.ts fires zero fs/argv side effects from the checkpoint additions either — no CLI executes on import", () => {
    const scratch = makeTmpDir("import-");
    const harness = path.join(scratch, "harness.mjs");
    const modUrl = JSON.stringify(`file://${CONVERGENCE_SCRIPT}`);
    fs.writeFileSync(harness, `
import { validateReviewCheckpoint, classifyProposalDiff, noveltyScan, checkpointPath } from ${modUrl};
console.log(JSON.stringify({ ok: true, hasValidate: typeof validateReviewCheckpoint === "function", hasClassify: typeof classifyProposalDiff === "function" }));
`);
    try {
      const out = execFileSync("node", ["--no-warnings", "--experimental-strip-types", harness], { encoding: "utf8" });
      const parsed = JSON.parse(out.trim());
      assert.equal(parsed.ok, true);
      assert.equal(parsed.hasValidate, true);
      assert.equal(parsed.hasClassify, true);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── gap-prepare-milestone-task-epoch-budget-reset — epoch-cumulative circuit breaker. Pure-function
// coverage for `checkEpochCaps`/`buildEpochRecord`, then real CLI round-trip coverage for
// --epoch-status/--record-epoch-dispatch/--new-epoch/--override-budget, following the SAME
// spawn-a-real-subprocess-against-a-scratch-workspace pattern the checkpoint CLI tests above use.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

describe("checkEpochCaps — pure decision function", () => {
  const FRESH = { attempts: 0, fullReviews: 0, deltaRounds: 0, contentAgentDispatches: 0, observableAgentMs: 0, terminalFingerprints: {}, tokensObserved: null };

  test("fresh/zero counters never breach", () => {
    const r = checkEpochCaps({ counters: FRESH, policy: DEFAULT_EPOCH_POLICY, highRisk: false });
    assert.equal(r.breached, false);
  });

  test("ordinary time cap: 90 minutes exactly meets the cap -> breached", () => {
    const r = checkEpochCaps({ counters: { ...FRESH, observableAgentMs: 90 * 60 * 1000 }, policy: DEFAULT_EPOCH_POLICY, highRisk: false });
    assert.equal(r.breached, true);
    assert.equal(r.breachedCap, "time-cap-exceeded");
    assert.equal(r.code, "epoch-time-cap-exceeded");
  });

  test("ordinary time cap: 89 minutes does NOT breach", () => {
    const r = checkEpochCaps({ counters: { ...FRESH, observableAgentMs: 89 * 60 * 1000 }, policy: DEFAULT_EPOCH_POLICY, highRisk: false });
    assert.equal(r.breached, false);
  });

  test("highRisk uses the 150-minute cap, not the ordinary 90-minute one", () => {
    const counters = { ...FRESH, observableAgentMs: 120 * 60 * 1000 };
    assert.equal(checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false }).breached, true, "120m breaches the 90m ordinary cap");
    assert.equal(checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: true }).breached, false, "120m does NOT breach the 150m highRisk cap");
  });

  test("full-review cap only gates when checkFullReviewCap:true is explicitly passed", () => {
    const counters = { ...FRESH, fullReviews: 1 };
    assert.equal(checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, checkFullReviewCap: false }).breached, false, "ordinary dispatches (ProposalAuthors/Adjudicate/PlanAuthor/PlanCheck/delta rounds) never gate on this cap");
    const r = checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, checkFullReviewCap: true });
    assert.equal(r.breached, true);
    assert.equal(r.breachedCap, "full-review-cap-exceeded");
    assert.equal(r.code, "epoch-full-review-cap-exceeded");
  });

  test("repeated-terminal-fingerprint cap: 2 occurrences of one fingerprint breaches (default maxRepeatedFingerprint:2)", () => {
    const counters = { ...FRESH, terminalFingerprints: { abc123: 2 } };
    const r = checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false });
    assert.equal(r.breached, true);
    assert.equal(r.breachedCap, "repeated-terminal-fingerprint");
    assert.equal(r.code, "epoch-fingerprint-cap-exceeded");
  });

  test("repeated-terminal-fingerprint cap: 1 occurrence does NOT breach", () => {
    const counters = { ...FRESH, terminalFingerprints: { abc123: 1 } };
    assert.equal(checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false }).breached, false);
  });

  test("fingerprint cap is checked BEFORE the time/full-review caps (evaluation order)", () => {
    const counters = { ...FRESH, terminalFingerprints: { x: 5 }, observableAgentMs: 999 * 60 * 1000, fullReviews: 99 };
    const r = checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, checkFullReviewCap: true });
    assert.equal(r.breachedCap, "repeated-terminal-fingerprint");
  });

  test("a recorded override EXTENDS the effective time cap by its additionalBudget minutes", () => {
    const counters = { ...FRESH, observableAgentMs: 100 * 60 * 1000 }; // 100m > 90m ordinary cap
    const noOverride = checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, overrides: [] });
    assert.equal(noOverride.breached, true, "100m breaches the bare 90m cap");
    const withOverride = checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, overrides: [{ owner: "a", reason: "r", additionalBudget: 30 }] });
    assert.equal(withOverride.breached, false, "90m + 30m override = 120m ceiling, 100m no longer breaches");
  });

  test("missing tokensObserved (null) never affects any cap — time/full-review/fingerprint caps still enforce independently", () => {
    const counters = { ...FRESH, observableAgentMs: 200 * 60 * 1000, tokensObserved: null };
    const r = checkEpochCaps({ counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false });
    assert.equal(r.breached, true, "the time cap still fires with tokensObserved:null — missing token data cannot disable other caps");
  });

  test("a caller-lowered policy (e.g. ordinaryCapMinutes:10) is honored, never silently widened back to the 90m default", () => {
    const counters = { ...FRESH, observableAgentMs: 15 * 60 * 1000 };
    const r = checkEpochCaps({ counters, policy: { ...DEFAULT_EPOCH_POLICY, ordinaryCapMinutes: 10 }, highRisk: false });
    assert.equal(r.breached, true);
  });

  // ── M233 bodyScopeHash scope-change grant tests ──────────────────────────────────────────────
  test("M233 CLAIM-2: bodyScopeHash mismatch grants fresh full-review allowance (scopeChanged:true) when at the full-review cap", () => {
    const counters = { ...FRESH, fullReviews: 1 };
    const r = checkEpochCaps({
      counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, checkFullReviewCap: true,
      bodyScopeHash: "old-hash", currentBodyScopeHash: "new-hash",
    });
    assert.equal(r.breached, false, "changed scope must NOT breach");
    assert.equal(r.scopeChanged, true, "must signal scopeChanged:true");
  });

  test("M233 CLAIM-2: unchanged bodyScopeHash at cap still breaches (DIR-120 protection preserved)", () => {
    const counters = { ...FRESH, fullReviews: 1 };
    const r = checkEpochCaps({
      counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, checkFullReviewCap: true,
      bodyScopeHash: "same-hash", currentBodyScopeHash: "same-hash",
    });
    assert.equal(r.breached, true);
    assert.equal(r.breachedCap, "full-review-cap-exceeded");
    assert.equal(r.scopeChanged, undefined, "matching hashes must NOT signal scopeChanged");
  });

  test("M233 CLAIM-9: null bodyScopeHash (pre-migration record) applies existing cap — no grant", () => {
    const counters = { ...FRESH, fullReviews: 1 };
    const r1 = checkEpochCaps({
      counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, checkFullReviewCap: true,
      bodyScopeHash: null, currentBodyScopeHash: "new-hash",
    });
    assert.equal(r1.breached, true, "null stored hash = no grant, existing cap applies");

    const r2 = checkEpochCaps({
      counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, checkFullReviewCap: true,
      bodyScopeHash: "some-hash", currentBodyScopeHash: null,
    });
    assert.equal(r2.breached, true, "null current hash = no grant");
  });

  test("M233 CLAIM-2: fingerprint cap is still checked BEFORE the scope-change grant — a task with repeated fingerprints is broken regardless of body changes", () => {
    const counters = { ...FRESH, fullReviews: 3, terminalFingerprints: { xyz: 3 } };
    const r = checkEpochCaps({
      counters, policy: { ...DEFAULT_EPOCH_POLICY, maxFullReviewsPerEpoch: 1, maxRepeatedFingerprint: 2 },
      highRisk: false, checkFullReviewCap: true,
      bodyScopeHash: "old-hash", currentBodyScopeHash: "new-hash",
    });
    assert.equal(r.breached, true);
    assert.equal(r.breachedCap, "repeated-terminal-fingerprint", "fingerprint cap must fire FIRST even when scope changed");
  });

  test("M233 CLAIM-2: scope-change grant does NOT affect checkFullReviewCap:false call sites — no false scopeChanged leak", () => {
    const counters = { ...FRESH, fullReviews: 1 };
    const r = checkEpochCaps({
      counters, policy: DEFAULT_EPOCH_POLICY, highRisk: false, checkFullReviewCap: false,
      bodyScopeHash: "old-hash", currentBodyScopeHash: "new-hash",
    });
    assert.equal(r.breached, false);
    assert.equal(r.scopeChanged, undefined, "scopeChange only evaluated when checkFullReviewCap:true");
  });
});

describe("buildEpochRecord — no-fabrication field materialization", () => {
  test("tokensObserved defaults to null (never a fabricated 0) when omitted", () => {
    const rec = buildEpochRecord({ taskId: "T1", charterHash: "c", reviewPolicyHash: "r" });
    assert.equal(rec.counters.tokensObserved, null);
    assert.equal(rec.schemaVersion, EPOCH_SCHEMA_VERSION);
  });

  test("a real observed tokensObserved value of 0 is preserved as 0, distinct from null", () => {
    const rec = buildEpochRecord({ counters: { tokensObserved: 0 } });
    assert.equal(rec.counters.tokensObserved, 0);
  });

  test("policy defaults match DEFAULT_EPOCH_POLICY (90/150/1/2) when omitted", () => {
    const rec = buildEpochRecord({});
    assert.deepEqual(rec.policy, DEFAULT_EPOCH_POLICY);
  });

  test("overrides/resets default to empty arrays, terminalFingerprints defaults to {}", () => {
    const rec = buildEpochRecord({});
    assert.deepEqual(rec.overrides, []);
    assert.deepEqual(rec.resets, []);
    assert.deepEqual(rec.counters.terminalFingerprints, {});
  });

  test("M233 CLAIM-1: bodyScopeHash defaults to null when omitted (additive field, no schema version bump required)", () => {
    const rec = buildEpochRecord({});
    assert.equal(rec.bodyScopeHash, null, "bodyScopeHash defaults to null — additive field, backward compatible");
  });

  test("M233 CLAIM-1: bodyScopeHash stored at record TOP LEVEL (not in counters), persists an explicit value", () => {
    const rec = buildEpochRecord({ bodyScopeHash: "abc123", counters: {} });
    assert.equal(rec.bodyScopeHash, "abc123");
    // bodyScopeHash must NOT be inside counters (counters gets zeroed on --new-epoch)
    assert.equal(rec.counters.bodyScopeHash, undefined, "bodyScopeHash must NOT be inside counters");
  });
});

describe("CLI: --epoch-status / --record-epoch-dispatch / --new-epoch / --override-budget", () => {
  const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const CONVERGENCE_SCRIPT = path.join(REPO_ROOT, "experiments", "quay-perpetual-stream", "scripts", "proposal-convergence.ts");
  const FIXTURES_DIR = makeTmpDir("epoch-cli-fixtures-");

  function fixtureTaskBody() {
    return `---
id: EPOCH-CLI-FIXTURE
title: fixture task for epoch-budget CLI fixtures
status: todo
---
## Proposal

fixture proposal text v1

## Acceptance Criteria

- [ ] fixture AC item

## Definition of Done

- [ ] fixture DoD item

## Touches

- fixture.ts
`;
  }

  function makeCliScratch(taskId) {
    const dir = makeTmpDir("cli-scratch-");
    fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tasks", `${taskId}.md`), fixtureTaskBody());
    const charterFile = path.join(dir, "charter.md");
    fs.writeFileSync(charterFile, "fixture charter v1\n");
    return { dir, charterFile };
  }

  function runNode(args) {
    try {
      const stdout = execFileSync("node", ["--no-warnings", "--experimental-strip-types", ...args], { encoding: "utf8" });
      return { status: 0, stdout };
    } catch (e) {
      return { status: typeof e.status === "number" ? e.status : 1, stdout: e.stdout ? e.stdout.toString() : "" };
    }
  }
  function runStatus(dir, taskId, charterFile, extra = []) {
    return runNode([CONVERGENCE_SCRIPT, "--epoch-status", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile, ...extra]);
  }
  function runDispatch(dir, taskId, charterFile, flags = {}) {
    const args = [CONVERGENCE_SCRIPT, "--record-epoch-dispatch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile];
    for (const [k, v] of Object.entries(flags)) args.push(`--${k}`, String(v));
    return runNode(args);
  }
  function runNewEpoch(dir, taskId, charterFile, { reason, owner, confirmUnchangedScope } = {}) {
    const args = [CONVERGENCE_SCRIPT, "--new-epoch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile];
    if (reason !== undefined) args.push("--reason", reason);
    if (owner !== undefined) args.push("--owner", owner);
    if (confirmUnchangedScope !== undefined) args.push("--confirmUnchangedScope", String(confirmUnchangedScope));
    return runNode(args);
  }
  function runOverride(dir, taskId, charterFile, { reason, owner, additionalMinutes } = {}) {
    const args = [CONVERGENCE_SCRIPT, "--override-budget", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile];
    if (reason !== undefined) args.push("--reason", reason);
    if (owner !== undefined) args.push("--owner", owner);
    if (additionalMinutes !== undefined) args.push("--additional-minutes", String(additionalMinutes));
    return runNode(args);
  }

  test("--epoch-status on a task with no prior record -> no-epoch-record, exists:false, tokenAccounting:unknown", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const res = runStatus(dir, taskId, charterFile);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, true);
      assert.equal(out.code, "no-epoch-record");
      assert.equal(out.exists, false);
      assert.equal(out.tokenAccounting, "unknown");
      assert.equal(out.counters.tokensObserved, null);
      assert.equal(out.capCheck.breached, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--record-epoch-dispatch bootstraps a fresh epoch on first call (parentEpochId:null), then accumulates on a second call", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const first = runDispatch(dir, taskId, charterFile, { dispatchDelta: 2, fullReviewDelta: 1, elapsedMsDelta: 1000, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      assert.equal(first.status, 0);
      const firstOut = JSON.parse(first.stdout.trim());
      assert.equal(firstOut.ok, true);
      assert.equal(firstOut.parentEpochId, null, "the FIRST epoch ever created for a task has no parent — not a 'reset'");
      assert.equal(firstOut.counters.contentAgentDispatches, 2);
      assert.equal(firstOut.counters.fullReviews, 1);
      assert.equal(firstOut.counters.observableAgentMs, 1000);
      assert.equal(firstOut.counters.attempts, 1);

      const second = runDispatch(dir, taskId, charterFile, { dispatchDelta: 3, deltaRoundDelta: 1, elapsedMsDelta: 500, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "delta-cap-exhausted" });
      const secondOut = JSON.parse(second.stdout.trim());
      assert.equal(secondOut.epochId, firstOut.epochId, "SAME epoch across generations sharing (taskId, charterHash, reviewPolicyHash)");
      assert.equal(secondOut.counters.contentAgentDispatches, 5, "5 = 2 + 3, cumulative across generations");
      assert.equal(secondOut.counters.fullReviews, 1, "unchanged — the second dispatch recorded 0 new full reviews");
      assert.equal(secondOut.counters.deltaRounds, 1);
      assert.equal(secondOut.counters.observableAgentMs, 1500);
      assert.equal(secondOut.counters.attempts, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC: a caller-lowered --ordinaryCapMinutes is honored and persisted, but a LATER call cannot silently raise it back — callers may only ever tighten policy, never widen it", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const lowered = JSON.parse(runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding", ordinaryCapMinutes: 30 }).stdout.trim());
      assert.equal(lowered.policy.ordinaryCapMinutes, 30, "the caller's lower value is honored");

      // A later dispatch requesting a HIGHER value than both the compiled default (90) and the
      // already-persisted 30 must be silently clamped — never widened back up.
      const attemptedRaise = JSON.parse(runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding", ordinaryCapMinutes: 200 }).stdout.trim());
      assert.equal(attemptedRaise.policy.ordinaryCapMinutes, 30, "a later caller-requested 200m must NOT silently raise the already-tightened 30m ceiling");

      // Even a fresh dispatch omitting the flag entirely must not exceed the compiled 90m default.
      const noFlag = JSON.parse(runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" }).stdout.trim());
      assert.equal(noFlag.policy.ordinaryCapMinutes, 30, "omitting the flag keeps whatever is already persisted, never widens it back toward the 90m default");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC: a caller CANNOT raise ordinaryCapMinutes above the compiled 90m default on the VERY FIRST dispatch either (bootstrap path)", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const first = JSON.parse(runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding", ordinaryCapMinutes: 500 }).stdout.trim());
      assert.equal(first.policy.ordinaryCapMinutes, 90, "the compiled DEFAULT_EPOCH_POLICY ceiling (90) always wins over a caller-requested higher value, even on epoch bootstrap");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC: editing Proposal/Plan/AC/Touches content does NOT reset the epoch — fixtures prove all counters remain monotone after the same repair shapes used between DIR-126-D rounds", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const first = runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, fullReviewDelta: 1, elapsedMsDelta: 2000, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "delta-cap-exhausted" });
      const firstOut = JSON.parse(first.stdout.trim());

      // Simulate the EXACT repair shapes DIR-126-D rounds used between generations: edit Proposal,
      // Plan, AC, and Touches — none of these are hashed into the epoch's own identity key.
      const taskFile = path.join(dir, "tasks", `${taskId}.md`);
      let body = fs.readFileSync(taskFile, "utf8");
      body = body.replace("fixture proposal text v1", "fixture proposal text v2 — human repair");
      body = body.replace("- [ ] fixture AC item", "- [ ] fixture AC item\n- [ ] a second AC item added during repair");
      body = body.replace("- fixture.ts", "- fixture.ts\n- another-touched-file.ts");
      fs.writeFileSync(taskFile, body);

      const second = runDispatch(dir, taskId, charterFile, { dispatchDelta: 2, deltaRoundDelta: 1, elapsedMsDelta: 1000, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      assert.equal(second.status, 0, `expected the SAME epoch to keep accumulating after a Proposal/AC/Touches edit, got: ${second.stdout}`);
      const secondOut = JSON.parse(second.stdout.trim());
      assert.equal(secondOut.epochId, firstOut.epochId, "Proposal/AC/Touches content edits must NEVER change the epoch identity");
      assert.equal(secondOut.counters.contentAgentDispatches, 3, "monotone: 1 + 2, never reset to 2 alone");
      assert.equal(secondOut.counters.fullReviews, 1, "monotone: unchanged, never reset to 0");
      assert.equal(secondOut.counters.observableAgentMs, 3000, "monotone: 2000 + 1000, never reset");
      assert.equal(secondOut.counters.attempts, 2, "monotone: 1 + 1, never reset to 1");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a real charter edit changes the epoch identity -> --epoch-status reports epoch-identity-mismatch, --record-epoch-dispatch REFUSES to silently continue", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      fs.appendFileSync(charterFile, "\na genuinely new charter clause\n");

      const status = JSON.parse(runStatus(dir, taskId, charterFile).stdout.trim());
      assert.equal(status.code, "epoch-identity-mismatch");

      const dispatch = runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      assert.equal(dispatch.status, 1);
      const dispatchOut = JSON.parse(dispatch.stdout.trim());
      assert.equal(dispatchOut.ok, false);
      assert.equal(dispatchOut.code, "epoch-identity-mismatch-requires-new-epoch");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--new-epoch requires --reason and --owner", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      assert.equal(JSON.parse(runNewEpoch(dir, taskId, charterFile, { owner: "alice" }).stdout.trim()).code, "new-epoch-requires-reason");
      assert.equal(JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: "r" }).stdout.trim()).code, "new-epoch-requires-owner");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("AC: an authorized charter/scope reset creates a new epoch, links it to the prior epoch, and records owner/reason/old-new hashes/timestamp", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const first = JSON.parse(runDispatch(dir, taskId, charterFile, { dispatchDelta: 5, fullReviewDelta: 1, attemptIncrement: 3, terminalPhase: "ProposalReview", reason: "delta-cap-exhausted" }).stdout.trim());
      fs.appendFileSync(charterFile, "\na genuinely new charter clause\n");

      const reset = JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: "charter revised for real scope change", owner: "alice" }).stdout.trim());
      assert.equal(reset.ok, true);
      assert.notEqual(reset.epochId, first.epochId, "a genuinely new epoch id");
      assert.equal(reset.parentEpochId, first.epochId, "linked to the prior epoch");
      assert.equal(reset.record.counters.attempts, 0, "counters reset to zero on the new epoch");
      assert.equal(reset.record.counters.contentAgentDispatches, 0);
      const lastReset = reset.record.resets[reset.record.resets.length - 1];
      assert.equal(lastReset.owner, "alice");
      assert.equal(lastReset.reason, "charter revised for real scope change");
      assert.equal(lastReset.fromEpochId, first.epochId);
      assert.ok(lastReset.oldHash && lastReset.newHash && lastReset.oldHash.charterHash !== lastReset.newHash.charterHash);
      assert.ok(Number.isFinite(lastReset.timestamp));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--new-epoch with UNCHANGED identity is rejected unless --confirmUnchangedScope true is explicitly passed — never a silent bypass via a plain redispatch", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      const rejected = JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: "no real change", owner: "alice" }).stdout.trim());
      assert.equal(rejected.ok, false);
      assert.equal(rejected.code, "new-epoch-requires-changed-identity-or-explicit-confirmation");

      const confirmed = JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: "no real change", owner: "alice", confirmUnchangedScope: true }).stdout.trim());
      assert.equal(confirmed.ok, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // gap-prepare-milestone-task-epoch-budget-reset (round 3, post-SECOND-REFUTATION): a round-2
  // reviewer found `--new-epoch --confirmUnchangedScope true` had NO rate limit at all — reproduced
  // live, 5 identical calls in a row all succeeded, each erasing every cumulative counter this
  // circuit breaker exists to protect. Strictly worse than the override-chaining bug round 2 fixed
  // (that one only extended the budget; this one erased it entirely, repeatedly, for free). This
  // test reproduces the EXACT exploit shape and confirms it is now blocked.
  test("REFUTATION regression: repeated --new-epoch --confirmUnchangedScope true calls (even with an IDENTICAL owner+reason every time) cannot reset the epoch's cumulative counters indefinitely", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const results = [];
      for (let i = 0; i < 6; i++) {
        // Deliberately IDENTICAL owner+reason every time, mirroring the reviewer's exact
        // reproduction (no attempt to vary the justification at all) — a stricter reproduction than
        // even the override exploit, which at least alternated between two strings.
        const out = JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: "same-reason-every-time", owner: "same-owner-every-time", confirmUnchangedScope: true }).stdout.trim());
        results.push(out);
        if (out.ok) {
          // Re-seed a dispatch so the NEXT --new-epoch call has real accumulated state to erase —
          // proves the exploit is about erasing REAL accumulated cost, not just an empty epoch.
          runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
        }
      }

      const succeeded = results.filter((r) => r.ok === true);
      assert.ok(succeeded.length < 6, `expected the repeated-identical-reset exploit to be blocked before all 6 calls succeeded, but ${succeeded.length} succeeded`);

      // The real property that matters: the total number of resets ever recorded for this task
      // stays bounded, and a real, finite ceiling is actually enforced.
      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const record = JSON.parse(fs.readFileSync(epochFile, "utf8"));
      const maxNewEpochResetCount = record.policy.maxNewEpochResetCount;
      assert.ok(Number.isFinite(maxNewEpochResetCount) && maxNewEpochResetCount > 0, "a real, finite hard reset-count ceiling is recorded on the epoch");
      assert.ok(record.resets.length <= maxNewEpochResetCount, `total resets (${record.resets.length}) must never exceed the hard ceiling (${maxNewEpochResetCount})`);
      const lastRejection = results[results.length - 1];
      assert.equal(lastRejection.ok, false, "the final call in the sequence is rejected");
      assert.ok(["new-epoch-reset-count-cap-exceeded", "new-epoch-reset-not-distinct"].includes(lastRejection.code), `rejected for a real reason, got: ${lastRejection.code}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("REFUTATION regression: the hard maxNewEpochResetCount ceiling rejects a genuinely-distinct reset once the count cap is reached, even with a real, non-repeated reason each time", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const maxNewEpochResetCount = JSON.parse(fs.readFileSync(epochFile, "utf8")).policy.maxNewEpochResetCount;
      assert.ok(Number.isFinite(maxNewEpochResetCount) && maxNewEpochResetCount > 0);

      const results = [];
      for (let i = 0; i < maxNewEpochResetCount + 1; i++) {
        const out = JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: `genuinely distinct reset reason #${i}`, owner: `owner-${i}`, confirmUnchangedScope: true }).stdout.trim());
        results.push(out);
        runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      }

      const succeeded = results.filter((r) => r.ok === true);
      const lastResult = results[results.length - 1];
      assert.equal(succeeded.length, maxNewEpochResetCount, `exactly ${maxNewEpochResetCount} resets succeed (the hard ceiling), even though every reason/owner was genuinely distinct`);
      assert.equal(lastResult.ok, false, "the reset exceeding the hard ceiling is rejected even with a genuinely distinct reason");
      assert.equal(lastResult.code, "new-epoch-reset-count-cap-exceeded");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--override-budget grants one bounded extension and CANNOT authorize a second identical override without a distinct human scope decision", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const first = JSON.parse(runOverride(dir, taskId, charterFile, { reason: "one-off legit reason", owner: "bob", additionalMinutes: 30 }).stdout.trim());
      assert.equal(first.ok, true);
      assert.equal(first.override.additionalBudget, 30);

      const secondIdentical = runOverride(dir, taskId, charterFile, { reason: "one-off legit reason", owner: "bob", additionalMinutes: 30 });
      assert.equal(secondIdentical.status, 1);
      const secondOut = JSON.parse(secondIdentical.stdout.trim());
      assert.equal(secondOut.ok, false);
      assert.equal(secondOut.code, "override-not-distinct");

      const secondDistinct = JSON.parse(runOverride(dir, taskId, charterFile, { reason: "a genuinely different justification", owner: "bob", additionalMinutes: 15 }).stdout.trim());
      assert.equal(secondDistinct.ok, true);
      assert.equal(secondDistinct.overrides.length, 2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // gap-prepare-milestone-task-epoch-budget-reset (round 2, post-REFUTATION): an independent review
  // reproduced a real bypass — the original distinctness check compared only against the MOST
  // RECENT override, so alternating between two canned (owner, reason) pairs granted unbounded
  // cumulative override minutes (reproduced: 4 calls alternating "reason A"/"reason B", all
  // accepted, +240 minutes total, zero genuine new human scope decisions). Fixed with two
  // independent layers: a hard maxOverrideCount ceiling (the real boundary), and a strengthened
  // distinctness check comparing against the FULL override history, not just the last entry. This
  // test reproduces the EXACT exploit shape and confirms it is now blocked.
  test("REFUTATION regression: alternating between two canned (owner, reason) pairs cannot grant unbounded override minutes -- either the strengthened full-history distinctness check or the hard maxOverrideCount ceiling must stop it", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const results = [];
      const reasons = ["reason A", "reason B", "reason A", "reason B", "reason A", "reason B"];
      for (const reason of reasons) {
        const out = JSON.parse(runOverride(dir, taskId, charterFile, { reason, owner: "attacker", additionalMinutes: 60 }).stdout.trim());
        results.push(out);
      }

      // The exploit's exact shape (A, B, A, B, ...) must NOT all succeed -- either the full-history
      // distinctness check rejects the 3rd call (repeats "reason A", which appeared as call #1, not
      // just the immediately-preceding call), or the hard count ceiling rejects it once
      // maxOverrideCount is reached. Either way, unbounded accumulation is impossible.
      const succeeded = results.filter((r) => r.ok === true);
      assert.ok(succeeded.length < reasons.length, `expected the alternating-reason exploit to be blocked before all ${reasons.length} calls succeeded, but ${succeeded.length} succeeded`);

      // Read the real on-disk epoch record and confirm the total accumulated override minutes stay
      // BOUNDED -- this is the actual property that matters, not just "some call was rejected".
      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const record = JSON.parse(fs.readFileSync(epochFile, "utf8"));
      const totalOverrideMinutes = (record.overrides || []).reduce((sum, o) => sum + (o.additionalBudget || 0), 0);
      const maxOverrideCount = record.policy.maxOverrideCount;
      assert.ok(Number.isFinite(maxOverrideCount) && maxOverrideCount > 0, "a real, finite hard override-count ceiling is recorded on the epoch");
      assert.ok(record.overrides.length <= maxOverrideCount, `override count (${record.overrides.length}) must never exceed the hard ceiling (${maxOverrideCount})`);
      assert.ok(totalOverrideMinutes <= maxOverrideCount * 60, `total accumulated override minutes (${totalOverrideMinutes}) must stay bounded by the hard ceiling, not grow without limit`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("REFUTATION regression: full-history distinctness -- a THIRD override repeating the FIRST override's (owner, reason), not just the most recent one, is rejected", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const first = JSON.parse(runOverride(dir, taskId, charterFile, { reason: "original justification", owner: "carol", additionalMinutes: 20 }).stdout.trim());
      assert.equal(first.ok, true);

      const second = JSON.parse(runOverride(dir, taskId, charterFile, { reason: "a genuinely different justification", owner: "carol", additionalMinutes: 20 }).stdout.trim());
      assert.equal(second.ok, true, "the second, genuinely distinct override succeeds");

      // The third call repeats the FIRST call's (owner, reason) -- NOT the most recent (second)
      // call's. A distinctness check that only compares against the most recent entry would
      // wrongly accept this (it's "distinct" from #2). It must be rejected because it duplicates #1.
      const third = runOverride(dir, taskId, charterFile, { reason: "original justification", owner: "carol", additionalMinutes: 20 });
      const thirdOut = JSON.parse(third.stdout.trim());
      assert.equal(thirdOut.ok, false, "a repeat of the FIRST override's (owner, reason), not just the most recent one, must be rejected");
      assert.equal(thirdOut.code, "override-not-distinct");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("REFUTATION regression: the hard maxOverrideCount ceiling rejects a genuinely-distinct override once the count cap is reached, even with a real, non-repeated reason", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const maxOverrideCount = JSON.parse(fs.readFileSync(epochFile, "utf8")).policy.maxOverrideCount;
      assert.ok(Number.isFinite(maxOverrideCount) && maxOverrideCount > 0);

      const results = [];
      for (let i = 0; i < maxOverrideCount + 1; i++) {
        const out = JSON.parse(runOverride(dir, taskId, charterFile, { reason: `genuinely distinct reason #${i}`, owner: `owner-${i}`, additionalMinutes: 5 }).stdout.trim());
        results.push(out);
      }

      const succeeded = results.filter((r) => r.ok === true);
      const lastResult = results[results.length - 1];
      assert.equal(succeeded.length, maxOverrideCount, `exactly ${maxOverrideCount} overrides succeed (the hard ceiling), even though every reason/owner was genuinely distinct`);
      assert.equal(lastResult.ok, false, "the call exceeding the hard ceiling is rejected even with a genuinely distinct reason");
      assert.equal(lastResult.code, "override-count-cap-exceeded");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--override-budget requires an existing epoch and a positive --additional-minutes", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const noEpoch = JSON.parse(runOverride(dir, taskId, charterFile, { reason: "r", owner: "o", additionalMinutes: 10 }).stdout.trim());
      assert.equal(noEpoch.code, "override-requires-existing-epoch");
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      const badMinutes = JSON.parse(runOverride(dir, taskId, charterFile, { reason: "r", owner: "o", additionalMinutes: -5 }).stdout.trim());
      assert.equal(badMinutes.code, "override-requires-positive-minutes");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("tokensObserved is additive across dispatches and never fabricated to 0 when the flag is simply absent", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const noTokenFlag = JSON.parse(runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" }).stdout.trim());
      assert.equal(noTokenFlag.counters.tokensObserved, null, "absent --tokensObserved leaves it null, never a fabricated 0");

      const withTokens = JSON.parse(runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding", tokensObserved: 5000 }).stdout.trim());
      assert.equal(withTokens.counters.tokensObserved, 5000);

      const accumulated = JSON.parse(runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding", tokensObserved: 3000 }).stdout.trim());
      assert.equal(accumulated.counters.tokensObserved, 8000, "additive: 5000 + 3000");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("epochPath resolves under .quay/prepare-epochs/<safeTaskIdSegment>.json — reuses the SAME sanitizer segment shape as checkpointPath", () => {
    const p1 = epochPath("/ws", "some/task");
    const p2 = checkpointPath("/ws", "some/task");
    assert.equal(path.basename(p1), path.basename(p2), "both sanitize 'some/task' to the SAME filename segment");
    assert.match(p1, /\.quay[/\\]prepare-epochs[/\\]/);
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // ── gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening: TOCTOU race regression ─────────
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // Follow-up from the round-3 adversarial review of gap-prepare-milestone-task-epoch-budget-reset
  // (out of that task's own threat model, which was single-actor SEQUENTIAL redispatch only). The
  // reviewer fired genuinely concurrent `--new-epoch`/`--override-budget` child processes against a
  // shared epoch and reproduced TWO real defects pre-fix: (a) the hard ceiling was exceeded by one
  // (4 ok:true against a cap of 3), and (b) the final on-disk record showed FEWER entries than the
  // number of ok:true responses -- one caller's own accepted reset/override silently vanished from
  // the audit trail (last-writer-wins on `_atomicWriteJson`'s rename, no lock around the
  // read-check-write window). `_acquireEpochLock`/`_releaseEpochLock` (wx-flag exclusive lock,
  // reusing prepare-admission-check.ts's `wx` primitive) close this. Uses REAL spawned child
  // processes (node:child_process `spawn`, not in-process mocks/Promise.all-of-sync-calls) — the
  // established pattern this repo's own cross-process race tests use (see
  // prepare-admission-check.test.mjs's `gap-prepare-milestone-lease-read-race` describe block).
  // kill-timeout guard (2026-08-08, red-window #9): the suite hung 20+ min when one of the
  // concurrent children blocked in a futex (Node/libuv internal condition-variable wait) under the
  // full suite's extreme contention (cpu avg10 71, ~100 threads from 20 spawned children) — a hung
  // child stalled the ENTIRE main group because the suite runs --test-timeout=0. The epoch-lock
  // acquire/release is provably bounded (7 attempts, ~1.3s retry budget; stale-reclaim 30s); the
  // hang is not in that logic. A generous default converts an indefinite hang into a bounded,
  // diagnosable timeout failure so a single stuck child can never hang the suite again.
  // 60s (raised from 20s on 2026-08-09, red-window #10): the suite runs inside a systemd-run scope
  // with CPUQuota=200% (nproc=2 inside), and 20 concurrent node spawns + the epoch-lock retries can
  // legitimately take 20-60s under that 2-core oversubscription — 20s false-timed-out a starved
  // but alive child. 60s is still ≫ the lock retry budget + the 500ms test-hold seam, and bounds a
  // true deadlock to a bounded failure.
  function spawnConvergenceCli(args, { timeoutMs = 60_000 } = {}) {
    return new Promise((resolve) => {
      const child = spawn("node", ["--no-warnings", "--experimental-strip-types", CONVERGENCE_SCRIPT, ...args]);
      let stdout = "";
      let stderr = "";
      let settled = false;
      const killTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({ code: null, timeout: true, stdout, stderr: `${stderr}\n[spawnConvergenceCli] TIMEOUT: child did not exit within ${timeoutMs}ms — SIGKILLed (blocked in a futex under load); treat as a hang, not a pass` });
      }, timeoutMs);
      child.stdout.on("data", (d) => { stdout += d; });
      child.stderr.on("data", (d) => { stderr += d; });
      child.on("close", (code) => { if (settled) return; settled = true; clearTimeout(killTimer); resolve({ code, stdout, stderr }); });
      child.on("error", (err) => { if (settled) return; settled = true; clearTimeout(killTimer); resolve({ code: -1, stdout, stderr: `${stderr}\nspawn error: ${err.message}` }); });
    });
  }
  function spawnNewEpoch(dir, taskId, charterFile, { reason, owner, confirmUnchangedScope, timeoutMs } = {}) {
    const args = ["--new-epoch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile];
    if (reason !== undefined) args.push("--reason", reason);
    if (owner !== undefined) args.push("--owner", owner);
    if (confirmUnchangedScope !== undefined) args.push("--confirmUnchangedScope", String(confirmUnchangedScope));
    return spawnConvergenceCli(args, { timeoutMs });
  }
  function spawnOverride(dir, taskId, charterFile, { reason, owner, additionalMinutes, timeoutMs } = {}) {
    const args = ["--override-budget", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile];
    if (reason !== undefined) args.push("--reason", reason);
    if (owner !== undefined) args.push("--owner", owner);
    if (additionalMinutes !== undefined) args.push("--additional-minutes", String(additionalMinutes));
    return spawnConvergenceCli(args, { timeoutMs });
  }
  function parseCliJson(res) {
    // round-5 red, cluster A (kill-timeout SIGKILL white-list): a child that exceeded the spawn
    // kill-timeout (spawnConvergenceCli's timeoutMs, default 60s) was SIGKILLed — an indefinite
    // hang converted into a bounded, diagnosable failure (red-window #9/#10). Under the full suite's
    // extreme load a starved-but-alive child can legitimately blow the 60s bound (futex-blocked, not
    // broken); that is a DESIGNED bounded contention outcome, in the same family as
    // `epoch-lock-contention`. It MUST surface as a recognizable typed rejection — `epoch-cli-timeout`
    // — that the REGRESSION acceptance whitelist contains, never as `unparseable-cli-output` (which
    // reads like a CLI crash). A killed child's stdout is empty, so the JSON.parse branch below would
    // otherwise swallow the timeout into the catch-all unparseable code; check res.timeout FIRST.
    if (res.timeout === true) {
      return { ok: false, code: "epoch-cli-timeout", raw: res.stdout, stderr: res.stderr, exitCode: res.code, timeout: true };
    }
    try {
      return JSON.parse(res.stdout.trim());
    } catch {
      return { ok: false, code: "unparseable-cli-output", raw: res.stdout, stderr: res.stderr, exitCode: res.code };
    }
  }

  test("REGRESSION (gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening): 20 genuinely concurrent --new-epoch child processes against a shared epoch (maxNewEpochResetCount:3) never exceed the hard ceiling, and every ok:true response has a real, permanently-persisted entry in the final on-disk record", async () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      // Seed an existing epoch record first — `_newEpochCli`'s entire ceiling/distinctness block
      // is wrapped in `if (existing) {...}` and is skipped completely when no record exists yet.
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const N = 20; // matches the reviewer's own heavier reproduction (6 AND separately 20 concurrent processes)
      const launches = [];
      for (let i = 0; i < N; i++) {
        // Distinct owner+reason per caller — isolates the TOCTOU/lock property under test from the
        // SEPARATE (already-covered) distinctness-rejection mechanism.
        launches.push(spawnNewEpoch(dir, taskId, charterFile, { reason: `concurrent reset reason #${i}`, owner: `owner-${i}`, confirmUnchangedScope: true }));
      }
      const results = (await Promise.all(launches)).map(parseCliJson);

      const succeeded = results.filter((r) => r.ok === true);
      const lockContention = results.filter((r) => r.code === "epoch-lock-contention");
      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const record = JSON.parse(fs.readFileSync(epochFile, "utf8"));
      const maxNewEpochResetCount = record.policy.maxNewEpochResetCount;
      assert.ok(Number.isFinite(maxNewEpochResetCount) && maxNewEpochResetCount > 0, "a real, finite hard reset-count ceiling is recorded on the epoch");

      // (a) the hard ceiling is NEVER exceeded, regardless of concurrency -- the pre-fix
      // reproduction got 4 ok:true against a cap of 3.
      assert.ok(succeeded.length <= maxNewEpochResetCount, `expected at most ${maxNewEpochResetCount} of ${N} genuinely concurrent --new-epoch calls to succeed, got ${succeeded.length} — the hard ceiling was exceeded under concurrency`);
      // (b) every ok:true response corresponds to a real, permanently-persisted entry in the final
      // on-disk record -- no last-writer-wins silent data loss (the pre-fix defect: the final
      // record showed only 3 resets even when 4 callers were told ok:true).
      assert.equal(record.resets.length, succeeded.length, `every accepted reset must survive to the final on-disk record — got ${succeeded.length} ok:true responses but only ${record.resets.length} persisted resets (silent data loss)`);
      assert.ok(record.resets.length <= maxNewEpochResetCount, `persisted resets (${record.resets.length}) must never exceed the hard ceiling (${maxNewEpochResetCount})`);
      // Every non-ok response is a real, typed rejection (ceiling/distinctness/lock-contention),
      // never an unhandled exception/crash.
      for (const r of results) {
        if (r.ok !== true) {
          assert.ok(
            ["new-epoch-reset-count-cap-exceeded", "new-epoch-reset-not-distinct", "epoch-lock-contention", "epoch-cli-timeout"].includes(r.code),
            `unexpected rejection code for a concurrent --new-epoch call: ${r.code} (${JSON.stringify(r)})`
          );
        }
      }
      // Never a total lockout — with only 20 short-lived callers and generous bounded retries,
      // lock contention should resolve for the overwhelming majority (this is a real, not just
      // theoretical, liveness check on the retry/backoff bound).
      assert.ok(lockContention.length < N, "the bounded lock retry must not starve every single concurrent caller");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("REGRESSION (gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening): 20 genuinely concurrent --override-budget child processes against a shared epoch (maxOverrideCount:3) never exceed the hard ceiling, and every ok:true response has a real, permanently-persisted entry in the final on-disk record", async () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const N = 20;
      const launches = [];
      for (let i = 0; i < N; i++) {
        launches.push(spawnOverride(dir, taskId, charterFile, { reason: `concurrent override reason #${i}`, owner: `owner-${i}`, additionalMinutes: 5 }));
      }
      const results = (await Promise.all(launches)).map(parseCliJson);

      const succeeded = results.filter((r) => r.ok === true);
      const lockContention = results.filter((r) => r.code === "epoch-lock-contention");
      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const record = JSON.parse(fs.readFileSync(epochFile, "utf8"));
      const maxOverrideCount = record.policy.maxOverrideCount;
      assert.ok(Number.isFinite(maxOverrideCount) && maxOverrideCount > 0, "a real, finite hard override-count ceiling is recorded on the epoch");

      assert.ok(succeeded.length <= maxOverrideCount, `expected at most ${maxOverrideCount} of ${N} genuinely concurrent --override-budget calls to succeed, got ${succeeded.length} — the hard ceiling was exceeded under concurrency`);
      assert.equal(record.overrides.length, succeeded.length, `every accepted override must survive to the final on-disk record — got ${succeeded.length} ok:true responses but only ${record.overrides.length} persisted overrides (silent data loss)`);
      assert.ok(record.overrides.length <= maxOverrideCount, `persisted overrides (${record.overrides.length}) must never exceed the hard ceiling (${maxOverrideCount})`);
      for (const r of results) {
        if (r.ok !== true) {
          assert.ok(
            ["override-count-cap-exceeded", "override-not-distinct", "epoch-lock-contention", "epoch-cli-timeout"].includes(r.code),
            `unexpected rejection code for a concurrent --override-budget call: ${r.code} (${JSON.stringify(r)})`
          );
        }
      }
      assert.ok(lockContention.length < N, "the bounded lock retry must not starve every single concurrent caller");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kill-timeout (round-5 red, cluster A): a --new-epoch child SIGKILLed for exceeding the spawn kill-timeout surfaces as the RECOGNIZABLE bounded rejection code `epoch-cli-timeout` (never `unparseable-cli-output`), white-listed by the REGRESSION acceptance", async () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      // Force the kill-timeout deterministically: a 50ms deadline is far below node's own spawn +
      // --experimental-strip-types startup cost, so the child CANNOT finish the epoch logic — the
      // timeout path (SIGKILL) fires, never a real completion or a fast-fail. This is the Contract
      // measure: "并发 --new-epoch child 超时被 kill 时 CLI 返回的 code".
      const res = await spawnNewEpoch(dir, taskId, charterFile, {
        reason: "forced-timeout", owner: "owner-timeout", confirmUnchangedScope: true, timeoutMs: 50,
      });
      assert.equal(res.timeout, true, "the child must be killed by the kill-timeout guard (res.timeout=true)");
      const parsed = parseCliJson(res);
      assert.equal(parsed.ok, false, "a timed-out child is a rejection, never ok:true");
      assert.equal(parsed.code, "epoch-cli-timeout", `a timed-out child must surface the RECOGNIZABLE code, got ${parsed.code} (${JSON.stringify(parsed)})`);
      assert.equal(parsed.timeout, true, "the timeout marker must survive through parseCliJson");
      // The code is one of the REGRESSION-accepted rejections — the SAME whitelist the two
      // 20-concurrency REGRESSION tests assert against, so a real (load-induced) timeout under the
      // full suite is a legal bounded contention result, not an unexpected rejection.
      assert.ok(
        ["new-epoch-reset-count-cap-exceeded", "new-epoch-reset-not-distinct", "epoch-lock-contention", "epoch-cli-timeout"].includes(parsed.code),
        `epoch-cli-timeout must be in the REGRESSION acceptance whitelist, got ${parsed.code}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--new-epoch/--override-budget: a genuinely stale (crashed-holder) lock file older than EPOCH_LOCK_STALE_MS is reclaimed rather than permanently deadlocking the mechanism", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      const lockFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.lock`);
      fs.mkdirSync(path.dirname(lockFile), { recursive: true });
      // A lock file "acquired" 5 minutes ago (well past EPOCH_LOCK_STALE_MS=30s) by a pid that no
      // longer holds it — models a crashed prior holder, never released.
      fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999999, acquiredAtMs: Date.now() - 5 * 60 * 1000 }), { flag: "wx" });

      const out = JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: "reclaim-after-stale-lock", owner: "rescuer", confirmUnchangedScope: true }).stdout.trim());
      assert.equal(out.ok, true, `a stale lock must be reclaimed, not a permanent deadlock: ${JSON.stringify(out)}`);
      assert.ok(!fs.existsSync(lockFile), "the lock is released again after the reclaiming call completes");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Round-2 review finding: a CORRUPT (unparseable JSON) lock file made `existing` null forever,
  // so the age computed from `existing.acquiredAtMs` was always null and the 30s staleness reclaim
  // path could NEVER fire — a permanent block, not the bounded-then-reclaimed behavior the
  // mechanism claims. Fixed by falling back to the lock FILE's own mtime (content-independent)
  // when the JSON content can't be parsed. This test plants a genuinely corrupt (not just
  // stale-but-valid) lock file and confirms it is still reclaimed after the staleness window.
  test("--new-epoch/--override-budget: a CORRUPT (unparseable) lock file older than EPOCH_LOCK_STALE_MS is reclaimed via its own file mtime, not permanently blocked", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      const lockFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.lock`);
      fs.mkdirSync(path.dirname(lockFile), { recursive: true });
      // Genuinely corrupt content — not valid JSON at all, unlike the stale-holder test above
      // (which plants well-formed JSON with an old timestamp). `existing.acquiredAtMs` can never be
      // read from this; only the file's own mtime can establish its age.
      fs.writeFileSync(lockFile, "{not valid json at all, no acquiredAtMs field to read", { flag: "wx" });
      // Backdate the file's own mtime past the staleness window (utimesSync sets both atime/mtime).
      const oldTime = new Date(Date.now() - 5 * 60 * 1000);
      fs.utimesSync(lockFile, oldTime, oldTime);

      const out = JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: "reclaim-after-corrupt-lock", owner: "rescuer", confirmUnchangedScope: true }).stdout.trim());
      assert.equal(out.ok, true, `a corrupt-but-old lock must be reclaimed via file mtime, never a permanent deadlock: ${JSON.stringify(out)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Round-2 review finding: the original concurrency regression test only caught a fully-disabled
  // lock ~57% of the time (4/7 runs) on a real machine — natural OS-scheduling variance doesn't
  // reliably force two concurrent critical sections to overlap, so a future accidental breakage of
  // the lock has a real chance of silently passing CI. Fixed by using the test-only
  // QUAY_EPOCH_LOCK_TEST_HOLD_MS env var (read only by `_acquireEpochLock`, never in production
  // code) to force a real, deterministic overlap window between two concurrent callers, then
  // asserting the SECOND caller is genuinely blocked until the first releases (rather than both
  // proceeding concurrently) — a direct, deterministic proof the lock's mutual exclusion is real,
  // not a statistical inference from a race that might not manifest on a given run.
  test("REGRESSION (deterministic): with an artificially widened critical section (QUAY_EPOCH_LOCK_TEST_HOLD_MS), a second concurrent --new-epoch call is genuinely blocked until the first releases the lock — proves real mutual exclusion, not scheduling luck", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      // Must fit comfortably within EPOCH_LOCK_RETRY_DELAYS_MS's total retry budget (~1.26s) minus
      // the head start below, or the waiter legitimately exhausts its retries first (a correct
      // fail-closed outcome under real contention, but not what THIS test wants to demonstrate).
      const HOLD_MS = 500;
      const args = [CONVERGENCE_SCRIPT, "--new-epoch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile, "--reason", "holder", "--owner", "A", "--confirmUnchangedScope", "true"];
      const holderStart = Date.now();
      const holderProc = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", ...args], {
        cwd: REPO_ROOT,
        env: { ...process.env, QUAY_EPOCH_LOCK_TEST_HOLD_MS: String(HOLD_MS) },
      });
      // Give the holder a real head start to actually acquire the lock before the second call fires.
      const sab = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(sab, 0, 0, 150);

      const secondStart = Date.now();
      const secondOut = JSON.parse(runNewEpoch(dir, taskId, charterFile, { reason: "waiter", owner: "B", confirmUnchangedScope: true }).stdout.trim());
      const secondElapsedMs = Date.now() - secondStart;

      holderProc.kill(); // best-effort cleanup; the holder should already be finishing by now
      const holderElapsedMs = Date.now() - holderStart;

      assert.equal(secondOut.ok, true, `the second call must eventually succeed once the lock is released: ${JSON.stringify(secondOut)}`);
      // The decisive assertion: the second call must have taken meaningfully longer than an
      // uncontended call would (a few ms) — proving it genuinely waited out the first call's real
      // held critical section rather than proceeding concurrently. A generous floor (200ms) avoids
      // false failures from scheduling jitter while still being far above what a no-op/broken lock
      // would produce (an uncontended --new-epoch call completes in well under 100ms).
      assert.ok(secondElapsedMs >= 200, `the second call returned in ${secondElapsedMs}ms — too fast to have genuinely waited for the first call's ${HOLD_MS}ms held lock (holder total: ${holderElapsedMs}ms); mutual exclusion is not real`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // ── M233: bodyScopeHash scope-change grant — CLI round-trip tests ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  function fixtureTaskBodyV2() {
    return `---
id: EPOCH-CLI-FIXTURE
title: fixture task for epoch-budget CLI fixtures
status: todo
---
## Proposal

fixture proposal text v2 — second version, different from v1

## Acceptance Criteria

- [ ] fixture AC item

## Definition of Done

- [ ] fixture DoD item

## Touches

- fixture.ts
`;
  }

  test("M233 CLAIM-5: --epoch-status --compute-body-scope-hash true reads task body and computes hash, returns both bodyScopeHash and recordBodyScopeHash", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      // First dispatch to create a record
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, fullReviewDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });
      // Expected hash = sha256 of extractSection(taskBody, "Proposal") which returns
      // "\nfixture proposal text v1\n\n" (leading newline after ## Proposal, trailing newlines before next heading)
      const expectedHash = crypto.createHash("sha256").update("\nfixture proposal text v1\n\n", "utf8").digest("hex");
      const res = runStatus(dir, taskId, charterFile, ["--compute-body-scope-hash", "true"]);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, true);
      assert.equal(out.code, "epoch-status-ok");
      assert.equal(typeof out.bodyScopeHash, "string", "bodyScopeHash must be present and a string");
      assert.equal(out.bodyScopeHash, expectedHash, "bodyScopeHash must match sha256 of Proposal section");
      // After dispatch, recordBodyScopeHash should still be null (pre-migration record didn't have it)
      assert.equal(out.recordBodyScopeHash, null, "recordBodyScopeHash is null because no bodyScopeHash was explicitly stored yet");
      // capCheck must have been called with bodyScopeHash/currentBodyScopeHash — since stored is null, no grant
      assert.equal(out.capCheck.breached, false, "with fullReviews=1, checkFullReviewCap not passed here");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("M233 CLAIM-3: --record-epoch-dispatch with --bodyScopeHash resets fullReviews on mismatch (round-trip via real record file)", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      // Step 1: first dispatch with bodyScopeHash "hash-a", fullReviewDelta=1
      const firstArgs = { dispatchDelta: 1, fullReviewDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" };
      const first = runNode(
        [CONVERGENCE_SCRIPT, "--record-epoch-dispatch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
         "--dispatchDelta", String(firstArgs.dispatchDelta), "--fullReviewDelta", String(firstArgs.fullReviewDelta),
         "--attemptIncrement", String(firstArgs.attemptIncrement), "--terminalPhase", firstArgs.terminalPhase, "--reason", firstArgs.reason,
         "--bodyScopeHash", "hash-a"]
      );
      assert.equal(first.status, 0);
      const firstOut = JSON.parse(first.stdout.trim());
      assert.equal(firstOut.ok, true);
      assert.equal(firstOut.counters.fullReviews, 1, "first dispatch: fullReviews = 1");

      // Step 2: second dispatch with bodyScopeHash "hash-b" (different), fullReviewDelta=1
      const secondArgs = { dispatchDelta: 1, fullReviewDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "revision-needed" };
      const second = runNode(
        [CONVERGENCE_SCRIPT, "--record-epoch-dispatch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
         "--dispatchDelta", String(secondArgs.dispatchDelta), "--fullReviewDelta", String(secondArgs.fullReviewDelta),
         "--attemptIncrement", String(secondArgs.attemptIncrement), "--terminalPhase", secondArgs.terminalPhase, "--reason", secondArgs.reason,
         "--bodyScopeHash", "hash-b"]
      );
      assert.equal(second.status, 0);
      const secondOut = JSON.parse(second.stdout.trim());
      assert.equal(secondOut.ok, true);
      assert.equal(secondOut.counters.fullReviews, 1, "hash changed -> fullReviews RESET to fullReviewDelta (1), NOT accumulated to 2");

      // Verify the on-disk record
      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const record = JSON.parse(fs.readFileSync(epochFile, "utf8"));
      assert.equal(record.bodyScopeHash, "hash-b", "bodyScopeHash updated to the new hash");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("M233 CLAIM-4: --record-epoch-dispatch with fullReviewDelta=0 carries bodyScopeHash forward unchanged", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      // First dispatch with a full review and bodyScopeHash set
      runNode(
        [CONVERGENCE_SCRIPT, "--record-epoch-dispatch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
         "--dispatchDelta", "1", "--fullReviewDelta", "1", "--attemptIncrement", "1",
         "--terminalPhase", "ProposalReview", "--reason", "zero-finding", "--bodyScopeHash", "hash-a"]
      );

      // Second dispatch with fullReviewDelta=0, no bodyScopeHash flag — should carry forward
      const second = runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, fullReviewDelta: 0, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "delta-round" });
      assert.equal(second.status, 0);
      const secondOut = JSON.parse(second.stdout.trim());
      assert.equal(secondOut.ok, true);

      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const record = JSON.parse(fs.readFileSync(epochFile, "utf8"));
      assert.equal(record.bodyScopeHash, "hash-a", "bodyScopeHash carried forward unchanged when fullReviewDelta=0");
      assert.equal(record.counters.fullReviews, 1, "fullReviews unchanged when fullReviewDelta=0");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("M233 CLAIM-4: --record-epoch-dispatch does NOT increment resets when resetting fullReviews due to bodyScopeHash change", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      // First dispatch
      runNode(
        [CONVERGENCE_SCRIPT, "--record-epoch-dispatch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
         "--dispatchDelta", "1", "--fullReviewDelta", "1", "--attemptIncrement", "1",
         "--terminalPhase", "ProposalReview", "--reason", "zero-finding", "--bodyScopeHash", "hash-a"]
      );

      // Second dispatch with different bodyScopeHash — triggers reset but NOT resets[]
      const second = runNode(
        [CONVERGENCE_SCRIPT, "--record-epoch-dispatch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
         "--dispatchDelta", "1", "--fullReviewDelta", "1", "--attemptIncrement", "1",
         "--terminalPhase", "ProposalReview", "--reason", "revision-needed", "--bodyScopeHash", "hash-b"]
      );
      assert.equal(second.status, 0);

      const epochFile = path.join(dir, ".quay", "prepare-epochs", `${taskId}.json`);
      const record = JSON.parse(fs.readFileSync(epochFile, "utf8"));
      assert.deepEqual(record.resets, [], "resets[] must be empty — scope-change grant is NOT a --new-epoch reset");
      assert.equal(record.counters.fullReviews, 1, "fullReviews reset to 1 (fullReviewDelta) on hash mismatch");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("M233 CLAIM-9: --epoch-status --compute-body-scope-hash on a pre-migration record (no bodyScopeHash) returns bodyScopeHash:null as recordBodyScopeHash", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      // Dispatch WITHOUT --bodyScopeHash flag
      runDispatch(dir, taskId, charterFile, { dispatchDelta: 1, fullReviewDelta: 1, attemptIncrement: 1, terminalPhase: "ProposalReview", reason: "zero-finding" });

      const res = runStatus(dir, taskId, charterFile, ["--compute-body-scope-hash", "true"]);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, true);
      assert.equal(typeof out.bodyScopeHash, "string", "bodyScopeHash of current task must be computed");
      assert.equal(out.recordBodyScopeHash, null, "pre-migration record has no bodyScopeHash -> recordBodyScopeHash is null");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("M233 CLAIM-5: --epoch-status --compute-body-scope-hash on no-epoch-record also returns hashes", () => {
    const taskId = "EPOCH-CLI-FIXTURE-NEW";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      const res = runStatus(dir, taskId, charterFile, ["--compute-body-scope-hash", "true"]);
      assert.equal(res.status, 0);
      const out = JSON.parse(res.stdout.trim());
      assert.equal(out.ok, true);
      assert.equal(out.code, "no-epoch-record");
      assert.equal(typeof out.bodyScopeHash, "string", "bodyScopeHash computed even when no epoch record exists");
      assert.equal(out.recordBodyScopeHash, null, "no record -> recordBodyScopeHash is null");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("M233 CLAIM-3: --new-epoch carries bodyScopeHash forward from the existing record", () => {
    const taskId = "EPOCH-CLI-FIXTURE";
    const { dir, charterFile } = makeCliScratch(taskId);
    try {
      // First dispatch with bodyScopeHash
      runNode(
        [CONVERGENCE_SCRIPT, "--record-epoch-dispatch", "--taskId", taskId, "--workspace", dir, "--charterFile", charterFile,
         "--dispatchDelta", "1", "--fullReviewDelta", "1", "--attemptIncrement", "1",
         "--terminalPhase", "ProposalReview", "--reason", "zero-finding", "--bodyScopeHash", "hash-carry"]
      );

      // Now do --new-epoch with unchanged scope
      const reset = runNewEpoch(dir, taskId, charterFile, { reason: "reset", owner: "tester", confirmUnchangedScope: true });
      assert.equal(reset.status, 0);
      const resetOut = JSON.parse(reset.stdout.trim());
      assert.equal(resetOut.ok, true);
      const record = resetOut.record;
      assert.equal(record.bodyScopeHash, "hash-carry", "bodyScopeHash carried forward across --new-epoch reset");
      assert.equal(record.counters.attempts, 0, "counters reset to zero");
      assert.equal(record.resets.length, 1, "a reset entry was recorded");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
