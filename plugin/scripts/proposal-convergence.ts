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
import { extractSection } from "./task-schema.ts";
import { PREFLIGHT_POLICY_VERSION, releaseLease } from "./prepare-admission-check.ts";

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
export function checkSplitRecommendation({ ledger, mechanismCount, touchSetSize, smallMilestoneTouchBoundary = 8 } = {}) {
  const bySubsystem = groupBlockingBySubsystem(ledger);
  for (const [subsystem, count] of Object.entries(bySubsystem)) {
    if (count >= 3) {
      return { recommend: true, code: "split-subsystem-blocking-cluster", reason: `subsystem "${subsystem}" has ${count} independent blocking findings (>= 3)` };
    }
  }
  if (Number.isFinite(mechanismCount) && mechanismCount > 2) {
    return { recommend: true, code: "split-multi-mechanism", reason: `candidate contains ${mechanismCount} independently landable mechanisms (> 2)` };
  }
  if (Number.isFinite(touchSetSize) && Number.isFinite(smallMilestoneTouchBoundary) && touchSetSize > smallMilestoneTouchBoundary) {
    return { recommend: true, code: "split-touch-set-too-large", reason: `checked touch set (${touchSetSize}) exceeds the small-milestone boundary (${smallMilestoneTouchBoundary})` };
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
export function nextAction({ fullSynthesisCount, deltaRound, ledger, caps, budgetExceeded, splitCheck }) {
  if ((fullSynthesisCount || 0) < 1) return { action: "dispatch-full-synthesis" };
  const openBlocking = blockingOpen(ledger).length;
  if (openBlocking === 0) return { action: "stop-prepared" };
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

// Same sha256(identity).slice(0, 12) idiom fingerprintFinding already uses above — not a new ID
// convention.
function _computeGenerationId({ taskId, ownerExecutionId, fencingToken, acquiredAt }) {
  return sha256(`${taskId}::${ownerExecutionId}::${fencingToken}::${acquiredAt}`).slice(0, 12);
}

function _currentReviewPolicyHash() {
  return sha256(`${PREFLIGHT_POLICY_VERSION}::${RESUME_POLICY_VERSION}`);
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
    const leaseRaw = fs.readFileSync(_leasePath(workspace, taskId), "utf8");
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
export function _recordGenerationCli({ taskId, workspace, charterFile, terminalPhase, outcome, reason, cacheable }) {
  try {
    const leaseRaw = fs.readFileSync(_leasePath(workspace, taskId), "utf8");
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
    const releaseResult = releaseLease({ workspace, taskId, method: "normal", reason: reason || null, now: Date.now() });
    return { ok: true, record, releaseResult };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function _cliMain(argv) {
  const spec = {
    usage: "(--decide-resume|--record-generation) --taskId <id> --workspace <dir> [--charterFile <path>] [--callerOverride true|false] [--terminalPhase <phase>] [--outcome <o>] [--reason <r>] [--cacheable <bool>]",
    minArgs: 0,
    flags: {
      "decide-resume": { type: "boolean" },
      "record-generation": { type: "boolean" },
      taskId: { type: "string" },
      workspace: { type: "string" },
      charterFile: { type: "string" },
      callerOverride: { type: "string" },
      terminalPhase: { type: "string" },
      outcome: { type: "string" },
      reason: { type: "string" },
      cacheable: { type: "string" },
    },
  };
  const parsed = parseArgs(argv, spec);
  const taskId = parsed.flags.taskId;
  const workspace = parsed.flags.workspace;
  if (!taskId || !workspace) {
    console.error(`usage: node proposal-convergence.ts ${spec.usage}`);
    return 2;
  }
  if (parsed.flags["decide-resume"]) {
    const out = _decideResumeCli({ taskId, workspace, charterFile: parsed.flags.charterFile, callerOverride: parsed.flags.callerOverride });
    console.log(JSON.stringify(out));
    return 0;
  }
  if (parsed.flags["record-generation"]) {
    const out = _recordGenerationCli({
      taskId, workspace, charterFile: parsed.flags.charterFile,
      terminalPhase: parsed.flags.terminalPhase, outcome: parsed.flags.outcome,
      reason: parsed.flags.reason, cacheable: parsed.flags.cacheable,
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
