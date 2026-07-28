// Unit tests for proposal-convergence.ts — DIR-125's bounded ProposalReview convergence engine.
// Pure-function coverage: caps, stable finding identity, ledger merge/resolution, split
// recommendation, injected-clock budget status, the nextAction decision table, ledger
// hash-binding, and the receipt-side mechanical cap re-check.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  capsFor, fingerprintFinding, upsertFindings, applyResolutions, blockingOpen,
  checkSplitRecommendation, budgetStatus, nextAction, hashLedger,
  validateConvergenceCounters, computeConvergenceMetrics, isValidDisposition,
} from "../scripts/proposal-convergence.ts";

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
