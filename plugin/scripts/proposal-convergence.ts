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
import { extractSection, countBoxes } from "./task-schema.ts";
import { PREFLIGHT_POLICY_VERSION, releaseLease, _readLeaseFileWithRetry } from "./prepare-admission-check.ts";
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
  // Validate dependsOn edges — every referenced id must exist in the inventory.
  for (const m of mechanisms) {
    if (Array.isArray(m.dependsOn)) {
      for (const dep of m.dependsOn) {
        if (!ids.has(dep)) {
          return { ok: false, code: "mechanism-inventory-invalid", message: `dangling dependsOn edge: ${JSON.stringify(m.id)} depends on ${JSON.stringify(dep)} which is not in the inventory` };
        }
      }
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

export function checkSplitRecommendation({ ledger, mechanismCount, mechanismInventory, touchSetSize, smallMilestoneTouchBoundary = 8 } = {}) {
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
      return { recommend: true, code: "split-subsystem-blocking-cluster", reason: `subsystem "${subsystem}" has ${count} distinct-root-cause independent blocking findings (>= 3)`, repairable };
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
    return { recommend: true, code: "split-multi-mechanism", reason: `candidate contains ${effectiveCount} independently landable mechanisms (> 2)`, repairable: false };
  }
  if (Number.isFinite(touchSetSize) && Number.isFinite(smallMilestoneTouchBoundary) && touchSetSize > smallMilestoneTouchBoundary) {
    return { recommend: true, code: "split-touch-set-too-large", reason: `checked touch set (${touchSetSize}) exceeds the small-milestone boundary (${smallMilestoneTouchBoundary})`, repairable: false };
  }
  return { recommend: false };
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

function _safeTaskIdSegment(taskId) {
  return String(taskId).replace(/[\\/]/g, "_");
}
function _leasePath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-leases", `${_safeTaskIdSegment(taskId)}.json`);
}
function _generationPath(workspace, taskId) {
  return path.join(workspace, ".quay", "prepare-leases", `${_safeTaskIdSegment(taskId)}.generation.json`);
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

// telemetryPath — Claim A.0: reuses _safeTaskIdSegment() VERBATIM (never reimplemented) for
// slash-stripping, then layers a post-hoc containment check on top, specific to this new
// PERMANENTLY GIT-COMMITTED tree (a stricter bar than .generation.json's gitignored/ephemeral
// sibling): a bare taskId of exactly ".." passes _safeTaskIdSegment completely unchanged (it only
// strips '/'/'\\') and would otherwise resolve ONE LEVEL ABOVE the intended
// milestones/prepare-telemetry/ tree. Any resolved candidate landing outside that root is
// redirected to a fixed `_unsafe-taskid` bucket instead. `taskId === null` (the three pre-lease
// sites' "taskId itself is the missing field" case) routes to a fixed `_missing-taskId` segment.
export function telemetryPath(workspace, taskId, recordId) {
  const seg = taskId === null || taskId === undefined ? "_missing-taskId" : _safeTaskIdSegment(taskId);
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

// ── _decisionRecordPath — committed decision record under milestones/prepare-decisions/. ──────
function _decisionRecordPath(workspace, taskId) {
  const seg = _safeTaskIdSegment(taskId);
  return path.join(workspace, "milestones", "prepare-decisions", `${seg}.json`);
}

// ── decideSplitAdjudication — M206/M4: pure read-only evaluator for hash-bound COMMIT/SPLIT
// decision records. Four verdicts: no-decision-on-file, skip-split-adjudication (COMMIT match),
// decision-invalidated (COMMIT mismatch), content-dispatch-blocked (SPLIT match).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
export function decideSplitAdjudication(record, { charterHash, scopeHash: currentScopeHash, reviewPolicyHash }) {
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
    if (match) {
      return { verdict: "content-dispatch-blocked", outcome: "needs-human", reason: "split-decision-blocks-dispatch", phase: "Admission", record };
    }
    // SPLIT record with mismatched hashes — the ruling no longer applies; proceed.
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
  const seg = _safeTaskIdSegment(taskId);
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
    const verdict = decideSplitAdjudication(record, { charterHash, scopeHash: currentScopeHash, reviewPolicyHash });
    // If decision-invalidated and we mutated the record (COMMIT mismatch), write back the augmented record.
    if (verdict.verdict === "decision-invalidated" && verdict.record && record) {
      try {
        fs.writeFileSync(recordPath, JSON.stringify(verdict.record, null, 2));
      } catch {
        // Write failure non-fatal — the CLI surface still reports the correct verdict.
      }
    }
    return { ok: true, ...verdict, hashes: { charterHash, scopeHash: currentScopeHash, reviewPolicyHash } };
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
// (`.quay/prepare-checkpoints/<safeTaskIdSegment>.json`, reusing this file's OWN existing
// `_safeTaskIdSegment` — never a second sanitizer) carries the typed finding ledger, the
// last-reviewed Proposal text, and cumulative epoch counters forward across generations. A later
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
  return path.join(workspace, ".quay", "prepare-checkpoints", `${_safeTaskIdSegment(taskId)}.json`);
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

// _atomicWriteJson — tmp-then-rename, the same durable-JSON-write idiom this module's own lease
// precedent (prepare-admission-check.ts's `wx`-flag lease acquire) established for state a LATER,
// possibly different process reads back — never a partial/torn file a concurrent reader could
// observe mid-write.
function _atomicWriteJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

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
    _atomicWriteJson(p, record);
    return { ok: true, checkpointFile: p, counters, epochReset: !sameEpoch };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function _cliMain(argv) {
  const spec = {
    usage: "(--decide-resume|--decide-split|--record-split-decision|--record-generation [--no-release]|--release-only|--record-attempt|--resolve-checkpoint|--write-checkpoint) --taskId <id> --workspace <dir> [--charterFile <path>] [--callerOverride true|false] [--terminalPhase <phase>] [--outcome <o>] [--reason <r>] [--cacheable <bool>] [--milestoneId <id>] [--class <c>] [--highRisk <bool>] [--sessionId <id>] [--site <site>] [--detail <json>] [--phaseTimings <json>] [--findingCodes <json>] [--decision commit|split] [--checkpointInputFile <path>]",
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
  console.error(`usage: node proposal-convergence.ts ${spec.usage}`);
  return 2;
}

if (isDirectEntry(import.meta)) {
  _cliMain(process.argv).then((code) => process.exit(code));
}
