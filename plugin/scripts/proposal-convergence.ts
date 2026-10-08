// proposal-convergence.ts — DIR-125: the bounded ProposalReview convergence engine.
//
// PROBLEM this closes: DIR-120/M192 exposed prepare-milestone.js's ProposalReview phase as an
// UNBOUNDED loop — a nonzero review immediately returned `revision-needed`, the CALLER restarted
// the whole workflow, and two new Proposal authors + a new adjudicator rewrote the complete
// Proposal before every single review. Ten real attempts (finding sequence 8→2→1→1→1→2→2→1→2→1)
// consumed ~3h15m active workflow time / ~1.13M output tokens without ever reaching PlanAuthor.
// PlanCheck already has a real bound (<=3 rounds, F_i=0 — see milestone-preparation-check.ts's
// `plancheck-rounds-exceeded`); ProposalReview had none. This module is the SAME kind of bound for
// ProposalReview: one full synthesis per generation, then focused delta rounds against a typed,
// disposition-tracked finding ledger, with a hard round cap and a soft wall-clock budget.
//
// This module is PURE (no agent/LLM dispatch, no file I/O) so it can be unit tested directly and
// consumed by milestone-preparation-check.ts (a real ESM import) for mechanical, receipt-side cap
// re-verification. prepare-milestone.js (both mirrors) is a self-contained workflow file with NO
// import statements (established convention — see its own PlanCheck loop's inline
// `MAX_PLANCHECK_ROUNDS` constant); it therefore embeds the SAME decision logic inline rather than
// importing this module at runtime. The values MUST match `capsFor()` below — this is asserted by
// experiments/quay-perpetual-stream/test/proposal-convergence.test.mjs's
// "prepare-milestone.js inline caps match capsFor()" cross-check test.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDirectEntry, parseArgs } from "./gate-script-base.ts";
import { writeJsonAtomic } from "./write-json-atomic.ts";
import { extractSection, countBoxes } from "./task-schema.ts";
import { PREFLIGHT_POLICY_VERSION, releaseLease, safeTaskIdSegment, _readLeaseFileWithRetry } from "./prepare-admission-check.ts";
// gap-prepare-milestone-cross-generation-review-state-reset: the novelty scan (AC #6) reuses
// wiring-coverage-check.ts's REAL claim-extraction machinery verbatim — never a second,
// independently-buggy implementation of "what counts as a mechanism claim" (the same DIR-122
// no-second-implementation discipline the ProposalReview phase's own wiring-coverage-check dispatch
// already follows).
import { extractMechanismClaims, splitSentences } from "./wiring-coverage-check.ts";

export function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// ── capsFor — the ONE fail-closed policy surface (DIR-125 Requested-action item 3): callers may
// LOWER these values (see validateConvergenceCounters / prepare-milestone.js's `$a.maxDeltaRounds`
// clamp), never raise them. ──────────────────────────────────────────────────────────────────────
export function capsFor(highRisk) {
  const hr = highRisk === true;
  return {
    maxFullSynthesis: 1,
    maxDeltaRounds: hr ? 3 : 2,
    softBudgetMs: (hr ? 75 : 45) * 60 * 1000,
  };
}

export const DISPOSITIONS = ["plan", "split", "accepted-risk", "backlog", "duplicate", "superseded"];
export function isValidDisposition(d) {
  return DISPOSITIONS.includes(d);
}

const SEVERITIES = ["blocker", "major", "minor", "nit"];
export function normalizeSeverity(s) {
  const v = String(s ?? "").toLowerCase();
  return SEVERITIES.includes(v) ? v : "major";
}

function normalizeKey(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// ── fingerprintFinding — stable identity ANCHORED on (subsystem, claimRef) when a claimRef is
// given, else (subsystem, normalized summary). DIR-125 AC: "stable IDs across wording-only
// revisions" — a finding's prose (summary/evidence) may be reworded round to round without its id
// changing, because the id never hashes summary text once a claimRef exists.
export function fingerprintFinding({ subsystem, claimRef, summary }) {
  const identity = claimRef
    ? `${normalizeKey(subsystem)}::claim::${normalizeKey(claimRef)}`
    : `${normalizeKey(subsystem)}::summary::${normalizeKey(summary)}`;
  return sha256(identity).slice(0, 12);
}

// ── upsertFindings — merge one round's raw findings into an existing ledger. Immutable: returns a
// NEW array, never mutates `ledger`. A raw finding lacking `blocking:true` is filed as non-blocking
// with an explicit disposition (defaults to "backlog" if the caller omitted/misspelled one — never
// silently discarded, per DIR-125 item 6).
export function upsertFindings(ledger, rawFindings, round) {
  const byId = new Map((ledger || []).map((f) => [f.id, { ...f }]));
  for (const raw of rawFindings || []) {
    const blocking = raw.blocking === true;
    const id = raw.id && byId.has(raw.id) ? raw.id : fingerprintFinding(raw);
    const existing = byId.get(id);
    const disposition = blocking ? "unresolved" : (isValidDisposition(raw.disposition) ? raw.disposition : "backlog");
    byId.set(id, {
      id,
      subsystem: raw.subsystem || existing?.subsystem || "unspecified",
      summary: raw.summary || existing?.summary || "",
      severity: normalizeSeverity(raw.severity ?? existing?.severity),
      blocking,
      everBlocking: blocking || existing?.everBlocking || false,
      disposition,
      evidence: raw.evidence || existing?.evidence || "",
      claimRef: raw.claimRef || existing?.claimRef || null,
      rootCauseKey: raw.rootCauseKey || existing?.rootCauseKey || null,
      repairable: raw.repairable === true ? true : (existing?.repairable === true ? true : false),
      status: "open",
      firstSeenRound: existing?.firstSeenRound ?? round,
      lastSeenRound: round,
    });
  }
  return [...byId.values()];
}

// ── applyResolutions — a delta reviewer explicitly names which PRIOR blocking finding ids it
// verified are now fixed. Resolution flips blocking->false and status->resolved; a blocking
// finding's placeholder "unresolved" disposition becomes "backlog" (a resolved blocker is not
// automatically re-classified as anything more specific — the reviewer may still hand it an
// explicit disposition on a later round via upsertFindings). everBlocking is preserved (never
// reset) so blockingFindingYield can still count it.
export function applyResolutions(ledger, resolvedIds, round) {
  const idSet = new Set(resolvedIds || []);
  return (ledger || []).map((f) =>
    idSet.has(f.id)
      ? { ...f, status: "resolved", blocking: false, disposition: f.disposition === "unresolved" ? "backlog" : f.disposition, lastSeenRound: round }
      : f
  );
}

export function blockingOpen(ledger) {
  return (ledger || []).filter((f) => f.blocking && f.status === "open");
}

export function groupBlockingBySubsystem(ledger) {
  const out = {};
  for (const f of blockingOpen(ledger)) out[f.subsystem] = (out[f.subsystem] || 0) + 1;
  return out;
}

// ── checkSplitRecommendation — DIR-125 Requested-action item 7: recommend, never auto-perform.
// Three independent triggers: (a) >=3 independent blocking findings in one subsystem, (b) more
// than 2 independently landable mechanisms in the candidate, (c) checked touch set exceeds the
// configured small-milestone boundary (default 8 — a tunable policy default, not a repo-wide
// convention; callers may override via `smallMilestoneTouchBoundary`).
// DIR-124-A1b (2026-08-01): wbsLevel guard — when a task is already a level-2+ leaf (split depth
// >= 2) and trigger (b) fires, the real defect is UPSTREAM decomposition was too shallow, not
// that this leaf needs yet another split. Return `split-recursive-guard` instead — recommend:true
// (still must stop the current prepare cycle), repairable:false (scope fix requires redesign at
// a higher WBS level), and the orchestrator routes to needs-human rather than auto-splitting.
// ── deriveMechanismInventory — M206/M1: validates a typed mechanism inventory and derives count +
// inventoryHash mechanically (never trusts a bare integer). Fail-closed on duplicate id, dangling
// dependsOn, or duplicate proofSurface. Mirrored inline as _deriveMechanismInventory in both
// prepare-milestone.js workflow files (no-import DSL convention).
export function deriveMechanismInventory(mechanisms) {
  if (!Array.isArray(mechanisms)) {
    return { ok: false, code: "mechanism-inventory-missing", message: "reviewer returned no `mechanisms` field — typed inventory required" };
  }
  const seenIds = new Set();
  const seenSurfaces = new Set();
  const ids = new Set();
  for (const m of mechanisms) {
    if (!m || typeof m !== "object" || !m.id || !m.proofSurface) {
      return { ok: false, code: "mechanism-inventory-invalid", message: "every mechanism entry must carry at least {id, proofSurface}" };
    }
    if (seenIds.has(m.id)) {
      return { ok: false, code: "mechanism-inventory-invalid", message: `duplicate mechanism id: ${JSON.stringify(m.id)}` };
    }
    seenIds.add(m.id);
    ids.add(m.id);
    if (seenSurfaces.has(m.proofSurface)) {
      return { ok: false, code: "mechanism-inventory-invalid", message: `duplicate proofSurface: ${JSON.stringify(m.proofSurface)} — two entries cannot share one proof surface (anti-laundering)` };
    }
    seenSurfaces.add(m.proofSurface);
  }
  // Validate dependsOn edges — a referenced id may be EITHER a mechanism in this inventory OR a
  // cross-task mechanism reference (e.g. a sibling split child's mechanism id, like B2's store for
  // B3's consumer). Only a structurally-malformed dependsOn entry is rejected; an unknown-but-well-
  // formed id is treated as an external/cross-task reference and tolerated, consistent with
  // hashMechanismInventory's `idToSurface[depId] || depId` (which keeps unknown ids verbatim).
  for (const m of mechanisms) {
    if (m.dependsOn != null && !Array.isArray(m.dependsOn)) {
      return { ok: false, code: "mechanism-inventory-invalid", message: `dependsOn must be an array, got ${JSON.stringify(m.dependsOn)} for ${JSON.stringify(m.id)}` };
    }
  }
  const count = mechanisms.filter((m) => m.independentlyShippable === true).length;
  const inventoryHash = hashMechanismInventory(mechanisms);
  return { ok: true, count, inventoryHash, mechanismCount: count };
}

// ── hashMechanismInventory — canonical, rename/reorder-stable projection. Entries sorted by
// proofSurface; each reduced to {proofSurface, independentlyShippable, dependsOn} with dependsOn
// re-expressed via target entries' proofSurface values (sorted).
export function hashMechanismInventory(mechanisms) {
  const idToSurface = {};
  for (const m of mechanisms || []) idToSurface[m.id] = m.proofSurface;
  const projected = (mechanisms || []).map((m) => ({
    proofSurface: m.proofSurface,
    independentlyShippable: m.independentlyShippable === true,
    dependsOn: (m.dependsOn || []).map((depId) => idToSurface[depId] || depId).sort(),
  }));
  projected.sort((a, b) => String(a.proofSurface).localeCompare(String(b.proofSurface)));
  return sha256(JSON.stringify(projected));
}

// ── groupBlockingByRootCause — M206/M2: supersedes groupBlockingBySubsystem. Per subsystem, count
// DISTINCT rootCauseKey values (falling back to the finding's own id when rootCauseKey is absent —
// legacy behavior). Three findings sharing one rootCauseKey count as ONE cluster member toward the
// unchanged >= 3 threshold; three independently-rooted blockers still trigger it.
export function groupBlockingByRootCause(ledger) {
  const out = {};
  for (const f of blockingOpen(ledger)) {
    const key = f.rootCauseKey || f.id;
    if (!out[f.subsystem]) out[f.subsystem] = { distinctKeys: new Set(), totalFindings: 0 };
    out[f.subsystem].distinctKeys.add(key);
    out[f.subsystem].totalFindings++;
  }
  const result = {};
  for (const [subsystem, entry] of Object.entries(out)) {
    result[subsystem] = { count: entry.distinctKeys.size, totalFindings: entry.totalFindings };
  }
  return result;
}

export function checkSplitRecommendation({ ledger, mechanismCount, mechanismInventory, touchSetSize, smallMilestoneTouchBoundary = 8, wbsLevel = 0 } = {}) {
  const verdict = _rawSplitTriggers({ ledger, mechanismCount, mechanismInventory, touchSetSize, smallMilestoneTouchBoundary });
  // gap-recursive-guard-only-covers-multi-mechanism (2026-08-02): the wbsLevel guard applies to
  // EVERY split trigger, not just split-multi-mechanism. A leaf that has already survived two
  // rounds of decomposition and STILL trips any split signal has an upstream structural defect —
  // the trigger code names the symptom, it does not change the conclusion that splitting deeper
  // compounds the problem. The guard runs AFTER trigger evaluation (never before) so it fires
  // only when a split would actually have been recommended, and it preserves the originating
  // trigger's reason text as diagnostic context for the human who picks it up.
  if (verdict.recommend === true && Number.isFinite(wbsLevel) && wbsLevel >= 2) {
    return {
      recommend: true,
      code: "split-recursive-guard",
      reason: `level-${wbsLevel} leaf still triggers ${verdict.code} — upstream decomposition too shallow, needs human diagnosis before further split (original trigger: ${verdict.reason})`,
      repairable: false,
      originalCode: verdict.code,
    };
  }
  return verdict;
}

// ── _rawSplitTriggers — the three split triggers, evaluated WITHOUT the wbsLevel guard.
// Separated so `checkSplitRecommendation` can evaluate "would a split fire?" before deciding
// whether depth turns that into a recursive-guard verdict. Not exported: the guard is not
// optional at any production callsite.
function _rawSplitTriggers({ ledger, mechanismCount, mechanismInventory, touchSetSize, smallMilestoneTouchBoundary }) {
  // M206/M2: use rootCauseKey-based clustering. Each distinct rootCauseKey counts as one cluster
  // member; legacy findings without rootCauseKey each count individually (id fallback).
  const bySubsystem = groupBlockingByRootCause(ledger);
  let repairable = true;
  for (const [subsystem, { count }] of Object.entries(bySubsystem)) {
    if (count >= 3) {
      // Check if EVERY finding contributing to this cluster has repairable === true.
      const subFindings = blockingOpen(ledger).filter((f) => f.subsystem === subsystem);
      const allRepairable = subFindings.every((f) => f.repairable === true);
      repairable = allRepairable;
      // RC2 (2026-08-01, over-split root cause 2): an ALL-repairable subsystem cluster is NOT a
      // split — a single focused-revision round can close every finding (e.g. DIR-124-A4's 16
      // wiring-coverage findings in one subsystem, all repairable:true). Splitting a repairable
      // cluster fragments it into an unfinished multi-milestone split when one revision would have
      // converged. Route to the focused-revision loop instead (recommend:false with an
      // informational code); only a NON-repairable cluster (findings that cannot be resolved
      // without a charter/scope change) recommends split.
      if (allRepairable) {
        return { recommend: false, code: "repairable-cluster-revision", reason: `subsystem "${subsystem}" has ${count} ALL-repairable blocking findings — route to one focused-revision round, not a split`, repairable: true };
      }
      return { recommend: true, code: "split-subsystem-blocking-cluster", reason: `subsystem "${subsystem}" has ${count} distinct-root-cause independent blocking findings (>= 3)`, repairable: false };
    }
  }
  // M206/M1: prefer inventory-derived count over the legacy scalar mechanismCount.
  // mechanismInventory shape: {ok, count, inventoryHash} from deriveMechanismInventory.
  let effectiveCount;
  if (mechanismInventory && mechanismInventory.ok) {
    effectiveCount = mechanismInventory.count;
  } else if (Number.isFinite(mechanismCount)) {
    effectiveCount = mechanismCount;
  }
  if (Number.isFinite(effectiveCount) && effectiveCount > 2) {
    // split-multi-mechanism is NEVER repairable — scope that cannot be changed without charter edit.
    // The wbsLevel recursive guard is applied by the `checkSplitRecommendation` wrapper above,
    // uniformly across all three triggers (DIR-124-A1b was the motivating case).
    return { recommend: true, code: "split-multi-mechanism", reason: `candidate contains ${effectiveCount} independently landable mechanisms (> 2)`, repairable: false };
  }
  if (Number.isFinite(touchSetSize) && Number.isFinite(smallMilestoneTouchBoundary) && touchSetSize > smallMilestoneTouchBoundary) {
    return { recommend: true, code: "split-touch-set-too-large", reason: `checked touch set (${touchSetSize}) exceeds the small-milestone boundary (${smallMilestoneTouchBoundary})`, repairable: false };
  }
  return { recommend: false };
}

// ── planCheckNextAction — gap-plancheck-blocking-only-convergence +
// gap-plancheck-no-diminishing-returns-exit (2026-08-02). The PlanCheck analogue of `nextAction`.
//
// PlanCheck's original success condition was `findings === 0` — zero findings of ANY severity. A
// grounded reviewer can always name a non-blocking improvement (wording, a cross-reference, an
// optional extra test), so that condition is effectively unreachable and the round cap became the
// only terminator — and hitting the cap is a FAILURE terminal. Telemetry over 232 dispatches:
// 57 tasks entered round 1, 53 still ran round 3 (93%), and 45 of 57 (79%) ended in
// `plancheck-rounds-exceeded`, burning 31.6h — 43% of all prepare-milestone wall-clock.
// ProposalReview never had this defect: `nextAction` stops at zero BLOCKING findings.
//
// Two terminating conditions beyond the cap:
//   1. blocking === 0            → stop-plan-checked (the real success condition)
//   2. blocking >= priorBlocking → stop-needs-human/plancheck-diminishing-returns (round N did
//      not shrink the blocking set, so rounds N+1.. will not either)
//
// Legacy tolerance: PlanCheck's current agent schema returns a scalar `{findings: <count>}` with
// no severity split (typed findings are DIR-124-F-plancheck's scope). When `blocking` is not a
// finite number, this falls back to `findings === 0` — byte-for-behavior the pre-existing rule.
// The mechanism therefore lands NOW and gets strictly better when typed findings arrive.
export function planCheckNextAction({ round, findings, blocking, priorBlocking, maxRounds }) {
  const typed = Number.isFinite(blocking);
  const effective = typed ? blocking : findings;

  if (effective === 0) return { action: "stop-plan-checked" };

  // Diminishing returns: only meaningful once a prior round exists to compare against, and only
  // on the typed path (the scalar path has no blocking series to compare). `>=` not `>` — a round
  // that holds steady is as non-convergent as one that regresses.
  if (typed && Number.isFinite(priorBlocking) && round >= 2 && blocking >= priorBlocking) {
    return {
      action: "stop-needs-human",
      code: "plancheck-diminishing-returns",
      reason: `PlanCheck round ${round} did not reduce blocking findings (${priorBlocking} -> ${blocking}); further rounds will not converge`,
    };
  }

  if (round >= maxRounds) {
    return {
      action: "stop-needs-human",
      code: "plancheck-rounds-exceeded",
      reason: `Plan-check cap (${maxRounds}) exhausted with ${effective} ${typed ? "blocking " : ""}finding(s) still open`,
    };
  }

  return { action: "dispatch-plancheck-round" };
}

// ── budgetStatus — a deterministic, injectable-clock-friendly pure function: pass `nowMs` from
// whatever clock the caller controls (production: Date.now(); tests: a fake incrementing clock).
export function budgetStatus({ startedAtMs, nowMs, softBudgetMs }) {
  const elapsedMs = Math.max(0, (Number.isFinite(nowMs) ? nowMs : Date.now()) - startedAtMs);
  return { elapsedMs, exceeded: elapsedMs >= softBudgetMs };
}

// ── nextAction — the ONE decision function the bounded loop consults every round. Pure: never
// mutates its inputs, never dispatches anything itself.
export function nextAction({ fullSynthesisCount, deltaRound, ledger, caps, budgetExceeded, splitCheck, splitBypassAvailable }) {
  if ((fullSynthesisCount || 0) < 1) return { action: "dispatch-full-synthesis" };
  const openBlocking = blockingOpen(ledger).length;
  if (openBlocking === 0) return { action: "stop-prepared" };
  // M206/M3: repairable-cluster bypass — one focused revision + delta review before terminal split.
  if (splitCheck?.recommend && splitCheck.repairable === true && splitBypassAvailable === true && (deltaRound || 0) === 0) {
    return { action: "consume-split-bypass", reason: splitCheck.reason, code: splitCheck.code };
  }
  if (splitCheck?.recommend) return { action: "stop-split", reason: splitCheck.reason, code: splitCheck.code };
  if (budgetExceeded) return { action: "stop-needs-human", reason: "soft-budget-exceeded", code: "budget-exceeded" };
  if ((deltaRound || 0) >= caps.maxDeltaRounds) {
    return { action: "stop-needs-human", reason: `delta-review cap (${caps.maxDeltaRounds}) exhausted with ${openBlocking} blocking finding(s) still open`, code: "delta-cap-exhausted" };
  }
  return { action: "dispatch-delta-round" };
}

export function hashLedger(ledger) {
  return sha256(JSON.stringify(ledger ?? []));
}

// ── validateConvergenceCounters — the MECHANICAL, receipt-side re-check (never trusting the
// workflow's own internal counting): equivalent in strength to milestone-preparation-check.ts's
// pre-existing `plancheck-rounds-exceeded` (rounds > 3) hard rejection.
export function validateConvergenceCounters({ highRisk, fullSynthesisCount, deltaRounds }) {
  const caps = capsFor(!!highRisk);
  if ((fullSynthesisCount ?? 0) > caps.maxFullSynthesis) {
    return { ok: false, code: "convergence-full-synthesis-exceeded", message: `recorded fullSynthesisCount (${fullSynthesisCount}) exceeds the policy maximum (${caps.maxFullSynthesis}) for one generation` };
  }
  if ((deltaRounds ?? 0) > caps.maxDeltaRounds) {
    return { ok: false, code: "convergence-delta-rounds-exceeded", message: `recorded deltaRounds (${deltaRounds}) exceeds the ${highRisk ? "highRisk" : "ordinary"} policy maximum (${caps.maxDeltaRounds})` };
  }
  return { ok: true, code: "convergence-within-caps", message: "convergence counters within policy caps" };
}

// ── computeConvergenceMetrics — DIR-125 Requested-action item 10 / DoD instrumentation list.
// `proposalHashes` is an array of {round, hash} entries recorded once per full synthesis AND once
// per delta round's post-revision Proposal state.
export function computeConvergenceMetrics({ fullSynthesisCount, deltaRounds, ledger, proposalHashes, startedAtMs, endedAtMs, reachedPlanAuthor, terminalReason }) {
  const proposalReviewRounds = 1 + (deltaRounds || 0);
  const total = (ledger || []).length;
  const everBlockingCount = (ledger || []).filter((f) => f.everBlocking).length;
  const blockingFindingYield = total === 0 ? 0 : Number((everBlockingCount / total).toFixed(3));
  const distinctHashes = new Set((proposalHashes || []).map((h) => h.hash)).size;
  const attempts = Math.max(1, (fullSynthesisCount || 0) + (deltaRounds || 0));
  const proposalChurnRatio = Number((distinctHashes / attempts).toFixed(3));
  return {
    prepareWallTimeMs: Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) ? endedAtMs - startedAtMs : null,
    fullSynthesisCount: fullSynthesisCount || 0,
    proposalReviewRounds,
    blockingFindingYield,
    proposalChurnRatio,
    reachedPlanAuthor: !!reachedPlanAuthor,
    openBlockingCount: blockingOpen(ledger).length,
    terminalReason: terminalReason || null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── decideResumeGeneration — DIR-126-C/M202: generation-aware resume. Third child of DIR-126's
// 5-way split. Replaces the caller-supplied, prose-documented-only `resumeFromAdjudicatedProposal`
// boolean with a fail-closed, hash/provenance-derived three-state decision (cold/resume/
// reuse-terminal). PURE — no fs, no agent dispatch. All hash computation and record I/O are the
// CALLER's responsibility (the CLI tail below, or prepare-milestone.js's own `--decide-resume`
// dispatch), exactly like every other input this module already consumes. See
// tasks/DIR-126-C.md's own '## Proposal' > 'Chosen mechanism' for the full design and evaluation
// order this function implements verbatim as a plain series of `if`s (no try/catch — exception-
// to-cold wrapping happens at the CLI layer, the only layer capable of throwing on malformed disk
// state). ═══════════════════════════════════════════════════════════════════════════════════════

// Deliberately finer-grained than prepare-milestone.js's own coarse `phase()` labels (which today
// reuse 'Preflight' for BOTH the content and plan-shape call sites) so the two `preflight-rejected`
// terminals — which have very different real re-derivation cost — are distinguishable.
export const PHASE_RANK = {
  PreflightContent: 0,
  ProposalAuthors: 1,
  Adjudicate: 2,
  ProposalReview: 3,
  PlanAuthor: 4,
  PreflightPlan: 5,
  PlanCheck: 6,
  Receipt: 7,
};

// A plain, manually-bumped literal matching PREFLIGHT_POLICY_VERSION's own established shape —
// combined with it (via sha256) for currentReviewPolicyHash. Bump whenever this module's own
// resume/reuse decision logic changes in a way that should invalidate every prior generation
// record.
export const RESUME_POLICY_VERSION = "resume-v1";
export const MECHANISM_POLICY_VERSION = "mechanism-v1";

// Explicit allowlist of {terminalPhase, reason} PAIRS, not `reason` alone — the live workflow
// returns the IDENTICAL string 'preflight-rejected' from two genuinely different points in the
// pipeline (content, pre-Adjudicate; plan-shape, post-PlanAuthor) with very different real
// re-derivation cost. A PreflightPlan/preflight-rejected record is deliberately excluded: it
// depends on Plan-file content this mechanism's hashes never cover, and a real PlanAuthor agent
// has already run by the time it fires, so caching it under reuse-terminal would falsely claim
// savings a PreflightContent cache hit actually delivers.
export const CACHEABLE_TERMINALS = [
  { terminalPhase: "PreflightContent", reason: "preflight-rejected" },
  { terminalPhase: "ProposalReview", reason: "split-recommended" },
];

function _isCacheablePair(terminalPhase, reason) {
  return CACHEABLE_TERMINALS.some((p) => p.terminalPhase === terminalPhase && p.reason === reason);
}

// RESUMABLE_PHASES — the set of terminalPhase names ranked STRICTLY AFTER 'Adjudicate' (a strict
// `>`, not `>=`, threshold — deliberately excludes 'Adjudicate' itself). An `adjudicate-failed`
// terminal's `task_write` may never have completed, so its provenance for "what Proposal is
// currently on disk" is unverified: treating it as already-adjudicated would let `resume` skip
// re-authoring from a Proposal that was never actually written by that generation. The stricter
// threshold is the fail-closed reading and costs nothing on the common path (a real successful
// Adjudicate always advances the terminal phase past it).
export const RESUMABLE_PHASES = Object.keys(PHASE_RANK).filter((p) => PHASE_RANK[p] > PHASE_RANK.Adjudicate);

function _isResumablePhase(terminalPhase) {
  return RESUMABLE_PHASES.includes(terminalPhase);
}

// ── decideResumeGeneration — the ONE decision function the Admission phase's `--decide-resume`
// CLI mode consults, only when the caller omits `resumeFromAdjudicatedProposal` entirely (explicit
// true/false never reach here at all — see prepare-milestone.js's decision block). Evaluation
// order (verbatim from the task's own Proposal):
//   1. callerOverride === true  -> resume, caller-override-true
//   2. callerOverride === false -> cold, caller-override-false
//   (3. exceptions -> cold, decision-exception -- handled by the CLI wrapper, not here)
//   4. missing prior record -> cold, missing-prior-record
//   5. taskId mismatch -> cold, task-id-mismatch
//   6. charterHash mismatch -> cold, charter-hash-mismatch
//   7. taskContractHash mismatch -> cold, task-contract-hash-mismatch
//   8. reviewPolicyHash mismatch -> cold, review-policy-hash-mismatch
//   9. cacheable + allowlisted pair + unchanged proposalHash -> reuse-terminal
//   10. resumable phase + changed proposalHash -> resume, repaired-proposal-detected
//   11. else -> cold, no-eligible-reuse-or-resume-condition
export function decideResumeGeneration({
  priorGenerationRecord,
  currentTaskId,
  currentCharterHash,
  currentTaskContractHash,
  currentTaskProposalHash,
  currentReviewPolicyHash,
  callerOverride,
}) {
  if (callerOverride === true) {
    return { decision: "resume", reason: "caller-override-true" };
  }
  if (callerOverride === false) {
    return { decision: "cold", reason: "caller-override-false" };
  }
  const rec = priorGenerationRecord;
  if (!rec) {
    return { decision: "cold", reason: "missing-prior-record" };
  }
  if (rec.taskId !== currentTaskId) {
    return { decision: "cold", reason: "task-id-mismatch" };
  }
  if (rec.charterHash !== currentCharterHash) {
    return { decision: "cold", reason: "charter-hash-mismatch" };
  }
  if (rec.taskContractHash !== currentTaskContractHash) {
    return { decision: "cold", reason: "task-contract-hash-mismatch" };
  }
  if (rec.reviewPolicyHash !== currentReviewPolicyHash) {
    return { decision: "cold", reason: "review-policy-hash-mismatch" };
  }
  if (rec.cacheable === true && _isCacheablePair(rec.terminalPhase, rec.reason) && rec.proposalHash === currentTaskProposalHash) {
    return {
      decision: "reuse-terminal",
      reason: "unchanged-generation-terminal",
      priorGenerationId: rec.generationId,
      priorReason: rec.reason,
      priorOutcome: rec.outcome,
    };
  }
  if (_isResumablePhase(rec.terminalPhase) && rec.proposalHash !== currentTaskProposalHash) {
    return { decision: "resume", reason: "repaired-proposal-detected", priorGenerationId: rec.generationId };
  }
  return { decision: "cold", reason: "no-eligible-reuse-or-resume-condition" };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── CLI tail — `--decide-resume` / `--record-generation`, guarded by isDirectEntry (imported
// read-only from gate-script-base.ts — the SAME guard prepare-admission-check.ts's own CLI uses),
// so milestone-preparation-check.ts's existing `import { blockingOpen, validateConvergenceCounters,
// computeConvergenceMetrics } from "./proposal-convergence.ts"` stays a side-effect-free module
// load — no argv parsing, no `fs` call fires on import, only on direct invocation (WIRING-CLAIM
// R8). Hosted HERE (not on prepare-admission-check.ts) because that file is not in this task's own
// '## Touches' — see tasks/DIR-126-C.md's own Problem framing / Key design decisions for the full
// rationale (DIR-126-B's landed preflightTouchesMismatch check would mechanically flag a Plan that
// edits it). ═══════════════════════════════════════════════════════════════════════════════════

// gap-routine-semantic-dedup-scan-safe-task-id-segment: this file used to hold a PRIVATE copy of
// the sanitizer (`_safeTaskIdSegment`), byte-identical to prepare-admission-check.ts's own
// `safeTaskIdSegment` — each copy's comments claimed verbatim reuse of "the" sanitizer while a
// change to the traversal guard in one would have silently missed every path built by the other.
// The ONE definition now lives in prepare-admission-check.ts (imported above); these local helpers
// just bind it to this file's `.quay/prepare-*` subdirectories.
function _leasePath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-leases", `${safeTaskIdSegment(taskId)}.json`);
}
function _generationPath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-leases", `${safeTaskIdSegment(taskId)}.generation.json`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── Telemetry (DIR-126-D/M203) — committed, per-attempt records at
// milestones/prepare-telemetry/<taskId>/<recordId>.json. Extends (never redesigns) DIR-126-A/B/C's
// landed lease/generation-identity machinery: this archive is purely additive, read by nothing
// upstream of it — `.generation.json`'s own shape/path/write-semantics (including no-write-on-
// reuse-terminal) stay byte-for-byte untouched. schemaVersion: 2 (superset of `.generation.json`'s
// own schemaVersion: 1 — no renames, no removals). ═══════════════════════════════════════════════

const TELEMETRY_ROOT_SEGS = ["milestones", "prepare-telemetry"];
export const TELEMETRY_SCHEMA_VERSION = 2;

// telemetryPath — Claim A.0: reuses safeTaskIdSegment() VERBATIM (the single shared sanitizer
// imported from prepare-admission-check.ts — never reimplemented) for
// slash-stripping, then layers a post-hoc containment check on top, specific to this new
// PERMANENTLY GIT-COMMITTED tree (a stricter bar than .generation.json's gitignored/ephemeral
// sibling): a bare taskId of exactly ".." passes safeTaskIdSegment completely unchanged (it only
// strips '/'/'\\') and would otherwise resolve ONE LEVEL ABOVE the intended
// milestones/prepare-telemetry/ tree. Any resolved candidate landing outside that root is
// redirected to a fixed `_unsafe-taskid` bucket instead. `taskId === null` (the three pre-lease
// sites' "taskId itself is the missing field" case) routes to a fixed `_missing-taskId` segment.
export function telemetryPath(workspace, taskId, recordId) {
  const seg = taskId === null || taskId === undefined ? "_missing-taskId" : safeTaskIdSegment(taskId);
  const root = path.resolve(workspace, ...TELEMETRY_ROOT_SEGS);
  const candidate = path.join(workspace, ...TELEMETRY_ROOT_SEGS, seg, `${recordId}.json`);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate === root || resolvedCandidate.startsWith(root + path.sep)) {
    return candidate;
  }
  return path.join(workspace, ...TELEMETRY_ROOT_SEGS, "_unsafe-taskid", `${recordId}.json`);
}

// computeAttemptId — same sha256(...).slice(0,12) idiom _computeGenerationId/fingerprintFinding
// already use, for the three pre-lease sites' attempt-scoped identity (they cannot derive a real
// generationId — no lease is ever held).
export function computeAttemptId(fields) {
  return sha256(JSON.stringify(fields ?? {})).slice(0, 12);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── M207 — phase timing + finding-recurrence extensions (purely additive to the frozen
// schemaVersion:2 record). Receiver side: closes the trailing open span the sandbox dispatches
// (never a sandbox-computed timestamp — CLAIM C5), scans the task's committed archive for
// recurrence (LOCAL helper — zero new import edges onto the verified 3-file cycle, CLAIM C7),
// and degrades fail-soft on malformed/oversized flag values (CLAIM C10). ═══════════════════════

// _telemetryDir — reuses telemetryPath's own resolution VERBATIM (including the _missing-taskId
// fallback and the _unsafe-taskid containment redirect) — the task's archive directory is the
// dirname of a probe record path, never a second path-resolution implementation.
function _telemetryDir(workspace, taskId) {
  return path.dirname(telemetryPath(workspace, taskId, "__probe__"));
}

// _scanPriorTelemetryRecords — LOCAL prior-record scan (rejected Alternative #10: no
// queryTelemetryReport import, no 4th edge onto the verified 3-file import cycle). Enumerates the
// task's committed archive, JSON.parses each record, and — mirroring milestone-preparation-
// check.ts's malformed-skip precedent (:172-173) — silently skips any file that fails to parse or
// lacks a `findingCodes` array (covering EVERY pre-M207 record). Returns records sorted by
// recordedAtMs ascending so the EARLIEST matching prior record is found first. `attemptOnly`
// restricts the scan to sibling --record-attempt records (generationId: null) — the pre-lease
// sites' recurrence is keyed on attemptId, never generationId.
function _scanPriorTelemetryRecords(workspace, taskId, { attemptOnly = false } = {}) {
  const dir = _telemetryDir(workspace, taskId);
  let entries;
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return []; // no archive yet — first occurrence for this taskId
  }
  const records = [];
  for (const f of entries) {
    let rec;
    try {
      rec = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      continue; // malformed sibling — skipped individually, never aborts the scan or the write
    }
    if (!rec || typeof rec !== "object" || !Array.isArray(rec.findingCodes)) continue; // pre-M207 schema
    if (attemptOnly && rec.generationId !== null) continue;
    records.push(rec);
  }
  records.sort((a, b) => (Number.isFinite(a.recordedAtMs) ? a.recordedAtMs : 0) - (Number.isFinite(b.recordedAtMs) ? b.recordedAtMs : 0));
  return records;
}

// _computeFindingCodes — one identity quad per stable code: recurrenceKey =
// sha256(`${taskId}::${code}`).slice(0,12) — the SAME stability property fingerprintFinding/
// computeAttemptId already rely on (summaries reword round-to-round; the code must not).
// firstSeenGeneration = the earliest matching prior record's own generationId (or its attemptId
// for --record-attempt records, which carry generationId: null), or the current record's own id
// when no prior match exists (the expected first-occurrence shape); lastSeenGeneration is ALWAYS
// the current record's own id.
function _computeFindingCodes({ workspace, taskId, codes, currentRecordId, attemptOnly = false }) {
  const seen = new Set();
  const unique = [];
  for (const c of codes || []) {
    const s = String(c);
    if (s && !seen.has(s)) { seen.add(s); unique.push(s); }
  }
  if (unique.length === 0) return [];
  const prior = _scanPriorTelemetryRecords(workspace, taskId, { attemptOnly });
  return unique.map((code) => {
    const recurrenceKey = sha256(`${taskId}::${code}`).slice(0, 12);
    let firstSeenGeneration = currentRecordId;
    for (const rec of prior) {
      if ((rec.findingCodes || []).some((fc) => fc && fc.recurrenceKey === recurrenceKey)) {
        firstSeenGeneration = rec.generationId ?? rec.attemptId ?? rec.recordId ?? currentRecordId;
        break;
      }
    }
    return { code, recurrenceKey, firstSeenGeneration, lastSeenGeneration: currentRecordId };
  });
}

// Fail-soft receiver-side flag degradation (CLAIM C10): a malformed (unparseable) OR oversized
// value for EITHER new flag defaults (phaseTimings: [] / findingCodes computed from
// terminal.reason alone), never throws, and never blocks or rolls back the primary telemetry
// write — mirrors the existing telemetryWriteOk-isolation posture. The bound is 64KiB — ample for
// any real payload (a whole generation's phase timings + finding codes is low single-digit KiB)
// AND below the kernel's per-argument execve ceiling (~128KiB on Linux), so an oversized value
// can still reach the CLI through a real argv and exercise this guard end-to-end.
const _MAX_TELEMETRY_FLAG_BYTES = 64 * 1024;
function _parsePhaseTimingsFlag(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > _MAX_TELEMETRY_FLAG_BYTES) return [];
  let v;
  try { v = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && typeof s === "object" && !Array.isArray(s))
    .map((s) => ({
      phase: typeof s.phase === "string" ? s.phase : null,
      round: Number.isFinite(s.round) ? s.round : null,
      startedAtMs: Number.isFinite(s.startedAtMs) ? s.startedAtMs : null,
      endedAtMs: Number.isFinite(s.endedAtMs) ? s.endedAtMs : null,
    }));
}
// Returns a string[] of codes, or null — null means "flag absent/malformed/oversized: compute
// from terminal.reason alone" (the documented default), distinct from a WELL-FORMED empty array.
function _parseFindingCodesFlag(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > _MAX_TELEMETRY_FLAG_BYTES) return null;
  let v;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(v)) return null;
  return v.filter((c) => typeof c === "string" && c.length > 0);
}
// Close any still-open span with the receiver's OWN recordedAtMs — the trailing entry the sandbox
// dispatches with endedAtMs:null (CLAIM C5: never a sandbox-computed timestamp).
function _closePhaseTimings(spans, recordedAtMs) {
  return spans.map((s) => (s.endedAtMs === null ? { ...s, endedAtMs: recordedAtMs } : s));
}

// buildTelemetryRecord — the frozen schemaVersion:2 record shape (task's own "Frozen record
// schema"). Fills every field explicitly, even when the caller omits it — an omitted-but-required
// field becomes an explicit `null`, never a dropped key (no-fabrication discipline: JSON.stringify
// never silently skips a present-but-undefined key here because every key below is materialized).
export function buildTelemetryRecord({
  recordId, attemptId, generationId,
  admission, workspace, taskId, milestoneId,
  class: klass, highRisk,
  hashes, decision,
  contentAgentDispatchCount, contentAgentMs,
  terminal, leaseRelease,
  sessionId, recordedAtMs, telemetryWriteOk,
  // M207: two additive array fields — always materialized (`[]` when empty, never a dropped key,
  // matching the always-materialized `?? null` discipline above). schemaVersion stays 2 — additive
  // in-family growth (TELEMETRY_SCHEMA_VERSION's :356-357 precedent reserves bumps for new record
  // FAMILIES; nothing re-validates history, so no forward-compat hazard forces a bump).
  phaseTimings, findingCodes,
} = {}) {
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    recordId: recordId ?? null,
    attemptId: attemptId ?? null,
    generationId: generationId ?? null,
    admission: admission ?? null,
    workspace: workspace ?? null,
    taskId: taskId ?? null,
    milestoneId: milestoneId ?? null,
    class: klass ?? null,
    highRisk: highRisk === undefined ? null : highRisk,
    hashes: hashes ?? null,
    decision: decision ?? null,
    contentAgentDispatchCount: contentAgentDispatchCount === undefined ? null : contentAgentDispatchCount,
    contentAgentMs: contentAgentMs === undefined ? null : contentAgentMs,
    terminal: terminal ?? null,
    leaseRelease: leaseRelease ?? null,
    sessionId: sessionId ?? null,
    recordedAtMs: recordedAtMs ?? null,
    telemetryWriteOk: telemetryWriteOk === undefined ? true : telemetryWriteOk,
    phaseTimings: phaseTimings ?? [],
    findingCodes: findingCodes ?? [],
  };
}

const TELEMETRY_DECISION_KINDS = ["cold", "resume", "reuse-terminal", "not-evaluated"];

// validateTelemetryRecord — pure fail-closed validator. AC16's rule lives here: a `reuse-terminal`
// record MUST have a non-null generationId, a non-null decision.priorGenerationId, all four
// hashes.* non-null, and contentAgentDispatchCount===0 && contentAgentMs===0 — any violation is
// `{ok:false, code:"reuse-terminal-invalid"}`.
export function validateTelemetryRecord(record, { requireAdditiveFields = true } = {}) {
  if (!record || typeof record !== "object") {
    return { ok: false, code: "telemetry-record-malformed", message: "telemetry record is not an object" };
  }
  if (record.schemaVersion !== TELEMETRY_SCHEMA_VERSION) {
    return { ok: false, code: "telemetry-schema-version-mismatch", message: `expected schemaVersion ${TELEMETRY_SCHEMA_VERSION}, got ${record.schemaVersion}` };
  }
  const REQUIRED_TOP = [
    "recordId", "attemptId", "generationId", "admission", "workspace", "taskId", "milestoneId",
    "class", "highRisk", "hashes", "decision", "contentAgentDispatchCount", "contentAgentMs",
    "terminal", "leaseRelease", "sessionId", "recordedAtMs", "telemetryWriteOk",
  ];
  // M207: the two additive keys. They are required at WRITE time (buildTelemetryRecord
  // materializes them unconditionally, and the reuse-terminal branch below enforces their presence
  // on the records it validates), but they are NOT required at READ/aggregation time: pre-M207
  // committed records legitimately predate them and must stay valid/aggregatable. The original M207
  // revision put them unconditionally in REQUIRED_TOP on the (false) assumption that this validator's
  // only live call site was the reuse-terminal branch — but `computeCapacityReport`
  // (milestone-preparation-check.ts) ALSO validates every disk-read record, which would have excluded
  // every pre-M207 record as telemetry-field-missing, violating the "no shape becomes stricter /
  // existing consumers unaffected" charter clause (caught by M207's own adversarial audit via an A/B
  // run). Hence `requireAdditiveFields`: write-time callers use the default (strict); the capacity
  // report's read-time aggregation passes { requireAdditiveFields: false }.
  if (requireAdditiveFields) {
    REQUIRED_TOP.push("phaseTimings", "findingCodes");
  }
  for (const k of REQUIRED_TOP) {
    if (!(k in record)) {
      return { ok: false, code: "telemetry-field-missing", message: `telemetry record is missing required field '${k}' (must be present — null/"unknown" is fine, omission is not)` };
    }
  }
  const kind = record.decision?.kind;
  if (!TELEMETRY_DECISION_KINDS.includes(kind)) {
    return { ok: false, code: "telemetry-decision-kind-invalid", message: `decision.kind must be one of ${TELEMETRY_DECISION_KINDS.join("|")}, got ${JSON.stringify(kind)}` };
  }
  if (kind === "reuse-terminal") {
    if (!record.generationId) {
      return { ok: false, code: "reuse-terminal-invalid", message: "reuse-terminal record must have a non-null generationId" };
    }
    if (!record.decision?.priorGenerationId) {
      return { ok: false, code: "reuse-terminal-invalid", message: "reuse-terminal record must have a non-null decision.priorGenerationId" };
    }
    const h = record.hashes;
    if (!h || !h.charter || !h.taskContract || !h.proposal || !h.reviewPolicy) {
      return { ok: false, code: "reuse-terminal-invalid", message: "reuse-terminal record must have all four hashes.* fields non-null" };
    }
    if (!(record.contentAgentDispatchCount === 0 && record.contentAgentMs === 0)) {
      return { ok: false, code: "reuse-terminal-invalid", message: "reuse-terminal record must have contentAgentDispatchCount === 0 && contentAgentMs === 0" };
    }
  }
  return { ok: true, code: "telemetry-record-ok", message: "telemetry record is well-formed" };
}

function _writeTelemetryRecord(workspace, taskId, recordId, record) {
  const p = telemetryPath(workspace, taskId, recordId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(record, null, 2));
  return p;
}

// Same sha256(identity).slice(0, 12) idiom fingerprintFinding already uses above — not a new ID
// convention.
function _computeGenerationId({ taskId, ownerExecutionId, fencingToken, acquiredAt }) {
  return sha256(`${taskId}::${ownerExecutionId}::${fencingToken}::${acquiredAt}`).slice(0, 12);
}

function _currentReviewPolicyHash() {
  return sha256(`${PREFLIGHT_POLICY_VERSION}::${RESUME_POLICY_VERSION}::${MECHANISM_POLICY_VERSION}`);
}

// Reads tasks/<taskId>.md and the charter file fresh off disk, extracts '## Acceptance Criteria' /
// '## Definition of Done' / '## Touches' (via extractSection, imported read-only from
// task-schema.ts — reused, never reimplemented) for currentTaskContractHash and '## Proposal' for
// currentTaskProposalHash.
function _readCurrentHashes({ workspace, taskId, charterFile }) {
  const taskPath = path.join(workspace, "tasks", `${taskId}.md`);
  const taskBody = fs.readFileSync(taskPath, "utf8");
  const charterBody = fs.readFileSync(path.resolve(workspace, charterFile), "utf8");
  const ac = extractSection(taskBody, "Acceptance Criteria") || "";
  const dod = extractSection(taskBody, "Definition of Done") || "";
  const touches = extractSection(taskBody, "Touches") || "";
  const proposal = extractSection(taskBody, "Proposal") || "";
  return {
    charterHash: sha256(charterBody),
    taskContractHash: sha256(`${ac}\n${dod}\n${touches}`),
    proposalHash: sha256(proposal),
    reviewPolicyHash: _currentReviewPolicyHash(),
  };
}

// --decide-resume: reads the just-acquired admission lease, derives generationId, reads the
// current task/charter fresh, reads the prior record (or null), calls the pure
// decideResumeGeneration, and — IFF the decision is reuse-terminal — ALSO releases the lease
// INSIDE this same invocation before returning (the R3 race-window fix: decision and release are
// one atomic CLI call, no window in which a second dispatch could observe
// prepare-already-running for a task about to vanish).
export function _decideResumeCli({ taskId, workspace, charterFile, callerOverride }) {
  try {
    // gap-prepare-milestone-lease-read-race (M203/DIR-126-D): _readLeaseFileWithRetry (imported
    // from prepare-admission-check.ts, the single owner of this bounded-retry primitive — never
    // reimplemented here) absorbs the exact ENOENT observed twice on real dispatches (Occurrence 1,
    // `wf_49d73fc5-782`) where this call fired moments after Admission's own reported-successful
    // lease write. A genuinely missing lease still surfaces as ENOENT after the bounded retry,
    // falling through to this function's own catch-all below (`decision-exception`) exactly as
    // before.
    const leaseRaw = _readLeaseFileWithRetry(_leasePath(workspace, taskId));
    const lease = JSON.parse(leaseRaw);
    const generationId = _computeGenerationId({
      taskId, ownerExecutionId: lease.ownerExecutionId, fencingToken: lease.fencingToken, acquiredAt: lease.acquiredAt,
    });
    const hashes = _readCurrentHashes({ workspace, taskId, charterFile });
    let priorGenerationRecord = null;
    const genPath = _generationPath(workspace, taskId);
    if (fs.existsSync(genPath)) {
      priorGenerationRecord = JSON.parse(fs.readFileSync(genPath, "utf8"));
    }
    const normalizedOverride = callerOverride === "true" || callerOverride === true
      ? true
      : callerOverride === "false" || callerOverride === false
        ? false
        : undefined;
    const decision = decideResumeGeneration({
      priorGenerationRecord,
      currentTaskId: taskId,
      currentCharterHash: hashes.charterHash,
      currentTaskContractHash: hashes.taskContractHash,
      currentTaskProposalHash: hashes.proposalHash,
      currentReviewPolicyHash: hashes.reviewPolicyHash,
      callerOverride: normalizedOverride,
    });
    let releaseResult;
    if (decision.decision === "reuse-terminal") {
      // A failure INSIDE the embedded release (e.g. the lease directory becomes unwritable) must
      // surface as a typed releaseResult.ok===false — never collapse the whole decision to
      // 'cold'/decision-exception, which would hide a real reuse-terminal-release-failed case
      // behind an indistinguishable generic failure code.
      try {
        releaseResult = releaseLease({ workspace, taskId, method: "normal", reason: "reuse-terminal", now: Date.now() });
      } catch (err) {
        releaseResult = { ok: false, error: err.message };
      }

      // DIR-126-D/M203 Claim A.2 — reuse-terminal's own isolated committed-telemetry write, in the
      // SAME call that already computes generationId and releases the lease inline. Runs in its
      // OWN try/catch, separate from BOTH the inline release try/catch above AND this function's
      // outer catch-all below (AC15): a write throw here must never surface as the outer
      // catch-all's swallowed-exception `{decision:'cold', reason:'decision-exception'}` shape,
      // which lacks `releaseResult` entirely and would bypass prepare-milestone.js's
      // stranded-lease guard. Validated BEFORE writing (AC16): a record that fails
      // validateTelemetryRecord is never written as reuse-terminal telemetry — the call instead
      // falls back to `decision:'cold'`/`reuse-terminal-schema-invalid'`, never a false
      // reuse-terminal pass. Does NOT touch `.generation.json` — DIR-126-C deliberately leaves it
      // unwritten on this branch, unchanged by this addition.
      let telemetryWriteOk = true;
      let schemaInvalid = false;
      try {
        // M207: a cache hit ran no phases — `phaseTimings: []`; `findingCodes` is computed from
        // the reused terminal's own reason alone (the workflow threads no flags on this dispatch),
        // recurrence computed identically via the local scan.
        const recordedAtMs = Date.now();
        const reuseCodes = _computeFindingCodes({
          workspace, taskId,
          codes: decision.priorReason ? [decision.priorReason] : [],
          currentRecordId: generationId,
        });
        const telRecord = buildTelemetryRecord({
          recordId: generationId,
          attemptId: generationId,
          generationId,
          admission: { key: lease.key ?? null, ownerExecutionId: lease.ownerExecutionId ?? null, fencingToken: lease.fencingToken ?? null, acquiredAt: lease.acquiredAt ?? null },
          workspace, taskId, milestoneId: null, class: null, highRisk: null,
          hashes: { charter: hashes.charterHash, taskContract: hashes.taskContractHash, proposal: hashes.proposalHash, reviewPolicy: hashes.reviewPolicyHash },
          decision: {
            kind: "reuse-terminal", reason: decision.reason,
            priorGenerationId: decision.priorGenerationId ?? null, priorReason: decision.priorReason ?? null,
            createsContentGeneration: false,
          },
          contentAgentDispatchCount: 0, contentAgentMs: 0,
          terminal: { outcome: decision.priorOutcome ?? null, reason: decision.priorReason ?? null, phase: null, cacheable: true },
          leaseRelease: releaseResult ? { attempted: true, ok: releaseResult.ok, reason: releaseResult.reason ?? null } : { attempted: false, ok: null, reason: null },
          sessionId: null, recordedAtMs,
          phaseTimings: [], findingCodes: reuseCodes,
        });
        const validation = validateTelemetryRecord(telRecord);
        if (!validation.ok) {
          schemaInvalid = true;
        } else {
          _writeTelemetryRecord(workspace, taskId, generationId, telRecord);
        }
      } catch {
        telemetryWriteOk = false;
      }
      if (schemaInvalid) {
        return { decision: "cold", reason: "reuse-terminal-schema-invalid", hashes, generationId, ...(releaseResult ? { releaseResult } : {}) };
      }
      return { ...decision, hashes, generationId, telemetryWriteOk, ...(releaseResult ? { releaseResult } : {}) };
    }
    return { ...decision, hashes, generationId, ...(releaseResult ? { releaseResult } : {}) };
  } catch (err) {
    // Evaluation-order step 3 (fail-closed on any exception — malformed disk state, missing lease,
    // missing task/charter file, unparseable prior record): the CLI wrapper is the one thing
    // capable of throwing; decideResumeGeneration itself stays a plain series of `if`s.
    return { decision: "cold", reason: "decision-exception", detail: err.message };
  }
}

// --record-generation: re-reads the task/charter FRESH (the Proposal may have been revised
// multiple times since --decide-resume ran, e.g. across ProposalReview delta rounds, so the
// record must reflect content AS OF THE ACTUAL TERMINAL, never a stale hash captured at entry),
// re-derives generationId the SAME way from the still-held lease, writes/overwrites
// .quay/prepare-leases/<taskId>.generation.json, and piggybacks releaseLease in the SAME
// invocation (replacing the bare `--release` call prepare-milestone.js makes today — per-terminal
// dispatch count unchanged).
// Shared by _recordGenerationCli and _writeGenerationTelemetryCli — derives generationId/hashes
// from the still-held lease and writes/overwrites .quay/prepare-leases/<taskId>.generation.json
// (DIR-126-C's byte-for-byte-untouched v1 shape). Deliberately does NOT touch the new committed
// telemetry file — callers add that write themselves, at whatever point in their own sequence
// (before or after release) their own Claim requires, isolated in their OWN try/catch.
function _writeLegacyGenerationRecord({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable }) {
  // gap-prepare-milestone-lease-read-race (M203/DIR-126-D): same bounded-retry rationale as
  // _decideResumeCli above — this is the read behind Occurrence 1/2's "terminal telemetry-write
  // dispatch ALSO failed with the same ENOENT" (both _recordGenerationCli/_writeGenerationTelemetryCli
  // route through here). Occurrence 2's separate `{ok:false, error:'lease-missing'}` errors during
  // ProposalReview delta-round lease-renewal calls go through renewLease()'s own _readLease() in
  // prepare-admission-check.ts, already covered there.
  const leaseRaw = _readLeaseFileWithRetry(_leasePath(workspace, taskId));
  const lease = JSON.parse(leaseRaw);
  const generationId = _computeGenerationId({
    taskId, ownerExecutionId: lease.ownerExecutionId, fencingToken: lease.fencingToken, acquiredAt: lease.acquiredAt,
  });
  const hashes = _readCurrentHashes({ workspace, taskId, charterFile });
  const record = {
    schemaVersion: 1,
    taskId,
    generationId,
    charterHash: hashes.charterHash,
    taskContractHash: hashes.taskContractHash,
    proposalHash: hashes.proposalHash,
    reviewPolicyHash: hashes.reviewPolicyHash,
    terminalPhase,
    outcome,
    reason,
    cacheable: cacheable === "true" || cacheable === true,
    recordedAtMs: Date.now(),
  };
  fs.mkdirSync(path.dirname(_generationPath(workspace, taskId)), { recursive: true });
  fs.writeFileSync(_generationPath(workspace, taskId), JSON.stringify(record, null, 2));
  return { lease, generationId, hashes, record };
}

// Shared committed-telemetry-write body for Claims A.1/A.4 — its OWN try/catch, isolated from
// whatever release logic the caller performs around it, so a write throw here can never prevent or
// retroactively invalidate a release that already happened (or is about to happen).
// `decisionKind` ('cold'|'resume') threads through the workflow's OWN
// `_resumeFromAdjudicatedProposal`/`--decide-resume` verdict for THIS generation — per the frozen
// schema, `decision.kind` is `cold|resume|reuse-terminal` for admitted attempts (never the
// `not-evaluated` value reserved for the three pre-lease `--record-attempt` sites); defaults to
// `cold` when the caller omits it (the safe, conservative default — every real call site now
// threads this explicitly, see prepare-milestone.js's `_releaseLeaseAndRecord`/
// `_writeGenerationTelemetry`).
function _writeCommittedTelemetry({ taskId, workspace, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId, lease, hashes, generationId, releaseResult, decisionKind, phaseTimings: phaseTimingsRaw, findingCodes: findingCodesRaw }) {
  let telemetryWriteOk = true;
  let telemetryFile = null;
  try {
    const kind = decisionKind === "resume" ? "resume" : "cold";
    // M207: close the trailing open span with THIS writer's own recordedAtMs (CLAIM C5 — never a
    // sandbox value), compute the recurrence quad per code (local archive scan, CLAIM C7), and
    // degrade fail-soft on malformed/oversized flag values (CLAIM C10 — defaults, never throw,
    // never block the primary write).
    const recordedAtMs = Date.now();
    const spans = _closePhaseTimings(_parsePhaseTimingsFlag(phaseTimingsRaw), recordedAtMs);
    const parsedCodes = _parseFindingCodesFlag(findingCodesRaw);
    const findingCodes = _computeFindingCodes({
      workspace, taskId,
      codes: parsedCodes ?? (reason ? [reason] : []),
      currentRecordId: generationId,
    });
    const telRecord = buildTelemetryRecord({
      recordId: generationId, attemptId: generationId, generationId,
      admission: { key: lease.key ?? null, ownerExecutionId: lease.ownerExecutionId ?? null, fencingToken: lease.fencingToken ?? null, acquiredAt: lease.acquiredAt ?? null },
      workspace, taskId, milestoneId: milestoneId ?? null, class: klass ?? null,
      highRisk: highRisk === "true" || highRisk === true,
      hashes: { charter: hashes.charterHash, taskContract: hashes.taskContractHash, proposal: hashes.proposalHash, reviewPolicy: hashes.reviewPolicyHash },
      decision: { kind, reason: null, priorGenerationId: null, priorReason: null, createsContentGeneration: kind === "resume" },
      contentAgentDispatchCount: null, contentAgentMs: null,
      terminal: { outcome, reason, phase: terminalPhase, cacheable: cacheable === "true" || cacheable === true },
      leaseRelease: releaseResult ? { attempted: true, ok: releaseResult.ok, reason: releaseResult.reason ?? null } : { attempted: false, ok: null, reason: null },
      sessionId: sessionId ?? null, recordedAtMs,
      phaseTimings: spans, findingCodes,
    });
    telemetryFile = _writeTelemetryRecord(workspace, taskId, generationId, telRecord);
  } catch {
    telemetryWriteOk = false;
  }
  return { telemetryWriteOk, telemetryFile };
}

// DIR-126-D/M203 Claim A.1 — extends the existing 13-pre-Receipt-site write with a SEPARATE
// committed-telemetry write, ordered AFTER releaseLease(...) succeeds — UNCHANGED from before this
// child for the .generation.json write + release themselves (same order, same shared try block, so
// a .generation.json write failure still yields the pre-existing {ok:false} no-release-guarantee
// behavior byte-for-byte). The NEW telemetry write's own try/catch runs only once release has
// already been attempted, and is never the block releaseLease(...) runs inside, so a write throw
// there can never prevent or retroactively invalidate a release that already happened (AC13); it
// is surfaced via the returned `telemetryWriteOk` field, distinct from `ok` (which continues to
// reflect only whether this call completed without throwing — AC14).
export function _recordGenerationCli({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId, decisionKind, phaseTimings, findingCodes }) {
  try {
    const { lease, generationId, hashes, record } = _writeLegacyGenerationRecord({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable });
    const releaseResult = releaseLease({ workspace, taskId, method: "normal", reason: reason || null, now: Date.now() });
    const { telemetryWriteOk, telemetryFile } = _writeCommittedTelemetry({
      taskId, workspace, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId,
      lease, hashes, generationId, releaseResult, decisionKind, phaseTimings, findingCodes,
    });
    return { ok: true, record, releaseResult, telemetryWriteOk, telemetryFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// DIR-126-D/M203 Claim A.4 — Receipt-phase split, write half: extends --record-generation with a
// --no-release variant that writes .generation.json AND the new committed telemetry file but does
// NOT call releaseLease at all — backs prepare-milestone.js's restructured Receipt sequence (write
// first, then --build, then release), so a silent write failure is visible BEFORE the receipt-build
// agent call ever runs, never absorbed into a false 'prepared' certification.
export function _writeGenerationTelemetryCli({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId, decisionKind, phaseTimings, findingCodes }) {
  try {
    const { lease, generationId, hashes, record } = _writeLegacyGenerationRecord({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable });
    const { telemetryWriteOk, telemetryFile } = _writeCommittedTelemetry({
      taskId, workspace, terminalPhase, outcome, reason, cacheable, milestoneId, class: klass, highRisk, sessionId,
      lease, hashes, generationId, releaseResult: null, decisionKind, phaseTimings, findingCodes,
    });
    return { ok: true, record, generationId, telemetryWriteOk, telemetryFile };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// DIR-126-D/M203 Claim A.4 — Receipt-phase split, release half: release ONLY, no write — a thin
// wrapper around the already-imported releaseLease, backing the restructured Receipt sequence's
// final step (and its telemetry-write-failure early-exit step).
export function _releaseLeaseOnlyCli({ taskId, workspace, reason }) {
  try {
    const releaseResult = releaseLease({ workspace, taskId, method: "normal", reason: reason || null, now: Date.now() });
    return { ok: true, releaseResult };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// DIR-126-D/M203 Claim A.3 — --record-attempt: the 3 pre-lease exit sites (missing-required-args,
// admission-check-failed, prepare-already-running) hold no Admission lease and cannot derive a
// real generationId (the contention/pre-lease `owner` shape structurally lacks `fencingToken` —
// point 6 of the task's own Problem framing), so this submode writes ONLY the new committed
// telemetry file (never touches .quay/prepare-leases/ at all), keyed by an attempt-scoped
// `computeAttemptId` hash of the fields the caller's own verdict already exposes.
// `taskId === null` (the missing-required-args case where taskId itself is the missing field)
// routes to telemetryPath's fixed `_missing-taskId` segment.
export function _recordAttemptCli({ taskId, workspace, site, detail, phaseTimings: phaseTimingsRaw, findingCodes: findingCodesRaw }) {
  const effectiveTaskId = taskId ? taskId : null;
  let detailObj = {};
  if (detail) {
    try { detailObj = JSON.parse(detail); } catch { detailObj = { raw: detail }; }
  }
  const attemptId = computeAttemptId({ site, taskId: effectiveTaskId, detail: detailObj });
  const phase = site === "missing-required-args" ? "ProposalAuthors" : "Admission";
  // M207: `phaseTimings` is [] by construction at the 3 pre-lease sites (no completed spans);
  // `findingCodes` defaults to [site] when the flag is absent/malformed, and recurrence is keyed
  // on attemptId — scanning ONLY sibling attempt records (generationId: null).
  const recordedAtMs = Date.now();
  const spans = _closePhaseTimings(_parsePhaseTimingsFlag(phaseTimingsRaw), recordedAtMs);
  const parsedCodes = _parseFindingCodesFlag(findingCodesRaw);
  const findingCodes = _computeFindingCodes({
    workspace, taskId: effectiveTaskId,
    codes: parsedCodes ?? [site],
    currentRecordId: attemptId,
    attemptOnly: true,
  });
  const record = buildTelemetryRecord({
    recordId: attemptId, attemptId, generationId: null,
    admission: null, workspace, taskId: effectiveTaskId, milestoneId: null, class: null, highRisk: null,
    hashes: null,
    decision: { kind: "not-evaluated", reason: null, priorGenerationId: null, priorReason: null, createsContentGeneration: false },
    contentAgentDispatchCount: 0, contentAgentMs: 0,
    terminal: { outcome: "needs-human", reason: site, phase, cacheable: false },
    leaseRelease: { attempted: false, ok: null, reason: null },
    sessionId: null, recordedAtMs,
    phaseTimings: spans, findingCodes,
  });
  let telemetryWriteOk = true;
  let telemetryFile = null;
  try {
    telemetryFile = _writeTelemetryRecord(workspace, effectiveTaskId, attemptId, record);
  } catch {
    telemetryWriteOk = false;
  }
  return { ok: true, attemptId, record, telemetryWriteOk, telemetryFile };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── M206/M4: Scope hash — deliberately prose-insensitive. Sensitive to AC checkbox count + Touches
// path set, insensitive to sentence-level rewording. DoD box count is EXCLUDED — adding an
// audit-obligation checkbox is not a scope change. Uses canonicalJSON key ordering.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function _canonicalJSON(obj) {
  if (Array.isArray(obj)) return JSON.stringify(obj.map(_canonicalJSON));
  if (obj !== null && typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const out = {};
    for (const k of keys) out[k] = obj[k];
    return JSON.stringify(out);
  }
  return JSON.stringify(obj);
}

export function scopeHash({ taskBody, declaredTouches }) {
  const acSection = extractSection(taskBody, "Acceptance Criteria") || "";
  const { total: acBoxCount } = countBoxes(acSection);
  const touchesSorted = [...(declaredTouches || [])].sort();
  return sha256(_canonicalJSON({ acBoxCount, touchesSorted }));
}

// ── splitScopeHash — gap-split-decision-finality-not-enforced (2026-08-02).
// A SPLIT ruling is about STRUCTURE — how many independently landable mechanisms the surface
// contains — not about the exact AC count. Binding a SPLIT record to `scopeHash` (which includes
// acBoxCount) means the natural response to a split recommendation (adding AC checkboxes) erases
// the ruling, and the next dispatch re-runs the whole pipeline to re-derive the same verdict.
// Telemetry showed 15 such redundant dispatches (~3.5h wasted): DIR-126-E alone was told to split
// 5 times. `splitScopeHash` hashes the SURFACE only, so an AC edit preserves the ruling while a
// genuine Touches change correctly invalidates it.
// COMMIT records deliberately keep `scopeHash`: a COMMIT ruling IS about the specific reviewed
// content, so an AC edit SHOULD invalidate it.
export function splitScopeHash({ declaredTouches }) {
  const touchesSorted = [...(declaredTouches || [])].sort();
  return sha256(_canonicalJSON({ touchesSorted }));
}

// ── _decisionRecordPath — committed decision record under milestones/prepare-decisions/. ──────
function _decisionRecordPath(workspace, taskId) {
  const seg = safeTaskIdSegment(taskId);
  return path.join(workspace, "milestones", "prepare-decisions", `${seg}.json`);
}

// ── decideSplitAdjudication — M206/M4: pure read-only evaluator for hash-bound COMMIT/SPLIT
// decision records. Four verdicts: no-decision-on-file, skip-split-adjudication (COMMIT match),
// decision-invalidated (COMMIT mismatch), content-dispatch-blocked (SPLIT match).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function decideSplitAdjudication(record, { charterHash, scopeHash: currentScopeHash, reviewPolicyHash, splitScopeHash: currentSplitScopeHash }) {
  if (!record || typeof record !== "object" || !record.decision) {
    return { verdict: "no-decision-on-file" };
  }
  const match = record.charterHash === charterHash && record.scopeHash === currentScopeHash && record.reviewPolicyHash === reviewPolicyHash;
  if (record.decision === "commit") {
    if (match) {
      return { verdict: "skip-split-adjudication", splitCheckDisabled: true, record };
    } else {
      // Append invalidation entry to record.
      const mismatchedFields = [];
      if (record.charterHash !== charterHash) mismatchedFields.push("charterHash");
      if (record.scopeHash !== currentScopeHash) mismatchedFields.push("scopeHash");
      if (record.reviewPolicyHash !== reviewPolicyHash) mismatchedFields.push("reviewPolicyHash");
      // Clone without invalidations to avoid circular reference: record.invalidations[n].priorValue
      // would point back to record itself (which now contains the invalidation that references it).
      const { invalidations: _, ...recordWithoutCycles } = record;
      const invalidation = { atMs: Date.now(), generationId: null, mismatchedFields, priorValue: recordWithoutCycles, currentValue: { charterHash, scopeHash: currentScopeHash, reviewPolicyHash } };
      record.invalidations = [...(record.invalidations || []), invalidation];
      return { verdict: "decision-invalidated", mismatchedFields, record };
    }
  }
  if (record.decision === "split") {
    // gap-split-decision-finality-not-enforced (2026-08-02): a SPLIT ruling binds to the SURFACE
    // (charter + touches), not to the AC count. Adding AC checkboxes — the natural response to a
    // split recommendation — must not erase the ruling and trigger a redundant re-derivation.
    // Records written before this change carry no `splitScopeHash`; they fall back to the legacy
    // full `match` (conservative — no behavior change for existing records).
    const splitMatch = record.splitScopeHash != null && currentSplitScopeHash != null
      ? record.charterHash === charterHash && record.splitScopeHash === currentSplitScopeHash && record.reviewPolicyHash === reviewPolicyHash
      : match;
    if (splitMatch) {
      return { verdict: "content-dispatch-blocked", outcome: "needs-human", reason: "split-decision-blocks-dispatch", phase: "Admission", record };
    }
    // SPLIT record whose SURFACE changed — the ruling no longer applies; proceed.
    return { verdict: "decision-invalidated", record };
  }
  return { verdict: "no-decision-on-file" };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── M206/M5: mechanism-history.json — gitignored bounded ring (last 5 entries). SEPARATE file
// from .generation.json (wholesale-overwrite contract preserved). Round-0 only appends.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
const MAX_MECHANISM_HISTORY_ENTRIES = 5;

function _mechanismHistoryPath(workspace, taskId) {
  const seg = safeTaskIdSegment(taskId);
  return path.join(workspace, ".quay", "prepare-leases", `${seg}.mechanism-history.json`);
}

export function appendMechanismHistory(workspace, taskId, entry) {
  const p = _mechanismHistoryPath(workspace, taskId);
  let history = [];
  if (fs.existsSync(p)) {
    try { history = JSON.parse(fs.readFileSync(p, "utf8")); } catch { history = []; }
  }
  if (!Array.isArray(history)) history = [];
  history.push({ ...entry, atMs: Date.now() });
  // Keep only last N entries.
  if (history.length > MAX_MECHANISM_HISTORY_ENTRIES) history = history.slice(-MAX_MECHANISM_HISTORY_ENTRIES);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(history, null, 2));
  return { ok: true, entryCount: history.length };
}

export function checkMechanismStability(workspace, taskId, { charterHash, scopeHash: currentScopeHash, reviewPolicyHash, currentInventoryHash }) {
  const p = _mechanismHistoryPath(workspace, taskId);
  if (!fs.existsSync(p)) {
    return { stable: true, priorEntry: null, code: "no-prior-history" };
  }
  let history;
  try { history = JSON.parse(fs.readFileSync(p, "utf8")); } catch { return { stable: true, priorEntry: null, code: "history-unparseable" }; }
  if (!Array.isArray(history) || history.length === 0) {
    return { stable: true, priorEntry: null, code: "no-prior-history" };
  }
  // Find the immediately-preceding entry sharing the same scope key.
  const key = `${charterHash}::${currentScopeHash}::${reviewPolicyHash}`;
  let prior = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e && e.charterHash === charterHash && e.scopeHash === currentScopeHash && e.reviewPolicyHash === reviewPolicyHash) {
      prior = e;
      break;
    }
  }
  if (!prior) {
    return { stable: true, priorEntry: null, code: "no-prior-same-scope-entry" };
  }
  if (prior.mechanismInventoryHash === currentInventoryHash) {
    return { stable: true, priorEntry: prior, code: "mechanism-inventory-stable" };
  }
  return { stable: false, priorEntry: prior, code: "split-assessment-unstable", reason: "consecutive reviews produced incompatible mechanism inventories at unchanged scope" };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── --record-split-decision: human-invoked ONLY. Writes milestones/prepare-decisions/<taskId>.json.
// Never infers --decision or --reason — both are required CLI flags.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function _recordSplitDecisionCli({ taskId, workspace, charterFile, decision, reason, sessionId }) {
  if (!decision || !["commit", "split"].includes(decision)) {
    return { ok: false, error: `--decision must be "commit" or "split", got ${JSON.stringify(decision)}` };
  }
  if (!reason) {
    return { ok: false, error: "--reason is required for --record-split-decision" };
  }
  try {
    const taskPath = path.join(workspace, "tasks", `${taskId}.md`);
    let taskBody;
    try {
      taskBody = fs.readFileSync(taskPath, "utf8");
    } catch {
      return { ok: false, error: `task file not found: ${taskPath}` };
    }
    const charterBody = fs.readFileSync(path.resolve(workspace, charterFile), "utf8");
    const touchesText = extractSection(taskBody, "Touches") || "";
    const declaredTouches = touchesText.split(/\r?\n/).map((l) => l.trim().replace(/^-\s*/, "")).filter(Boolean);
    const charterHash = sha256(charterBody);
    const currentScopeHash = scopeHash({ taskBody, declaredTouches });
    const reviewPolicyHash = _currentReviewPolicyHash();
    const p = _decisionRecordPath(workspace, taskId);
    const record = {
      schemaVersion: 1,
      taskId,
      charterHash,
      scopeHash: currentScopeHash,
      // gap-split-decision-finality-not-enforced (2026-08-02): additive field (schemaVersion stays
      // 1 per the M207 additive-growth precedent). Consumed ONLY for `decision: "split"` records;
      // COMMIT adjudication keeps using `scopeHash`.
      splitScopeHash: splitScopeHash({ declaredTouches }),
      reviewPolicyHash,
      mechanismInventoryHash: null, // audit-only, excluded from match
      decision,
      reason,
      authorizingSessionId: sessionId || null,
      decidedAtMs: Date.now(),
      invalidations: [],
    };
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(record, null, 2));
    return { ok: true, path: p, record };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── --decide-split: pure read-only adjudication, invoked unconditionally by prepare-milestone.js.
// Reads the committed decision record and returns a verdict.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function _decideSplitCli({ taskId, workspace, charterFile }) {
  try {
    const taskPath = path.join(workspace, "tasks", `${taskId}.md`);
    const taskBody = fs.readFileSync(taskPath, "utf8");
    const charterBody = fs.readFileSync(path.resolve(workspace, charterFile), "utf8");
    const touchesText = extractSection(taskBody, "Touches") || "";
    const declaredTouches = touchesText.split(/\r?\n/).map((l) => l.trim().replace(/^-\s*/, "")).filter(Boolean);
    const charterHash = sha256(charterBody);
    const currentScopeHash = scopeHash({ taskBody, declaredTouches });
    const reviewPolicyHash = _currentReviewPolicyHash();
    const recordPath = _decisionRecordPath(workspace, taskId);
    let record = null;
    if (fs.existsSync(recordPath)) {
      try {
        record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
      } catch {
        // Unparseable record — treated as no-decision-on-file.
      }
    }
    const currentSplitScopeHash = splitScopeHash({ declaredTouches });
    const verdict = decideSplitAdjudication(record, { charterHash, scopeHash: currentScopeHash, reviewPolicyHash, splitScopeHash: currentSplitScopeHash });
    // If decision-invalidated and we mutated the record (COMMIT mismatch), write back the augmented record.
    if (verdict.verdict === "decision-invalidated" && verdict.record && record) {
      try {
        fs.writeFileSync(recordPath, JSON.stringify(verdict.record, null, 2));
      } catch {
        // Write failure non-fatal — the CLI surface still reports the correct verdict.
      }
    }
    return { ok: true, ...verdict, hashes: { charterHash, scopeHash: currentScopeHash, reviewPolicyHash, splitScopeHash: currentSplitScopeHash } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── gap-prepare-milestone-cross-generation-review-state-reset — cross-generation ProposalReview
// checkpoint. DIR-125 bounds convergence WITHIN one generation; DIR-126-C's resume skips
// ProposalAuthors/Adjudicate but ProposalReview itself always restarted from an empty ledger and a
// fresh full review — the real DIR-126-D incident burned nine full ProposalReview generations after
// small, targeted task edits. This closes that gap: a durable per-task checkpoint
// (`.quay/prepare-checkpoints/<safeTaskIdSegment>.json`, reusing the ONE shared `safeTaskIdSegment`
// imported from prepare-admission-check.ts — never a second sanitizer) carries the typed finding
// ledger, the last-reviewed Proposal text, and cumulative epoch counters forward across
// generations. A later
// attempt validates the checkpoint FAIL-CLOSED (identity/charter/scope/review-policy must all
// match — any mismatch or corruption routes to a typed cold/full-review reason, never silently
// accepted as a valid delta base), classifies the Proposal diff mechanically (never LLM
// self-report — the novelty half hooks into wiring-coverage-check.ts's real
// extractMechanismClaims/splitSentences, the SAME machinery the ProposalReview phase's own
// wiring-coverage-check dispatch already uses), and — only for `wording-only`/
// `known-finding-repair` diffs — lets prepare-milestone.js skip the full-review agent and dispatch
// exactly one delta reviewer instead. Charter/scope/review-policy changes never reach the
// classifier at all: they fail checkpoint validation first and always fall back to a full review.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const CHECKPOINT_SCHEMA_VERSION = 1;

// checkpointPath — same directory FAMILY as prepare-leases (gitignored, per-workspace runtime
// state), but its OWN subdirectory: a checkpoint is a cross-GENERATION artifact (survives a lease
// being released/reacquired many times over), not a single-generation lease/telemetry record.
export function checkpointPath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-checkpoints", `${safeTaskIdSegment(taskId)}.json`);
}

// buildReviewCheckpoint — every field explicitly materialized (no-fabrication discipline matching
// buildTelemetryRecord above): an omitted-but-required field becomes an explicit `null`/`[]`/`0`,
// never a dropped key, so validateReviewCheckpoint's REQUIRED-field scan below can distinguish a
// genuinely malformed record from this module's own honest "not applicable yet" value.
export function buildReviewCheckpoint({
  taskId, charterHash, scopeHash: scopeHashValue, reviewPolicyHash,
  reviewedProposalHash, reviewedProposalText,
  ledger, mechanismInventoryHash, mechanismInventoryCount,
  counters, terminal, lastFullReviewSession, recordedAtMs,
} = {}) {
  return {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    taskId: taskId ?? null,
    charterHash: charterHash ?? null,
    scopeHash: scopeHashValue ?? null,
    reviewPolicyHash: reviewPolicyHash ?? null,
    reviewedProposalHash: reviewedProposalHash ?? null,
    // The FULL text (not just its hash) is retained — a later attempt's diff classifier needs real
    // content to compare against, and no other durable store retains generation-scoped Proposal
    // text (receipts/telemetry never persist prose, per their own "never a second content source"
    // discipline). Markdown Proposal sections are small (single-digit KB); this is a gitignored
    // runtime artifact, never committed.
    reviewedProposalText: reviewedProposalText ?? "",
    ledger: Array.isArray(ledger) ? ledger : [],
    mechanismInventoryHash: mechanismInventoryHash ?? null,
    mechanismInventoryCount: Number.isFinite(mechanismInventoryCount) ? mechanismInventoryCount : null,
    // Cumulative ACROSS the whole scope epoch (Requested-action item 5), never reset by a mere
    // generation boundary — only a new epoch (charter/scope/review-policy change) resets these to
    // this generation's own local counts. Accumulation happens in _writeCheckpointCli, not here —
    // this builder just materializes whatever counters object the caller already computed.
    counters: {
      fullReviews: Number.isFinite(counters?.fullReviews) ? counters.fullReviews : 0,
      deltaRounds: Number.isFinite(counters?.deltaRounds) ? counters.deltaRounds : 0,
    },
    terminal: {
      reason: terminal?.reason ?? null,
      outcome: terminal?.outcome ?? null,
      timestamp: Number.isFinite(terminal?.timestamp) ? terminal.timestamp : null,
    },
    // The ORIGINAL full review's own provenance — carried forward unchanged across every subsequent
    // delta-only generation in the same epoch (never overwritten unless a NEW full review actually
    // ran this generation), so "which real session performed the one full semantic review of this
    // epoch" stays answerable after ten delta-only generations.
    lastFullReviewSession: {
      sessionId: lastFullReviewSession?.sessionId ?? null,
      timestamp: Number.isFinite(lastFullReviewSession?.timestamp) ? lastFullReviewSession.timestamp : null,
    },
    recordedAtMs: Number.isFinite(recordedAtMs) ? recordedAtMs : null,
  };
}

const _CHECKPOINT_REQUIRED_TOP = [
  "schemaVersion", "taskId", "charterHash", "scopeHash", "reviewPolicyHash",
  "reviewedProposalHash", "reviewedProposalText", "ledger", "counters", "terminal", "lastFullReviewSession",
];

// validateReviewCheckpoint — the ONE fail-closed gate (Requested-action item 2): missing, malformed,
// wrong-task, stale-charter/scope/policy state ALL route to a typed, DISTINCT reason code — never a
// generic "false" a caller could mistake for "just try a fresh full review for some other reason".
// Pure: no fs, no exceptions on well-formed-but-mismatched input (a caller passing a non-object
// still gets a typed result, never a thrown TypeError).
export function validateReviewCheckpoint(record, { taskId, charterHash, scopeHash: scopeHashValue, reviewPolicyHash } = {}) {
  if (!record) {
    return { ok: false, code: "checkpoint-missing", message: "no checkpoint record on file for this task" };
  }
  if (typeof record !== "object" || Array.isArray(record)) {
    return { ok: false, code: "checkpoint-corrupt", message: "checkpoint record is not a well-formed object" };
  }
  for (const k of _CHECKPOINT_REQUIRED_TOP) {
    if (!(k in record)) {
      return { ok: false, code: "checkpoint-corrupt", message: `checkpoint record is missing required field '${k}'` };
    }
  }
  if (!Array.isArray(record.ledger)) {
    return { ok: false, code: "checkpoint-corrupt", message: "checkpoint record's ledger is not an array" };
  }
  if (!record.counters || typeof record.counters !== "object" || !Number.isFinite(record.counters.fullReviews) || !Number.isFinite(record.counters.deltaRounds)) {
    return { ok: false, code: "checkpoint-corrupt", message: "checkpoint record's counters block is malformed" };
  }
  if (typeof record.reviewedProposalText !== "string") {
    return { ok: false, code: "checkpoint-corrupt", message: "checkpoint record's reviewedProposalText is not a string" };
  }
  if (record.taskId !== taskId) {
    return { ok: false, code: "checkpoint-wrong-task", message: `checkpoint taskId (${JSON.stringify(record.taskId)}) does not match the current attempt's taskId (${JSON.stringify(taskId)})` };
  }
  if (record.charterHash !== charterHash) {
    return { ok: false, code: "checkpoint-charter-mismatch", message: "checkpoint charterHash does not match the current charter — the milestone charter changed since this checkpoint was written" };
  }
  if (record.scopeHash !== scopeHashValue) {
    return { ok: false, code: "checkpoint-scope-mismatch", message: "checkpoint scopeHash does not match the current task's AC-count/Touches scope — the scope changed since this checkpoint was written" };
  }
  if (record.reviewPolicyHash !== reviewPolicyHash) {
    return { ok: false, code: "checkpoint-stale-policy", message: "checkpoint reviewPolicyHash does not match the current review-policy version" };
  }
  return { ok: true, code: "checkpoint-valid", message: "checkpoint is valid and matches the current attempt's identity/scope/policy" };
}

function _claimKey(claim) {
  return [...claim.identifiers].sort().join("+");
}

// A backtick identifier is treated as a "touch-like" file-path reference when it contains a path
// separator or a recognizable source-file extension — the SAME backtick-identifier convention
// extractMechanismClaims already relies on for this repo's own authoring style.
const _FILE_PATH_IDENT_RE = /^[\w.@+-]+(?:\/[\w.@+-]+)*\.(ts|tsx|js|jsx|mjs|cjs|md|json|ya?ml|sh)$/i;
function _extractFilePathIdentifiers(text) {
  const idents = new Set();
  const re = /`([^`]+)`/g;
  let m;
  while ((m = re.exec(text || ""))) {
    const id = m[1].trim();
    if (_FILE_PATH_IDENT_RE.test(id) || id.includes("/")) idents.add(id);
  }
  return idents;
}

// noveltyScan — AC #6's mechanical novelty check, standalone-callable AND reused internally by
// classifyProposalDiff below. A "novel claim" is a mechanism claim (wiring verb + >=2 backtick
// identifiers, extractMechanismClaims's own definition) present in the NEW Proposal text whose
// identifier-set was not present in the OLD text — never an LLM's self-report of "nothing new here".
export function noveltyScan({ oldProposalText, newProposalText }) {
  const oldClaims = extractMechanismClaims(oldProposalText || "");
  const newClaims = extractMechanismClaims(newProposalText || "");
  const oldKeys = new Set(oldClaims.map(_claimKey));
  const novelClaims = newClaims.filter((c) => !oldKeys.has(_claimKey(c)));
  return { hasNovelClaim: novelClaims.length > 0, novelClaims, oldClaimCount: oldClaims.length, newClaimCount: newClaims.length };
}

// classifyProposalDiff — Requested-action item 3's 5-way mechanical classification (charter/scope/
// review-policy changes never reach here — they fail checkpoint validation first, per this module's
// header comment). Evaluation order (most-severe-wins, never a bag of independent booleans):
//   1. no textual difference after whitespace/case normalization -> wording-only (trivial case)
//   2. a mechanism claim present in the OLD text is now GONE, and no ledger finding's own identity
//      text explains the removal -> mechanism-change (a promised wiring relationship vanished)
//   3. a genuinely NEW mechanism claim (novelty scan hit) -> new-claim
//   4. a new file-path-shaped backtick identifier appears that wasn't mentioned before -> touch-set-change
//   5. the changed sentences overlap a known ledger finding's own claimRef/summary keywords -> known-finding-repair
//   6. otherwise -> wording-only
// NON-GOAL (same posture as wiring-coverage-check.ts's own documented limitation): this cannot
// detect a claim/mechanism change phrased entirely in prose with no backtick identifiers — accepted,
// since this repo's authoring convention already names components in backticks and the alternative
// (real NLP) is out of scope for a mechanical gate.
export function classifyProposalDiff({ oldProposalText, newProposalText, ledger } = {}) {
  const oldText = oldProposalText || "";
  const newText = newProposalText || "";
  const normalize = (t) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const emptyScan = { hasNovelClaim: false, novelClaims: [], oldClaimCount: 0, newClaimCount: 0 };
  if (normalize(oldText) === normalize(newText)) {
    return { classification: "wording-only", code: "no-textual-difference", noveltyScan: emptyScan };
  }

  const oldClaims = extractMechanismClaims(oldText);
  const newClaims = extractMechanismClaims(newText);
  const oldKeys = new Set(oldClaims.map(_claimKey));
  const newKeys = new Set(newClaims.map(_claimKey));
  const addedClaims = newClaims.filter((c) => !oldKeys.has(_claimKey(c)));
  const scan = { hasNovelClaim: addedClaims.length > 0, novelClaims: addedClaims, oldClaimCount: oldClaims.length, newClaimCount: newClaims.length };

  const removedClaims = oldClaims.filter((c) => !newKeys.has(_claimKey(c)));
  const ledgerIdentifierText = (ledger || []).map((f) => `${f.claimRef || ""} ${f.evidence || ""} ${f.summary || ""}`).join(" ").toLowerCase();
  const unexplainedRemoval = removedClaims.find((c) => !c.identifiers.every((id) => ledgerIdentifierText.includes(String(id).toLowerCase())));
  if (unexplainedRemoval) {
    return { classification: "mechanism-change", code: "mechanism-claim-removed-unexplained", detail: unexplainedRemoval.sentence, noveltyScan: scan };
  }

  if (addedClaims.length > 0) {
    return { classification: "new-claim", code: "novel-mechanism-claim-detected", detail: addedClaims.map((c) => c.sentence).join(" | "), noveltyScan: scan };
  }

  const oldPaths = _extractFilePathIdentifiers(oldText);
  const newPaths = _extractFilePathIdentifiers(newText);
  const addedPaths = [...newPaths].filter((p) => !oldPaths.has(p));
  if (addedPaths.length > 0) {
    return { classification: "touch-set-change", code: "new-file-path-identifier-introduced", detail: addedPaths.join(", "), noveltyScan: scan };
  }

  const oldSentences = new Set(splitSentences(oldText).map(normalize));
  const newSentences = splitSentences(newText).map(normalize);
  const addedSentences = newSentences.filter((s) => !oldSentences.has(s));
  const overlapsKnownFinding = addedSentences.some((s) =>
    (ledger || []).some((f) => {
      const key = normalize(`${f.claimRef || ""} ${f.summary || ""}`);
      if (!key) return false;
      return key.split(" ").filter((w) => w.length > 3).some((w) => s.includes(w));
    })
  );
  if (overlapsKnownFinding) {
    return { classification: "known-finding-repair", code: "diff-scoped-to-known-finding", noveltyScan: scan };
  }
  return { classification: "wording-only", code: "no-new-claims-paths-or-mechanism-removal-detected", noveltyScan: scan };
}

function _readCheckpointRecord(workspace, taskId) {
  const p = checkpointPath(workspace, taskId);
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false, record: null, corrupt: false };
    throw err;
  }
  try {
    return { exists: true, record: JSON.parse(raw), corrupt: false };
  } catch {
    return { exists: true, record: null, corrupt: true };
  }
}

// (The private atomic-write helper this module once carried was absorbed into the shared
//  writeJsonAtomic — the same tmp-then-rename idiom, imported above — tasks/gap-writestate-
//  atomicity-split.)

// --resolve-checkpoint: READ-ONLY. Reads the checkpoint (if any), validates it fail-closed against
// the CURRENT task/charter/scope/review-policy (Requested-action item 2), and — only when valid —
// classifies the Proposal diff between the checkpoint's own last-reviewed text and the CURRENT
// on-disk Proposal (item 3). Never writes anything; a corrupt/mismatched/missing checkpoint is
// reported via a typed `usable:false` verdict, never repaired, deleted, or silently treated as
// usable here.
export function _resolveCheckpointCli({ taskId, workspace, charterFile }) {
  try {
    const taskPath = path.join(workspace, "tasks", `${taskId}.md`);
    const taskBody = fs.readFileSync(taskPath, "utf8");
    const charterBody = fs.readFileSync(path.resolve(workspace, charterFile), "utf8");
    const touchesText = extractSection(taskBody, "Touches") || "";
    const declaredTouches = touchesText.split(/\r?\n/).map((l) => l.trim().replace(/^-\s*/, "")).filter(Boolean);
    const charterHash = sha256(charterBody);
    const currentScopeHash = scopeHash({ taskBody, declaredTouches });
    const reviewPolicyHash = _currentReviewPolicyHash();
    const currentProposalText = extractSection(taskBody, "Proposal") || "";
    const currentProposalHash = sha256(currentProposalText);
    const hashes = { charterHash, scopeHash: currentScopeHash, reviewPolicyHash, proposalHash: currentProposalHash };

    const { record, corrupt } = _readCheckpointRecord(workspace, taskId);
    if (corrupt) {
      return { usable: false, code: "checkpoint-corrupt", message: "checkpoint file exists but is not valid JSON", hashes };
    }
    const validation = validateReviewCheckpoint(record, { taskId, charterHash, scopeHash: currentScopeHash, reviewPolicyHash });
    if (!validation.ok) {
      return { usable: false, code: validation.code, message: validation.message, hashes };
    }
    if (record.reviewedProposalHash === currentProposalHash) {
      // Nothing to classify — the Proposal is byte-identical to what this checkpoint already
      // reviewed. Exact-unchanged reuse is DIR-126-C's own decideResumeGeneration/reuse-terminal
      // mechanism's job, never this one's — reported distinctly so a caller never mistakes this for
      // a usable cross-generation delta base.
      return { usable: false, code: "checkpoint-proposal-unchanged", message: "current Proposal is byte-identical to the checkpoint's last-reviewed text", hashes };
    }
    const diff = classifyProposalDiff({ oldProposalText: record.reviewedProposalText, newProposalText: currentProposalText, ledger: record.ledger });
    return {
      usable: true,
      code: "checkpoint-valid",
      classification: diff.classification,
      classificationCode: diff.code,
      classificationDetail: diff.detail ?? null,
      noveltyScan: diff.noveltyScan,
      ledger: record.ledger,
      counters: record.counters,
      mechanismInventoryHash: record.mechanismInventoryHash,
      mechanismInventoryCount: record.mechanismInventoryCount,
      lastFullReviewSession: record.lastFullReviewSession,
      // gap-prepare-milestone-cross-generation-review-state-reset (round 2, post-REFUTATION): the
      // OLD reviewed text, so the caller can hand a real independent LLM reviewer the actual
      // before/after diff to verify itself — classifyProposalDiff's own mechanical classification
      // is advisory input to that reviewer, never a substitute for one. Never trust the mechanical
      // classification alone to admit zero-reviewer cross-generation continuation (see the round-2
      // REFUTATION this responds to: identifier-set-only claim identity let a weakened or fully
      // removed wiring claim classify as wording-only/known-finding-repair).
      reviewedProposalText: record.reviewedProposalText,
      hashes,
    };
  } catch (err) {
    // Fail-closed on any exception (malformed disk state, missing task/charter file, unreadable
    // checkpoint directory): never silently treated as "usable" — always routes the caller to a
    // full review.
    return { usable: false, code: "checkpoint-resolve-exception", message: err.message };
  }
}

// --write-checkpoint: re-reads task/charter/Proposal FRESH (as-of-terminal — the SAME rationale
// _writeLegacyGenerationRecord's own comment documents: the Proposal may have been revised since
// entry, e.g. across ProposalReview delta rounds), reads `checkpointInputFile` (a scratch handoff an
// agent just wrote with EXACTLY the caller's ledger/mechanism-inventory/this-generation's-own-local-
// counters content — the workflow DSL has no fs of its own, the SAME "write file with EXACT content
// then run a CLI over it" pattern the Receipt phase already uses for the ledger/mechanism-inventory
// files), accumulates epoch-scoped counters onto any PRIOR checkpoint sharing the SAME (charterHash,
// scopeHash, reviewPolicyHash) epoch key (Requested-action item 5 — a scope-bearing change starts
// counters fresh at this generation's own local counts), and writes the result atomically to
// checkpointPath(workspace, taskId).
export function _writeCheckpointCli({ taskId, workspace, charterFile, checkpointInputFile, terminalReason, terminalOutcome }) {
  try {
    const taskPath = path.join(workspace, "tasks", `${taskId}.md`);
    const taskBody = fs.readFileSync(taskPath, "utf8");
    const charterBody = fs.readFileSync(path.resolve(workspace, charterFile), "utf8");
    const touchesText = extractSection(taskBody, "Touches") || "";
    const declaredTouches = touchesText.split(/\r?\n/).map((l) => l.trim().replace(/^-\s*/, "")).filter(Boolean);
    const charterHash = sha256(charterBody);
    const currentScopeHash = scopeHash({ taskBody, declaredTouches });
    const reviewPolicyHash = _currentReviewPolicyHash();
    const reviewedProposalText = extractSection(taskBody, "Proposal") || "";
    const reviewedProposalHash = sha256(reviewedProposalText);

    let input = {};
    try {
      input = JSON.parse(fs.readFileSync(checkpointInputFile, "utf8"));
    } catch (err) {
      return { ok: false, error: `unreadable/malformed --checkpointInputFile: ${err.message}` };
    }
    const fullReviewsThisGen = Number.isFinite(input.fullReviewsThisGen) ? input.fullReviewsThisGen : 0;
    const deltaRoundsThisGen = Number.isFinite(input.deltaRoundsThisGen) ? input.deltaRoundsThisGen : 0;

    const { record: priorRecord } = _readCheckpointRecord(workspace, taskId);
    const sameEpoch = !!(priorRecord && priorRecord.charterHash === charterHash && priorRecord.scopeHash === currentScopeHash && priorRecord.reviewPolicyHash === reviewPolicyHash);
    const counters = {
      fullReviews: (sameEpoch ? (priorRecord.counters?.fullReviews || 0) : 0) + fullReviewsThisGen,
      deltaRounds: (sameEpoch ? (priorRecord.counters?.deltaRounds || 0) : 0) + deltaRoundsThisGen,
    };
    const lastFullReviewSession = fullReviewsThisGen > 0
      ? { sessionId: input.lastFullReviewSessionId ?? null, timestamp: Number.isFinite(input.lastFullReviewTimestamp) ? input.lastFullReviewTimestamp : null }
      : (sameEpoch && priorRecord.lastFullReviewSession ? priorRecord.lastFullReviewSession : { sessionId: input.lastFullReviewSessionId ?? null, timestamp: Number.isFinite(input.lastFullReviewTimestamp) ? input.lastFullReviewTimestamp : null });

    const record = buildReviewCheckpoint({
      taskId, charterHash, scopeHash: currentScopeHash, reviewPolicyHash,
      reviewedProposalHash, reviewedProposalText,
      ledger: Array.isArray(input.ledger) ? input.ledger : [],
      mechanismInventoryHash: input.mechanismInventoryHash ?? null,
      mechanismInventoryCount: Number.isFinite(input.mechanismInventoryCount) ? input.mechanismInventoryCount : null,
      counters,
      terminal: { reason: terminalReason ?? null, outcome: terminalOutcome ?? null, timestamp: Date.now() },
      lastFullReviewSession,
      recordedAtMs: Date.now(),
    });
    const p = checkpointPath(workspace, taskId);
    writeJsonAtomic(p, record);
    return { ok: true, checkpointFile: p, counters, epochReset: !sameEpoch };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ── gap-prepare-milestone-task-epoch-budget-reset — epoch-cumulative circuit breaker. DIR-125
// bounds convergence WITHIN one generation; this file's own decideResumeGeneration/checkpoint
// mechanisms above carry state forward ACROSS generations, but neither bounds the number of
// GENERATIONS a task can burn — the real DIR-126-D incident accumulated ~5h wall time / ~9.5M
// aggregate tokens / 11 attempts, each individually within its own local DIR-125 policy. This
// closes that gap with a durable per-task epoch record
// (`.quay/prepare-epochs/<safeTaskIdSegment>.json`, reusing the ONE shared `safeTaskIdSegment`
// imported from prepare-admission-check.ts and `_currentReviewPolicyHash`/sha256-charter-hash
// idioms verbatim — never a second sanitizer or hasher), keyed on (taskId, charterHash,
// reviewPolicyHash) ONLY — deliberately NOT any
// Proposal-content hash, so an ordinary Proposal/Plan/AC/Touches edit can never reset the epoch
// (Requested-action item 2). A new epoch requires an EXPLICIT `--new-epoch` CLI call with
// owner+reason; a bounded time extension requires an EXPLICIT `--override-budget` call. Neither is
// ever auto-invoked by prepare-milestone.js's own automated flow — both are human-invoked-only CLI
// surfaces, matching the SAME posture `--record-split-decision` already established for M206/M4's
// COMMIT/SPLIT decisions (this mechanism's own `allowedActions` reuse those two literal action
// names verbatim, never reinventing a parallel commit/split concept).
//
// Per the lesson learned the hard way by gap-prepare-milestone-cross-generation-review-state-reset
// (round 1's `classifyProposalDiff` heuristic was found exploitable by an independent reviewer; the
// round-2 fix was a STRUCTURAL guarantee, never a smarter classifier): the caps enforced here are
// simple, mechanical, countable things (elapsed observable-agent time, full-review count, dispatch
// count, repeated-terminal-fingerprint count) — there is no heuristic anywhere in this module that
// decides whether a given content-agent dispatch "doesn't really count." Every real content-agent
// dispatch counts, full stop; only an explicit human CLI call can create a new epoch or grant a
// bounded override.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const EPOCH_SCHEMA_VERSION = 1;

// DEFAULT_EPOCH_POLICY — the fail-closed compiled ceiling (Requested-action item 3: "ordinary
// defaults must be no looser than 90 minutes"; highRisk 150m/1 full review/2 repeated-fingerprint).
// A caller MAY lower ordinaryCapMinutes/highRiskCapMinutes via --record-epoch-dispatch's own
// --ordinaryCapMinutes/--highRiskCapMinutes flags (see _recordEpochDispatchCli below), never raise
// them — the SAME "callers may lower, never raise" contract capsFor()/_maxDeltaRounds already
// establishes for DIR-125's own per-generation caps.
// gap-prepare-milestone-task-epoch-budget-reset (round 2, post-REFUTATION): maxOverrideCount is a
// HARD, count-based ceiling on total overrides ever granted for one epoch — added after an
// independent review found the original "distinct owner+reason" text check (compared only against
// the MOST RECENT override) could be defeated by trivially alternating between two canned reason
// strings, granting unbounded cumulative budget. Text-based distinctness can never be a real
// security boundary (the same lesson the sibling checkpoint task learned the hard way — see
// gap-prepare-milestone-cross-generation-review-state-reset's own Round 2 history — a heuristic
// judgment call is not a substitute for a hard mechanical bound). This count ceiling is now the
// REAL boundary; the strengthened distinctness check (compares against ALL prior overrides, not
// just the last one) is defense-in-depth on top of it, not the sole protection.
// gap-prepare-milestone-task-epoch-budget-reset (round 3, post-SECOND-REFUTATION): maxNewEpochResetCount
// is the SAME hard-ceiling pattern as maxOverrideCount, applied to --new-epoch itself. A round-2
// reviewer found --new-epoch --confirmUnchangedScope true had NO rate limit at all — a mechanically
// ungated, infinitely-repeatable full reset of EVERY cumulative counter this whole circuit breaker
// exists to protect, strictly worse than the override-chaining bug round 2 fixed (that one only
// extended the time budget; this one erases all of it). Reproduced live: 5 identical `--new-epoch`
// calls in a row, all succeeded, each resetting counters to zero. Fixed the same way: a hard count
// ceiling on total resets ever recorded for this task (enforced against the CARRIED-FORWARD
// `resets[]` array, which survives a reset by design — unlike `counters`, which is deliberately
// zeroed — so the ceiling itself cannot be reset away), plus a distinctness check on the new
// reset's own (owner, reason) against every PRIOR reset already on file.
export const DEFAULT_EPOCH_POLICY = Object.freeze({
  ordinaryCapMinutes: 90,
  highRiskCapMinutes: 150,
  maxFullReviewsPerEpoch: 1,
  maxRepeatedFingerprint: 2,
  maxOverrideCount: 3,
  maxNewEpochResetCount: 3,
});

// epochPath — SAME directory FAMILY as prepare-checkpoints (gitignored per-workspace runtime
// state), its OWN subdirectory: an epoch record is CUMULATIVE ACROSS every generation for a given
// (taskId, charterHash, reviewPolicyHash) identity, never reset by a single generation's own
// lease/checkpoint lifecycle.
export function epochPath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-epochs", `${safeTaskIdSegment(taskId)}.json`);
}

// ── Epoch lock — gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening (item 1): a real
// TOCTOU race, reproduced live by the round-3 adversarial review — `_newEpochCli`/
// `_overrideBudgetCli` each do a read-existing-record -> check-hard-ceiling -> `writeJsonAtomic`
// sequence with NO inter-process lock around the check-then-act window; 6 (and separately 20)
// genuinely concurrent `--new-epoch` calls against `maxNewEpochResetCount:3` produced 4 `ok:true`
// responses, and the final on-disk record showed only 3 resets — one caller's own accepted entry
// silently vanished (last-writer-wins on `writeJsonAtomic`'s rename). Fixed by reusing this
// repo's EXISTING atomic-lock primitive verbatim rather than inventing a new one:
// `prepare-admission-check.ts`'s lease acquisition uses `fs.writeFileSync(path, json, {flag:
// 'wx'})` (Node's atomic exclusive-create, throws EEXIST on contention) as the single-flight
// mechanism — the SAME primitive, applied here to a short-lived critical section instead of a
// multi-hundred-minute generation lease. `epochLockPath` reuses `safeTaskIdSegment` VERBATIM
// (the single shared sanitizer — never a second sanitizer) for the SAME reason
// `epochPath`/`checkpointPath`/lease paths already do.
function epochLockPath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-epochs", `${safeTaskIdSegment(taskId)}.lock`);
}

// This is a short-lived, LOW-CONTENTION lock (a handful of human-invoked CLI calls at most, each
// holding it only across one read+JSON-check+atomic-write — low milliseconds), never a
// high-throughput primitive — a few short, bounded retries with backoff is proportionate; an
// unbounded retry/poll loop is not (never hang indefinitely). Mirrors the ORDER OF MAGNITUDE of
// `prepare-admission-check.ts`'s own `LEASE_READ_RETRY_DELAYS_MS`, widened slightly since this
// primitive may need to wait out an ENTIRE concurrent critical section, not just a single read.
const EPOCH_LOCK_RETRY_DELAYS_MS = [20, 40, 80, 160, 320, 640];
// A held lock older than this is treated as an orphaned/crashed holder and reclaimed —
// age-based, deterministic staleness check in the SAME spirit as `checkStaleOwner`'s stale-lease
// reclaim (`prepare-admission-check.ts`), scaled down from that mechanism's multi-hundred-minute
// generation lease to THIS primitive's own short-lived (expected: low-milliseconds)
// read-check-write critical section — a lock still held after 30s did not crash mid-critical-
// section, it crashed and needs reclaiming, not a permanent deadlock.
const EPOCH_LOCK_STALE_MS = 30 * 1000;

function _syncSleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Test-only injectable hold-delay (gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening
// review finding: the original disabled-lock regression test only caught a broken lock ~57% of
// the time on a real machine, since natural OS-scheduling variance doesn't reliably force two
// concurrent critical sections to overlap). When set, `_acquireEpochLock` sleeps this many ms
// AFTER acquiring the lock and BEFORE returning — widening the critical section deterministically
// so a regression test can force a genuine overlap window instead of relying on scheduling luck.
// Never read outside a test process (no production code path sets this env var).
function _epochLockTestHoldDelayMs() {
  const raw = process.env.QUAY_EPOCH_LOCK_TEST_HOLD_MS;
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// _acquireEpochLock — throws a typed `epoch-lock-contention` error (never silently proceeds
// without the lock, never hangs indefinitely) if every bounded retry is exhausted while a
// genuinely live holder still holds it. A stale (crashed) holder is reclaimed deterministically —
// no permanent deadlock from a crashed process. Returns `{lockPath, token}`; `token` must be
// passed back to `_releaseEpochLock` (ownership check, see its own comment).
function _acquireEpochLock(workspace, taskId) {
  const lockPath = epochLockPath(workspace, taskId);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const holder = { pid: process.pid, acquiredAtMs: Date.now(), token };
  for (let attempt = 0; attempt <= EPOCH_LOCK_RETRY_DELAYS_MS.length; attempt++) {
    try {
      // The atomic-create primitive: throws EEXIST if a lock already exists — the SAME real
      // single-flight mechanism `prepare-admission-check.ts`'s `_grantLeaseAtomic` establishes.
      fs.writeFileSync(lockPath, JSON.stringify(holder), { flag: "wx" });
      const testHoldMs = _epochLockTestHoldDelayMs();
      if (testHoldMs > 0) _syncSleepMs(testHoldMs);
      return { lockPath, token };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let existing = null;
      try {
        existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      } catch {
        existing = null; // unreadable/mid-write/already-removed by the holder — treated as live contention below, never itself a crash signal
      }
      // Staleness clock: prefer the holder's own self-reported acquiredAtMs, but fall back to the
      // lock FILE's own mtime when the content is unparseable/corrupt (review finding: a corrupt
      // lock file made `existing` null forever, so `age` was always null and the 30s staleness
      // reclaim path could NEVER fire for it — a permanent block, contradicting this primitive's
      // own "never a permanent deadlock" guarantee). The file's own mtime is a real, content-
      // independent clock that survives corruption.
      let age = existing && Number.isFinite(existing.acquiredAtMs) ? Date.now() - existing.acquiredAtMs : null;
      if (age === null) {
        try {
          age = Date.now() - fs.statSync(lockPath).mtimeMs;
        } catch {
          age = null; // lock file vanished between the failed read and this stat — treated as contention, retry below
        }
      }
      if (age !== null && age >= EPOCH_LOCK_STALE_MS) {
        // Stale age alone is NOT proof the holder crashed — a holder that is ALIVE but slow
        // (its critical section runs > EPOCH_LOCK_STALE_MS under load) must NOT be reclaimed:
        // reclaiming it breaks mutual exclusion (two callers inside the critical section), which
        // lets the hard ceiling be exceeded (proposal-convergence 20-concurrency --new-epoch
        // REGRESSION red under the suite's systemd-scoped load: succeeded.length > maxNewEpochResetCount).
        // Probe holder liveness via process.kill(pid, 0) (no signal sent): ESRCH ⇒ genuinely
        // crashed ⇒ reclaim the orphaned lock; alive (or PID unknown on a corrupt lock) ⇒ treat
        // as LIVE contention and fall through to the bounded retry sleep below.
        const holderPid = existing?.pid;
        let holderDead = true;
        if (Number.isFinite(holderPid)) {
          try { process.kill(holderPid, 0); holderDead = false; } catch { holderDead = true; }
        }
        if (holderDead) {
          // genuinely crashed holder — reclaim by removing the orphaned lock file, retry immediately
          // (still bounded by this SAME loop's own attempt count, never an unbounded reclaim/retry cycle).
          try { fs.rmSync(lockPath, { force: true }); } catch { /* another racer may have reclaimed it first */ }
          continue;
        }
      }
      if (attempt < EPOCH_LOCK_RETRY_DELAYS_MS.length) {
        _syncSleepMs(EPOCH_LOCK_RETRY_DELAYS_MS[attempt]);
      }
    }
  }
  const err = new Error(`epoch-lock-contention: could not acquire the epoch lock for ${taskId} after ${EPOCH_LOCK_RETRY_DELAYS_MS.length + 1} attempt(s) — another process is actively holding it; failing closed rather than proceeding without the lock or waiting indefinitely`);
  err.code = "epoch-lock-contention";
  throw err;
}

// _releaseEpochLock — ownership-checked: only removes the lock file if its on-disk content still
// carries OUR OWN token from acquisition. This is defense-in-depth against a same-process/same-
// codebase logic bug (e.g. two call sites racing to release with mismatched state) — it does NOT
// and cannot defend against an EXTERNAL actor with raw filesystem delete access removing the lock
// file directly (bypassing this function entirely); that class of tampering is accepted risk, the
// SAME trust boundary as direct deletion of the epoch record file itself (see the task's own
// Decisions section — both are named there together, not just the epoch file).
function _releaseEpochLock(workspace, taskId, token) {
  const lockPath = epochLockPath(workspace, taskId);
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (existing?.token !== token) {
      return; // not ours — reclaimed as stale by a racer, or a different holder now occupies this path; never remove state we don't own
    }
    fs.rmSync(lockPath, { force: true });
  } catch {
    // missing/unreadable at release time — e.g. reclaimed as stale by a racer while this call was
    // mid-critical-section — never fatal to the caller's own already-completed work
  }
}

function _computeEpochId({ taskId, charterHash, reviewPolicyHash, salt }) {
  return sha256(`${taskId}::${charterHash}::${reviewPolicyHash}::${salt ?? ""}`).slice(0, 12);
}

// buildEpochRecord — every field explicitly materialized (no-fabrication discipline matching
// buildTelemetryRecord/buildReviewCheckpoint above): an omitted-but-required field becomes an
// explicit `null`/`0`/`{}`, never a dropped key. `counters.tokensObserved` defaults to `null`
// (never a fabricated `0`) whenever no real token usage has ever been observed for this epoch.
export function buildEpochRecord({
  epochId, taskId, charterHash, reviewPolicyHash, parentEpochId,
  bodyScopeHash,
  counters, overrides, resets, policy, createdAtMs,
} = {}) {
  return {
    schemaVersion: EPOCH_SCHEMA_VERSION,
    epochId: epochId ?? null,
    taskId: taskId ?? null,
    charterHash: charterHash ?? null,
    reviewPolicyHash: reviewPolicyHash ?? null,
    parentEpochId: parentEpochId ?? null,
    // bodyScopeHash: a hash over the task's ## Proposal section content — stored at record TOP
    // LEVEL (not in counters) so it persists across --new-epoch resets. null means "no scope hash
    // has ever been recorded for this epoch" — the conservative default for pre-migration records.
    bodyScopeHash: bodyScopeHash ?? null,
    counters: {
      attempts: Number.isFinite(counters?.attempts) ? counters.attempts : 0,
      fullReviews: Number.isFinite(counters?.fullReviews) ? counters.fullReviews : 0,
      deltaRounds: Number.isFinite(counters?.deltaRounds) ? counters.deltaRounds : 0,
      contentAgentDispatches: Number.isFinite(counters?.contentAgentDispatches) ? counters.contentAgentDispatches : 0,
      observableAgentMs: Number.isFinite(counters?.observableAgentMs) ? counters.observableAgentMs : 0,
      terminalFingerprints: (counters?.terminalFingerprints && typeof counters.terminalFingerprints === "object" && !Array.isArray(counters.terminalFingerprints)) ? counters.terminalFingerprints : {},
      // Never a fabricated 0 — null means "no real token usage has ever been observed for this
      // epoch", distinct from a real observed value of 0.
      tokensObserved: Number.isFinite(counters?.tokensObserved) ? counters.tokensObserved : null,
    },
    overrides: Array.isArray(overrides) ? overrides : [],
    resets: Array.isArray(resets) ? resets : [],
    policy: {
      ordinaryCapMinutes: Number.isFinite(policy?.ordinaryCapMinutes) ? policy.ordinaryCapMinutes : DEFAULT_EPOCH_POLICY.ordinaryCapMinutes,
      highRiskCapMinutes: Number.isFinite(policy?.highRiskCapMinutes) ? policy.highRiskCapMinutes : DEFAULT_EPOCH_POLICY.highRiskCapMinutes,
      maxFullReviewsPerEpoch: Number.isFinite(policy?.maxFullReviewsPerEpoch) ? policy.maxFullReviewsPerEpoch : DEFAULT_EPOCH_POLICY.maxFullReviewsPerEpoch,
      maxRepeatedFingerprint: Number.isFinite(policy?.maxRepeatedFingerprint) ? policy.maxRepeatedFingerprint : DEFAULT_EPOCH_POLICY.maxRepeatedFingerprint,
      maxOverrideCount: Number.isFinite(policy?.maxOverrideCount) ? policy.maxOverrideCount : DEFAULT_EPOCH_POLICY.maxOverrideCount,
      maxNewEpochResetCount: Number.isFinite(policy?.maxNewEpochResetCount) ? policy.maxNewEpochResetCount : DEFAULT_EPOCH_POLICY.maxNewEpochResetCount,
    },
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
  };
}

// checkEpochCaps — the ONE pure decision function every enforcement point (the CLI below AND
// prepare-milestone.js's own no-import inline mirror, `_checkEpochCapsInline`) consults. Evaluation
// order (most-severe/cheapest-first, never a bag of independent booleans): repeated-terminal-
// fingerprint, then (only when the caller is specifically about to attempt ANOTHER full review —
// `checkFullReviewCap:true`, passed ONLY at that one dispatch site) full-review cap, then the
// cumulative observable-time cap (policy cap + any recorded override minutes). Never mutates its
// inputs, never dispatches anything.
export function checkEpochCaps({ counters, policy, highRisk, overrides, checkFullReviewCap = false, bodyScopeHash, currentBodyScopeHash } = {}) {
  const c = counters || {};
  const p = policy || DEFAULT_EPOCH_POLICY;
  const capMinutes = highRisk
    ? (Number.isFinite(p.highRiskCapMinutes) ? p.highRiskCapMinutes : DEFAULT_EPOCH_POLICY.highRiskCapMinutes)
    : (Number.isFinite(p.ordinaryCapMinutes) ? p.ordinaryCapMinutes : DEFAULT_EPOCH_POLICY.ordinaryCapMinutes);
  const overrideMinutes = (overrides || []).reduce((sum, o) => sum + (Number.isFinite(o?.additionalBudget) ? o.additionalBudget : 0), 0);
  const effectiveCapMs = (capMinutes + overrideMinutes) * 60 * 1000;
  const observableAgentMs = Number.isFinite(c.observableAgentMs) ? c.observableAgentMs : 0;
  const maxFullReviews = Number.isFinite(p.maxFullReviewsPerEpoch) ? p.maxFullReviewsPerEpoch : DEFAULT_EPOCH_POLICY.maxFullReviewsPerEpoch;
  const fullReviews = Number.isFinite(c.fullReviews) ? c.fullReviews : 0;
  const maxRepeatedFingerprint = Number.isFinite(p.maxRepeatedFingerprint) ? p.maxRepeatedFingerprint : DEFAULT_EPOCH_POLICY.maxRepeatedFingerprint;
  const fpCounts = (c.terminalFingerprints && typeof c.terminalFingerprints === "object") ? c.terminalFingerprints : {};
  const repeated = Object.entries(fpCounts).find(([, count]) => Number.isFinite(count) && count >= maxRepeatedFingerprint);
  if (repeated) {
    return {
      breached: true, breachedCap: "repeated-terminal-fingerprint", code: "epoch-fingerprint-cap-exceeded",
      message: `terminal fingerprint ${repeated[0]} has recurred ${repeated[1]} time(s), meeting the epoch cap of ${maxRepeatedFingerprint}`,
      detail: { fingerprint: repeated[0], count: repeated[1], cap: maxRepeatedFingerprint },
    };
  }
  // scope-change grant (M233): when the stored bodyScopeHash is non-null and differs from the
  // current task body's Proposal hash, the scope has demonstrably changed since the last full
  // review — grant a fresh full-review allowance WITHOUT consuming a --new-epoch reset. The
  // fingerprint cap is still checked FIRST (a task that keeps hitting the same terminal fingerprint
  // is broken regardless of body changes). The time cap is still checked AFTER this block (a body
  // change does NOT reset the cumulative time counter).
  if (checkFullReviewCap && fullReviews >= maxFullReviews) {
    if (bodyScopeHash != null && currentBodyScopeHash != null && bodyScopeHash !== currentBodyScopeHash) {
      return { breached: false, scopeChanged: true };
    }
    return {
      breached: true, breachedCap: "full-review-cap-exceeded", code: "epoch-full-review-cap-exceeded",
      message: `cumulative full-review count (${fullReviews}) meets/exceeds the epoch cap of ${maxFullReviews} for this unchanged scope epoch`,
      detail: { fullReviews, cap: maxFullReviews },
    };
  }
  if (observableAgentMs >= effectiveCapMs) {
    return {
      breached: true, breachedCap: "time-cap-exceeded", code: "epoch-time-cap-exceeded",
      message: `cumulative observable agent time (${observableAgentMs}ms) meets/exceeds the epoch cap (${effectiveCapMs}ms${overrideMinutes ? `, includes ${overrideMinutes}m override` : ""})`,
      detail: { observableAgentMs, effectiveCapMs, capMinutes, overrideMinutes },
    };
  }
  return { breached: false };
}

function _epochIdentityMatches(record, { taskId, charterHash, reviewPolicyHash }) {
  return !!record && record.taskId === taskId && record.charterHash === charterHash && record.reviewPolicyHash === reviewPolicyHash;
}

function _readEpochRecord(workspace, taskId) {
  const p = epochPath(workspace, taskId);
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false, record: null, corrupt: false };
    throw err;
  }
  try {
    return { exists: true, record: JSON.parse(raw), corrupt: false };
  } catch {
    return { exists: true, record: null, corrupt: true };
  }
}

// _currentEpochIdentity — reuses the SAME charter-sha256/`_currentReviewPolicyHash()` idiom
// `_readCurrentHashes` above already establishes — deliberately does NOT read the task file at all
// (unlike `_readCurrentHashes`/`scopeHash`): the epoch identity is Proposal/AC/Touches-insensitive
// by design (Requested-action item 2).
function _currentEpochIdentity({ workspace, taskId, charterFile }) {
  const charterBody = fs.readFileSync(path.resolve(workspace, charterFile), "utf8");
  return { charterHash: sha256(charterBody), reviewPolicyHash: _currentReviewPolicyHash() };
}

// --epoch-status: READ-ONLY, never writes anything. Distinguishes observed/estimated/unknown
// fields (Requested-action item 6): every counter here is a real accumulated delta ("observed");
// `tokensObserved: null` is reported via `tokenAccounting: "unknown"`, never silently treated as 0.
export function _epochStatusCli({ taskId, workspace, charterFile, highRisk, checkFullReviewCap, computeBodyScopeHash }) {
  try {
    const { charterHash, reviewPolicyHash } = _currentEpochIdentity({ workspace, taskId, charterFile });
    const { record, corrupt } = _readEpochRecord(workspace, taskId);
    const hr = highRisk === true || highRisk === "true";
    const cfrc = checkFullReviewCap === true || checkFullReviewCap === "true";
    const cbws = computeBodyScopeHash === true || computeBodyScopeHash === "true";
    // M233: compute the current bodyScopeHash from the task's ## Proposal section on demand.
    // Reuses the SAME fs.readFileSync + extractSection + sha256 pattern _readCurrentHashes() and
    // _resolveCheckpointCli() already use — zero new I/O class.
    let bodyScopeHash = null;
    if (cbws) {
      try {
        const taskPath = path.join(workspace, "tasks", `${taskId}.md`);
        const taskBody = fs.readFileSync(taskPath, "utf8");
        const proposal = extractSection(taskBody, "Proposal") || "";
        bodyScopeHash = sha256(proposal);
      } catch {
        // Missing/corrupt task file — bodyScopeHash stays null. The Preflight phase would have
        // caught this first; this is a defense-in-depth no-failure-on-read catch.
      }
    }
    if (corrupt) {
      return { ok: true, code: "epoch-corrupt", exists: true, message: "epoch record file exists but is not valid JSON — never blindly trusted as a fresh/zero epoch", hashes: { charterHash, reviewPolicyHash } };
    }
    if (!record) {
      const fresh = buildEpochRecord({});
      const result = {
        ok: true, code: "no-epoch-record", exists: false,
        epochId: null, parentEpochId: null,
        counters: fresh.counters, policy: DEFAULT_EPOCH_POLICY, overrides: [], resets: [],
        capCheck: { breached: false },
        hashes: { charterHash, reviewPolicyHash },
        tokenAccounting: "unknown",
      };
      if (cbws) {
        result.bodyScopeHash = bodyScopeHash;
        result.recordBodyScopeHash = null;
      }
      return result;
    }
    if (!_epochIdentityMatches(record, { taskId, charterHash, reviewPolicyHash })) {
      return {
        ok: true, code: "epoch-identity-mismatch", exists: true,
        epochId: record.epochId, priorCharterHash: record.charterHash, priorReviewPolicyHash: record.reviewPolicyHash,
        hashes: { charterHash, reviewPolicyHash },
      };
    }
    const capCheck = checkEpochCaps({
      counters: record.counters, policy: record.policy, highRisk: hr, overrides: record.overrides, checkFullReviewCap: cfrc,
      bodyScopeHash: record.bodyScopeHash ?? null, currentBodyScopeHash: cbws ? bodyScopeHash : null,
    });
    const result = {
      ok: true, code: "epoch-status-ok", exists: true,
      epochId: record.epochId, parentEpochId: record.parentEpochId,
      counters: record.counters, policy: record.policy, overrides: record.overrides, resets: record.resets,
      capCheck,
      hashes: { charterHash, reviewPolicyHash },
      tokenAccounting: record.counters.tokensObserved === null ? "unknown" : "observed",
    };
    if (cbws) {
      result.bodyScopeHash = bodyScopeHash;
      result.recordBodyScopeHash = record.bodyScopeHash ?? null;
    }
    return result;
  } catch (err) {
    return { ok: false, code: "epoch-status-exception", error: err.message };
  }
}

// --record-epoch-dispatch: the ONLY write path prepare-milestone.js's own automated flow ever
// calls. Folds real deltas (dispatch/full-review/delta-round counts, elapsed observable-agent ms,
// one terminal-fingerprint occurrence, an attempt increment, and optionally an ADDITIVE
// tokensObserved delta) into the epoch record matching the CURRENT (taskId, charterHash,
// reviewPolicyHash) identity — bootstrapping a fresh epoch (parentEpochId: null) the FIRST time a
// task is ever dispatched, but refusing (fail-closed, `epoch-identity-mismatch-requires-new-epoch`)
// to silently start over when an ON-FILE record's identity no longer matches: that always requires
// an explicit --new-epoch call first (Requested-action item 2/5).
export function _recordEpochDispatchCli({
  taskId, workspace, charterFile, highRisk,
  dispatchDelta, fullReviewDelta, deltaRoundDelta, elapsedMsDelta, attemptIncrement,
  terminalPhase, reason, tokensObserved, bodyScopeHash,
  ordinaryCapMinutes, highRiskCapMinutes,
}) {
  try {
    const { charterHash, reviewPolicyHash } = _currentEpochIdentity({ workspace, taskId, charterFile });
    const { record: existing, corrupt } = _readEpochRecord(workspace, taskId);
    if (corrupt) {
      return { ok: false, code: "epoch-corrupt", error: "epoch record file exists but is not valid JSON — refusing to blindly overwrite; run --new-epoch to explicitly recover" };
    }
    if (existing && !_epochIdentityMatches(existing, { taskId, charterHash, reviewPolicyHash })) {
      return { ok: false, code: "epoch-identity-mismatch-requires-new-epoch", error: "an epoch record exists for this task but its (charterHash, reviewPolicyHash) identity no longer matches current state — call --new-epoch first, never silently reset" };
    }
    const base = existing ? existing.counters : buildEpochRecord({}).counters;
    const basePolicy = existing ? existing.policy : DEFAULT_EPOCH_POLICY;
    const _dispatchDelta = Number.isFinite(dispatchDelta) ? dispatchDelta : 0;
    const _fullReviewDelta = Number.isFinite(fullReviewDelta) ? fullReviewDelta : 0;
    const _deltaRoundDelta = Number.isFinite(deltaRoundDelta) ? deltaRoundDelta : 0;
    const _elapsedMsDelta = Number.isFinite(elapsedMsDelta) ? elapsedMsDelta : 0;
    const _attemptIncrement = Number.isFinite(attemptIncrement) ? attemptIncrement : 0;
    const fp = sha256(`${terminalPhase}::${reason}`).slice(0, 12);
    const terminalFingerprints = { ...(base.terminalFingerprints || {}) };
    terminalFingerprints[fp] = (terminalFingerprints[fp] || 0) + 1;
    // tokensObserved: an ABSENT/non-numeric flag leaves whatever was already on file UNCHANGED
    // (never fabricates a 0); a present numeric flag is ADDED to any existing observed value
    // (starting from 0 only once a first real observation exists).
    let newTokensObserved = Number.isFinite(base.tokensObserved) ? base.tokensObserved : null;
    if (Number.isFinite(tokensObserved)) {
      newTokensObserved = (Number.isFinite(newTokensObserved) ? newTokensObserved : 0) + tokensObserved;
    }
    // M233 bodyScopeHash scope-change grant: when the stored bodyScopeHash differs from the
    // current bodyScopeHash (and the current hash is non-null), the task's ## Proposal has
    // demonstrably changed since the last full review — reset the fullReviews counter to
    // _fullReviewDelta (typically 1), granting the new scope its own full-review budget WITHOUT
    // consuming a --new-epoch reset. When _fullReviewDelta is 0 (no full review this generation),
    // bodyScopeHash is carried forward unchanged from the existing record.
    const storedBodyScopeHash = existing?.bodyScopeHash ?? null;
    const newBodyScopeHash = bodyScopeHash ?? null;
    let resolvedFullReviews;
    if (_fullReviewDelta > 0 && newBodyScopeHash != null && storedBodyScopeHash != null && newBodyScopeHash !== storedBodyScopeHash) {
      resolvedFullReviews = _fullReviewDelta;
    } else {
      resolvedFullReviews = (base.fullReviews || 0) + _fullReviewDelta;
    }
    // When _fullReviewDelta is 0, carry forward the existing bodyScopeHash unchanged unless a new
    // hash is explicitly provided (in which case record it).
    const effectiveBodyScopeHash = _fullReviewDelta > 0 ? newBodyScopeHash : (newBodyScopeHash ?? storedBodyScopeHash);
    // Policy: never raise above the compiled DEFAULT_EPOCH_POLICY ceiling, and never raise above
    // whatever is ALREADY persisted — a caller can only ever tighten (Requested-action item 3 /
    // AC: "lower caller limits are honored and callers cannot silently raise policy maxima"), the
    // SAME "callers may lower, never raise" contract capsFor()/_maxDeltaRounds already establishes.
    const policy = {
      ordinaryCapMinutes: Math.min(
        Number.isFinite(basePolicy.ordinaryCapMinutes) ? basePolicy.ordinaryCapMinutes : DEFAULT_EPOCH_POLICY.ordinaryCapMinutes,
        Number.isFinite(ordinaryCapMinutes) ? ordinaryCapMinutes : Infinity,
      ),
      highRiskCapMinutes: Math.min(
        Number.isFinite(basePolicy.highRiskCapMinutes) ? basePolicy.highRiskCapMinutes : DEFAULT_EPOCH_POLICY.highRiskCapMinutes,
        Number.isFinite(highRiskCapMinutes) ? highRiskCapMinutes : Infinity,
      ),
      maxFullReviewsPerEpoch: Number.isFinite(basePolicy.maxFullReviewsPerEpoch) ? basePolicy.maxFullReviewsPerEpoch : DEFAULT_EPOCH_POLICY.maxFullReviewsPerEpoch,
      maxRepeatedFingerprint: Number.isFinite(basePolicy.maxRepeatedFingerprint) ? basePolicy.maxRepeatedFingerprint : DEFAULT_EPOCH_POLICY.maxRepeatedFingerprint,
    };
    const epochId = existing ? existing.epochId : _computeEpochId({ taskId, charterHash, reviewPolicyHash, salt: "" });
    const record = buildEpochRecord({
      epochId, taskId, charterHash, reviewPolicyHash,
      parentEpochId: existing ? existing.parentEpochId : null,
      bodyScopeHash: effectiveBodyScopeHash,
      counters: {
        attempts: (base.attempts || 0) + _attemptIncrement,
        fullReviews: resolvedFullReviews,
        deltaRounds: (base.deltaRounds || 0) + _deltaRoundDelta,
        contentAgentDispatches: (base.contentAgentDispatches || 0) + _dispatchDelta,
        observableAgentMs: (base.observableAgentMs || 0) + _elapsedMsDelta,
        terminalFingerprints,
        tokensObserved: newTokensObserved,
      },
      overrides: existing ? existing.overrides : [],
      resets: existing ? existing.resets : [],
      policy,
      createdAtMs: existing ? existing.createdAtMs : Date.now(),
    });
    const p = epochPath(workspace, taskId);
    writeJsonAtomic(p, record);
    const hr = highRisk === true || highRisk === "true";
    const capCheck = checkEpochCaps({ counters: record.counters, policy: record.policy, highRisk: hr, overrides: record.overrides, checkFullReviewCap: false });
    return { ok: true, epochFile: p, epochId: record.epochId, parentEpochId: record.parentEpochId, counters: record.counters, policy: record.policy, capCheck };
  } catch (err) {
    return { ok: false, code: "epoch-dispatch-exception", error: err.message };
  }
}

// --new-epoch: HUMAN-INVOKED ONLY. Creates a NEW epoch record linked via parentEpochId, resetting
// counters to zero. Requires --reason and --owner always; when the current (charterHash,
// reviewPolicyHash) identity is UNCHANGED from the existing on-file epoch, ALSO requires an
// explicit --confirmUnchangedScope true flag — a distinct, separately-named flag from --reason, so
// an ordinary redispatch (which never passes this flag) can never silently trigger a reset even by
// accident (Requested-action item 1 / "never triggered by a plain redispatch"; "verify the new
// epoch's identity hashes actually differ ... OR that an explicit override justification is
// present — don't let this become a silent bypass").
//
// gap-prepare-milestone-task-epoch-budget-reset (round 3, post-SECOND-REFUTATION): a round-2
// reviewer found `--confirmUnchangedScope true` was a mechanically UNRATE-LIMITED full reset of
// every cumulative counter — reproduced live, 5 identical calls in a row, all succeeded, each
// erasing all accumulated cost. Fixed with the SAME two-layer pattern `_overrideBudgetCli` already
// uses, applied here uniformly (not just on the unchanged-scope path — a real charter change could
// otherwise be gamed by trivial repeated cosmetic edits to keep triggering `identityChanged`):
//   1. HARD CEILING: total resets ever recorded for this task, checked against `existing.resets`
//      (which — unlike `counters` — is deliberately CARRIED FORWARD across every reset, precisely
//      so this ceiling cannot itself be reset away by the very action it bounds).
//   2. Distinctness: the new reset's own (owner, reason) must not match ANY prior reset already on
//      file, same "closed the alternation-bypass" reasoning as the override fix.
export function _newEpochCli({ taskId, workspace, charterFile, reason, owner, confirmUnchangedScope }) {
  if (!reason) return { ok: false, code: "new-epoch-requires-reason", error: "--reason is required" };
  if (!owner) return { ok: false, code: "new-epoch-requires-owner", error: "--owner is required" };
  // gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening (item 1): acquire the exclusive
  // epoch lock BEFORE the read-check-write sequence below — this closes the real TOCTOU race the
  // round-3 review reproduced (concurrent callers all reading the SAME `existing` record before
  // any of them writes, each independently concluding the ceiling has room). A lock-acquisition
  // failure (typed `epoch-lock-contention`) is returned immediately — never silently proceeding
  // without the lock, and nothing has been read/written yet so there is nothing to release.
  let _lockToken;
  try {
    ({ token: _lockToken } = _acquireEpochLock(workspace, taskId));
  } catch (err) {
    return { ok: false, code: err.code || "epoch-lock-exception", error: err.message };
  }
  try {
    const { charterHash, reviewPolicyHash } = _currentEpochIdentity({ workspace, taskId, charterFile });
    const { record: existing, corrupt } = _readEpochRecord(workspace, taskId);
    if (corrupt) {
      return { ok: false, code: "epoch-corrupt", error: "epoch record file exists but is not valid JSON" };
    }
    const identityChanged = !!existing && (existing.charterHash !== charterHash || existing.reviewPolicyHash !== reviewPolicyHash);
    const confirmed = confirmUnchangedScope === true || confirmUnchangedScope === "true";
    if (existing && !identityChanged && !confirmed) {
      return {
        ok: false, code: "new-epoch-requires-changed-identity-or-explicit-confirmation",
        error: "the current (charterHash, reviewPolicyHash) identity is UNCHANGED from the existing epoch — pass --confirmUnchangedScope true to explicitly authorize a reset with no real scope-hash change (never a silent bypass)",
      };
    }
    if (existing) {
      const priorResets = existing.resets || [];
      const maxNewEpochResetCount = Number.isFinite(existing.policy?.maxNewEpochResetCount) ? existing.policy.maxNewEpochResetCount : DEFAULT_EPOCH_POLICY.maxNewEpochResetCount;
      if (priorResets.length >= maxNewEpochResetCount) {
        return {
          ok: false, code: "new-epoch-reset-count-cap-exceeded",
          error: `this task already has ${priorResets.length} recorded epoch reset(s), meeting/exceeding the hard cap of ${maxNewEpochResetCount} — no further resets can be granted via this mechanism; escalate to a human decision outside this CLI`,
          resetCount: priorResets.length, maxNewEpochResetCount,
        };
      }
      const norm = (s) => String(s ?? "").trim().toLowerCase();
      const duplicateReset = priorResets.find((r) => norm(r.reason) === norm(reason) && norm(r.owner) === norm(owner));
      if (duplicateReset) {
        return {
          ok: false, code: "new-epoch-reset-not-distinct",
          error: "a PRIOR epoch reset for this task already has the SAME owner+reason — a further reset requires a distinct human scope decision, never a repeat of an earlier one",
        };
      }
    }
    const newEpochId = _computeEpochId({ taskId, charterHash, reviewPolicyHash, salt: `${Date.now()}-${Math.random()}` });
    const record = buildEpochRecord({
      epochId: newEpochId, taskId, charterHash, reviewPolicyHash,
      parentEpochId: existing ? existing.epochId : null,
      bodyScopeHash: existing?.bodyScopeHash ?? null,
      counters: {}, overrides: [],
      resets: existing ? [
        ...(existing.resets || []),
        { fromEpochId: existing.epochId, owner, reason, oldHash: { charterHash: existing.charterHash, reviewPolicyHash: existing.reviewPolicyHash }, newHash: { charterHash, reviewPolicyHash }, timestamp: Date.now() },
      ] : [],
      policy: existing ? existing.policy : DEFAULT_EPOCH_POLICY,
      createdAtMs: Date.now(),
    });
    const p = epochPath(workspace, taskId);
    writeJsonAtomic(p, record);
    return { ok: true, epochFile: p, epochId: record.epochId, parentEpochId: record.parentEpochId, record };
  } catch (err) {
    return { ok: false, code: err.code || "new-epoch-exception", error: err.message };
  } finally {
    _releaseEpochLock(workspace, taskId, _lockToken);
  }
}

// --override-budget: HUMAN-INVOKED ONLY. Grants ONE bounded extra time allowance (minutes) on the
// SAME epoch — appended to `overrides`, never replacing/removing a prior one.
//
// gap-prepare-milestone-task-epoch-budget-reset (round 2, post-REFUTATION): TWO independent
// safeguards, not one — an independent review found the original single "compare against only the
// MOST RECENT override" distinctness check could be defeated by trivially alternating between two
// canned (owner, reason) pairs, granting unbounded cumulative override minutes with zero genuine
// new human scope decisions (reproduced: 4 calls alternating "reason A"/"reason B" all succeeded,
// +240 minutes total). Fixed with two layers, neither alone sufficient before, both real now:
//   1. HARD CEILING (the real boundary): `policy.maxOverrideCount` — a strict count of total
//      overrides ever granted on this epoch, fail-closed once reached, no owner/reason text can
//      talk its way past it. This is the actual security property.
//   2. Strengthened distinctness (defense-in-depth, not the sole guard): a new override's
//      normalized (owner, reason) pair is rejected if it matches ANY prior override on this epoch's
//      full history, not just the most recent one — closes the 2-string-alternation bypass
//      specifically, on top of the hard ceiling above.
// A genuinely distinct owner or reason, within the count ceiling, always succeeds — this remains a
// real mechanism for legitimate repeated human review, not a de facto single-use override.
export function _overrideBudgetCli({ taskId, workspace, charterFile, reason, owner, additionalMinutes }) {
  if (!reason) return { ok: false, code: "override-requires-reason", error: "--reason is required" };
  if (!owner) return { ok: false, code: "override-requires-owner", error: "--owner is required" };
  const minutes = Number(additionalMinutes);
  if (!Number.isFinite(minutes) || minutes <= 0) return { ok: false, code: "override-requires-positive-minutes", error: "--additional-minutes must be a positive number" };
  // gap-prepare-milestone-epoch-cli-toctou-and-tamper-hardening (item 1): SAME lock as
  // _newEpochCli, guarding the SAME class of read-check-write race for --override-budget.
  let _lockToken;
  try {
    ({ token: _lockToken } = _acquireEpochLock(workspace, taskId));
  } catch (err) {
    return { ok: false, code: err.code || "epoch-lock-exception", error: err.message };
  }
  try {
    const { charterHash, reviewPolicyHash } = _currentEpochIdentity({ workspace, taskId, charterFile });
    const { record: existing, corrupt } = _readEpochRecord(workspace, taskId);
    if (corrupt) return { ok: false, code: "epoch-corrupt", error: "epoch record file exists but is not valid JSON" };
    if (!existing) return { ok: false, code: "override-requires-existing-epoch", error: "no epoch record exists yet for this task — nothing to override" };
    if (!_epochIdentityMatches(existing, { taskId, charterHash, reviewPolicyHash })) {
      return { ok: false, code: "epoch-identity-mismatch-requires-new-epoch", error: "the on-file epoch's identity no longer matches current state — call --new-epoch first" };
    }
    const priorOverrides = existing.overrides || [];
    const maxOverrideCount = Number.isFinite(existing.policy?.maxOverrideCount) ? existing.policy.maxOverrideCount : DEFAULT_EPOCH_POLICY.maxOverrideCount;
    if (priorOverrides.length >= maxOverrideCount) {
      return {
        ok: false, code: "override-count-cap-exceeded",
        error: `this epoch already has ${priorOverrides.length} override(s), meeting/exceeding the hard cap of ${maxOverrideCount} — no further overrides can be granted; use --new-epoch for a genuine scope change instead`,
        overrideCount: priorOverrides.length, maxOverrideCount,
      };
    }
    const norm = (s) => String(s ?? "").trim().toLowerCase();
    const duplicate = priorOverrides.find((o) => norm(o.reason) === norm(reason) && norm(o.owner) === norm(owner));
    if (duplicate) {
      return {
        ok: false, code: "override-not-distinct",
        error: "a PRIOR override on this epoch (not necessarily the most recent) already has the SAME owner+reason — a second override requires a distinct human scope decision, never a repeat of any earlier one",
      };
    }
    const overrideEntry = { owner, reason, additionalBudget: minutes, grantedAt: Date.now() };
    const record = { ...existing, overrides: [...priorOverrides, overrideEntry] };
    const p = epochPath(workspace, taskId);
    writeJsonAtomic(p, record);
    return { ok: true, epochFile: p, epochId: record.epochId, override: overrideEntry, overrides: record.overrides };
  } catch (err) {
    return { ok: false, code: err.code || "override-exception", error: err.message };
  } finally {
    _releaseEpochLock(workspace, taskId, _lockToken);
  }
}

async function _cliMain(argv) {
  const spec = {
    usage: "(--decide-resume|--decide-split|--record-split-decision|--record-generation [--no-release]|--release-only|--record-attempt|--resolve-checkpoint|--write-checkpoint|--epoch-status|--record-epoch-dispatch|--new-epoch|--override-budget) --taskId <id> --workspace <dir> [--charterFile <path>] [--callerOverride true|false] [--terminalPhase <phase>] [--outcome <o>] [--reason <r>] [--cacheable <bool>] [--milestoneId <id>] [--class <c>] [--highRisk <bool>] [--sessionId <id>] [--site <site>] [--detail <json>] [--phaseTimings <json>] [--findingCodes <json>] [--decision commit|split] [--checkpointInputFile <path>] [--owner <name>] [--additional-minutes <n>] [--confirmUnchangedScope true|false]",
    minArgs: 0,
    flags: {
      "decide-resume": { type: "boolean" },
      "decide-split": { type: "boolean" },
      "record-split-decision": { type: "boolean" },
      "record-generation": { type: "boolean" },
      "no-release": { type: "boolean" },
      "release-only": { type: "boolean" },
      "record-attempt": { type: "boolean" },
      "resolve-checkpoint": { type: "boolean" },
      "write-checkpoint": { type: "boolean" },
      "epoch-status": { type: "boolean" },
      "record-epoch-dispatch": { type: "boolean" },
      "new-epoch": { type: "boolean" },
      "override-budget": { type: "boolean" },
      checkpointInputFile: { type: "string" },
      taskId: { type: "string" },
      workspace: { type: "string" },
      charterFile: { type: "string" },
      callerOverride: { type: "string" },
      terminalPhase: { type: "string" },
      outcome: { type: "string" },
      reason: { type: "string" },
      cacheable: { type: "string" },
      milestoneId: { type: "string" },
      class: { type: "string" },
      highRisk: { type: "string" },
      sessionId: { type: "string" },
      site: { type: "string" },
      detail: { type: "string" },
      decision: { type: "string" },
      decisionKind: { type: "string" },
      // M207: both additive telemetry flags — parsed with the same optional-JSON-flag tolerance
      // as every existing flag; malformed/oversized values degrade fail-soft inside the writers
      // (CLAIM C10), never throwing here.
      phaseTimings: { type: "string" },
      findingCodes: { type: "string" },
      // gap-prepare-milestone-task-epoch-budget-reset: the epoch-cumulative circuit breaker's own
      // flags — numeric ones are parsed as strings (SAME convention as --highRisk/--cacheable
      // above) and converted with Number()/Number.isFinite() at each handler below.
      owner: { type: "string" },
      "additional-minutes": { type: "string" },
      confirmUnchangedScope: { type: "string" },
      dispatchDelta: { type: "string" },
      fullReviewDelta: { type: "string" },
      deltaRoundDelta: { type: "string" },
      elapsedMsDelta: { type: "string" },
      attemptIncrement: { type: "string" },
      tokensObserved: { type: "string" },
      ordinaryCapMinutes: { type: "string" },
      highRiskCapMinutes: { type: "string" },
      checkFullReviewCap: { type: "string" },
      // M233: bodyScopeHash for epoch status computation and dispatch recording
      "compute-body-scope-hash": { type: "string" },
      bodyScopeHash: { type: "string" },
    },
  };
  const parsed = parseArgs(argv, spec);
  const taskId = parsed.flags.taskId;
  const workspace = parsed.flags.workspace;

  // DIR-126-D/M203 Claim A.3 — the one submode taskId is allowed to be absent for: the
  // missing-required-args site's whole point is that taskId itself may be the missing field.
  if (parsed.flags["record-attempt"]) {
    if (!workspace) {
      console.error(`usage: node proposal-convergence.ts ${spec.usage}`);
      return 2;
    }
    const out = _recordAttemptCli({ taskId: taskId || null, workspace, site: parsed.flags.site, detail: parsed.flags.detail, phaseTimings: parsed.flags.phaseTimings, findingCodes: parsed.flags.findingCodes });
    console.log(JSON.stringify(out));
    return out.ok && out.telemetryWriteOk !== false ? 0 : 1;
  }

  if (!taskId || !workspace) {
    console.error(`usage: node proposal-convergence.ts ${spec.usage}`);
    return 2;
  }
  if (parsed.flags["decide-resume"]) {
    const out = _decideResumeCli({ taskId, workspace, charterFile: parsed.flags.charterFile, callerOverride: parsed.flags.callerOverride });
    console.log(JSON.stringify(out));
    return 0;
  }
  if (parsed.flags["decide-split"]) {
    if (!parsed.flags.charterFile) {
      console.error("--decide-split requires --charterFile");
      return 2;
    }
    const out = _decideSplitCli({ taskId, workspace, charterFile: parsed.flags.charterFile });
    console.log(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
  if (parsed.flags["record-split-decision"]) {
    if (!parsed.flags.charterFile) {
      console.error("--record-split-decision requires --charterFile");
      return 2;
    }
    const out = _recordSplitDecisionCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      decision: parsed.flags.decision,
      reason: parsed.flags.reason,
      sessionId: parsed.flags.sessionId,
    });
    console.log(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
  if (parsed.flags["release-only"]) {
    const out = _releaseLeaseOnlyCli({ taskId, workspace, reason: parsed.flags.reason });
    console.log(JSON.stringify(out));
    return out.ok && out.releaseResult?.ok ? 0 : 1;
  }
  if (parsed.flags["resolve-checkpoint"]) {
    if (!parsed.flags.charterFile) {
      console.error("--resolve-checkpoint requires --charterFile");
      return 2;
    }
    const out = _resolveCheckpointCli({ taskId, workspace, charterFile: parsed.flags.charterFile });
    console.log(JSON.stringify(out));
    return 0;
  }
  if (parsed.flags["write-checkpoint"]) {
    if (!parsed.flags.charterFile || !parsed.flags.checkpointInputFile) {
      console.error("--write-checkpoint requires --charterFile and --checkpointInputFile");
      return 2;
    }
    const out = _writeCheckpointCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      checkpointInputFile: parsed.flags.checkpointInputFile,
      terminalReason: parsed.flags.reason, terminalOutcome: parsed.flags.outcome,
    });
    console.log(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
  if (parsed.flags["record-generation"] && parsed.flags["no-release"]) {
    const out = _writeGenerationTelemetryCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      terminalPhase: parsed.flags.terminalPhase, outcome: parsed.flags.outcome,
      reason: parsed.flags.reason, cacheable: parsed.flags.cacheable,
      milestoneId: parsed.flags.milestoneId, class: parsed.flags.class, highRisk: parsed.flags.highRisk,
      sessionId: parsed.flags.sessionId, decisionKind: parsed.flags.decisionKind,
      phaseTimings: parsed.flags.phaseTimings, findingCodes: parsed.flags.findingCodes,
    });
    console.log(JSON.stringify(out));
    return out.ok && out.telemetryWriteOk !== false ? 0 : 1;
  }
  if (parsed.flags["record-generation"]) {
    const out = _recordGenerationCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      terminalPhase: parsed.flags.terminalPhase, outcome: parsed.flags.outcome,
      reason: parsed.flags.reason, cacheable: parsed.flags.cacheable,
      milestoneId: parsed.flags.milestoneId, class: parsed.flags.class, highRisk: parsed.flags.highRisk,
      sessionId: parsed.flags.sessionId, decisionKind: parsed.flags.decisionKind,
      phaseTimings: parsed.flags.phaseTimings, findingCodes: parsed.flags.findingCodes,
    });
    console.log(JSON.stringify(out));
    return out.ok && out.releaseResult?.ok ? 0 : 1;
  }
  // gap-prepare-milestone-task-epoch-budget-reset: the epoch-cumulative circuit breaker's own
  // four CLI submodes — --epoch-status (read-only), --record-epoch-dispatch (the only write path
  // prepare-milestone.js's own automated flow calls), --new-epoch / --override-budget (both
  // human-invoked-only, never dispatched by the workflow's own automated logic).
  if (parsed.flags["epoch-status"]) {
    if (!parsed.flags.charterFile) {
      console.error("--epoch-status requires --charterFile");
      return 2;
    }
    const out = _epochStatusCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      highRisk: parsed.flags.highRisk, checkFullReviewCap: parsed.flags.checkFullReviewCap,
      computeBodyScopeHash: parsed.flags["compute-body-scope-hash"],
    });
    console.log(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
  if (parsed.flags["record-epoch-dispatch"]) {
    if (!parsed.flags.charterFile) {
      console.error("--record-epoch-dispatch requires --charterFile");
      return 2;
    }
    const out = _recordEpochDispatchCli({
      taskId, workspace, charterFile: parsed.flags.charterFile, highRisk: parsed.flags.highRisk,
      dispatchDelta: Number(parsed.flags.dispatchDelta), fullReviewDelta: Number(parsed.flags.fullReviewDelta),
      deltaRoundDelta: Number(parsed.flags.deltaRoundDelta), elapsedMsDelta: Number(parsed.flags.elapsedMsDelta),
      attemptIncrement: Number(parsed.flags.attemptIncrement),
      terminalPhase: parsed.flags.terminalPhase, reason: parsed.flags.reason,
      tokensObserved: Number(parsed.flags.tokensObserved),
      bodyScopeHash: parsed.flags.bodyScopeHash,
      ordinaryCapMinutes: Number(parsed.flags.ordinaryCapMinutes), highRiskCapMinutes: Number(parsed.flags.highRiskCapMinutes),
    });
    console.log(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
  if (parsed.flags["new-epoch"]) {
    if (!parsed.flags.charterFile) {
      console.error("--new-epoch requires --charterFile");
      return 2;
    }
    const out = _newEpochCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      reason: parsed.flags.reason, owner: parsed.flags.owner, confirmUnchangedScope: parsed.flags.confirmUnchangedScope,
    });
    console.log(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
  if (parsed.flags["override-budget"]) {
    if (!parsed.flags.charterFile) {
      console.error("--override-budget requires --charterFile");
      return 2;
    }
    const out = _overrideBudgetCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      reason: parsed.flags.reason, owner: parsed.flags.owner, additionalMinutes: parsed.flags["additional-minutes"],
    });
    console.log(JSON.stringify(out));
    return out.ok ? 0 : 1;
  }
  console.error(`usage: node proposal-convergence.ts ${spec.usage}`);
  return 2;
}

if (isDirectEntry(import.meta, undefined, "proposal-convergence")) {
  _cliMain(process.argv).then((code) => process.exit(code));
}
