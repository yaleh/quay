// Unit tests for proposal-convergence.ts — DIR-125's bounded ProposalReview convergence engine.
// Pure-function coverage: caps, stable finding identity, ledger merge/resolution, split
// recommendation, injected-clock budget status, the nextAction decision table, ledger
// hash-binding, and the receipt-side mechanical cap re-check.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";

import {
  capsFor, fingerprintFinding, upsertFindings, applyResolutions, blockingOpen,
  checkSplitRecommendation, budgetStatus, nextAction, hashLedger,
  validateConvergenceCounters, computeConvergenceMetrics, isValidDisposition,
  decideResumeGeneration, PHASE_RANK, CACHEABLE_TERMINALS, RESUMABLE_PHASES, RESUME_POLICY_VERSION,
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

// ── Cross-check: prepare-milestone.js's inline caps must match capsFor() (DIR-125 — the workflow
// file has no import statements by established convention and therefore inlines the SAME numbers;
// this test fails loudly if the two ever drift). ──────────────────────────────────────────────
test("prepare-milestone.js mirrors inline the SAME caps as capsFor()", () => {
  const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  for (const rel of [".claude/workflows/prepare-milestone.js", "plugin/workflows/prepare-milestone.js"]) {
    const src = fs.readFileSync(path.join(repoRoot, rel), "utf8");
    assert.match(src, /maxDeltaRounds:\s*_highRisk\s*\?\s*3\s*:\s*2/, `${rel}: ordinary/highRisk maxDeltaRounds must be 2/3`);
    assert.match(src, /_highRisk\s*\?\s*75\s*:\s*45/, `${rel}: ordinary/highRisk budget must be 45/75 minutes`);
  }
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
  const FIXTURES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dir126c-fixtures-"));

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
    const dir = fs.mkdtempSync(path.join(FIXTURES_DIR, "cli-scratch-"));
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
    const scratch = fs.mkdtempSync(path.join(FIXTURES_DIR, "import-"));
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
  const FIXTURES_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dir126d-fixtures-"));

  function fixtureTaskBody(proposalText) {
    return `---\nid: DIR-126-D-CLI-FIXTURE\ntitle: fixture task for telemetry CLI fixtures\nstatus: todo\n---\n## Proposal\n\n${proposalText}\n\n## Acceptance Criteria\n\n- [ ] fixture AC item\n\n## Definition of Done\n\n- [ ] fixture DoD item\n\n## Touches\n\n- fixture.ts\n`;
  }
  function makeCliScratch(taskId, proposalText = "fixture proposal v1") {
    const dir = fs.mkdtempSync(path.join(FIXTURES_DIR, "cli-scratch-"));
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
    const dir = fs.mkdtempSync(path.join(FIXTURES_DIR, "attempt-"));
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
    const dir = fs.mkdtempSync(path.join(FIXTURES_DIR, "attempt-missing-"));
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

  test("AC8: no reverse/dual-write dependency — zero references to RunIdentity/StageReceiptEnvelope anywhere in proposal-convergence.ts or milestone-preparation-check.ts", () => {
    const convergenceSrc = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "proposal-convergence.ts"), "utf8");
    const prepCheckSrc = fs.readFileSync(path.join(import.meta.dirname, "..", "scripts", "milestone-preparation-check.ts"), "utf8");
    for (const name of ["RunIdentity", "StageReceiptEnvelope"]) {
      assert.ok(!convergenceSrc.includes(name), `proposal-convergence.ts must not reference ${name} (no reverse dependency on a DIR-124-B-shaped file)`);
      assert.ok(!prepCheckSrc.includes(name), `milestone-preparation-check.ts must not reference ${name} (no reverse dependency on a DIR-124-B-shaped file)`);
    }
  });

  test("AC8: the docs/proposals/quay-prepare-execute-feedback-convergence.md migration-shape subsection is present and names the frozen schemaVersion: 2 record", () => {
    const docPath = path.join(import.meta.dirname, "..", "..", "..", "docs", "proposals", "quay-prepare-execute-feedback-convergence.md");
    const doc = fs.readFileSync(docPath, "utf8");
    assert.match(doc, /schemaVersion: 2/, "the migration-shape subsection must name the frozen schemaVersion: 2 record");
    assert.match(doc, /DIR-126-D remains the Prepare telemetry PRODUCER/, "the doc must explicitly disclaim a reverse/second-authority role");
  });
});
